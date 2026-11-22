// Hero: a scroll-driven exploded view of an Acura RSX (DC5).
// Render-on-demand: nothing is drawn unless scroll, input or an easing is in flight.
const MODEL_URL = 'assets/models/rsx.glb';
const DRACO_PATH = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/';

const root = document.getElementById('garage');
const stage = root?.querySelector('.g-stage');
const canvas = document.getElementById('g-canvas');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobileMQ = matchMedia('(max-width: 899px)');

// The eight systems: which model parts they cover, and where the leader line attaches (part + local offset in metres).
const SYSTEMS = [
  { parts: ['shell', 'interior'], anchor: 'shell', off: [0.35, 0.05, -0.2] },
  { parts: ['engine', 'gearbox', 'hood'], anchor: 'engine', off: [0.15, 0.12, 0.05] },
  { parts: ['door_l', 'door_r', 'fender_fl', 'fender_fr', 'bumper_f', 'bumper_r', 'hatch'], anchor: 'door_l', off: [0.1, 0.1, 0] },
  { parts: ['headlight_l', 'headlight_r', 'taillight_l', 'taillight_r'], anchor: 'headlight_l', off: [0, 0, 0] },
  { parts: ['glass'], anchor: 'glass', off: [0.3, 0.2, 0.2] },
  { parts: ['exhaust'], anchor: 'exhaust', off: [0, 0, 0] },
  { parts: ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr', 'brake_fl', 'brake_fr', 'brake_rl', 'brake_rr', 'coilover_fl', 'coilover_fr', 'coilover_rl', 'coilover_rr'], anchor: 'wheel_rl', off: [0.1, 0, 0] },
  { parts: ['wing', 'skirts'], anchor: 'wing', off: [0.4, 0, 0] },
];

// Explosion: v = offset in metres at full explode ([x sideways (+left), y up, z forward]). `side: true` mirrors v.x by
// the part's side. yaw = extra swing in radians. d = stagger delay (0..~0.2 of the explode range).
const EXPLODE = {
  shell: { v: [0, 0, 0] },
  interior: { v: [0, 0.85, -0.05], d: 0.12 },
  glass: { v: [0, 1.4, 0], d: 0.2 },
  hood: { v: [0, 1.25, 1.25], d: 0.04 },
  // K24 rises straight out of the bay; the gearbox unbolts and steps out to the driver's side
  engine: { v: [0, 0.78, 0.12], d: 0.12 },
  gearbox: { v: [0.62, 0.52, 0.12], d: 0.16 },
  hatch: { v: [0, 0.55, -1.2], d: 0.1 },
  wing: { v: [0, 0.95, -1.6], d: 0.16 },
  bumper_f: { v: [0, -0.02, 1.1], d: 0 },
  bumper_r: { v: [0, -0.02, -1.15], d: 0 },
  door_l: { v: [1.3, 0.12, 0.1], side: true, yaw: 0.3, d: 0.05 },
  door_r: { v: [1.3, 0.12, 0.1], side: true, yaw: 0.3, d: 0.05 },
  fender_fl: { v: [0.85, 0.2, 0.55], side: true, d: 0.05 },
  fender_fr: { v: [0.85, 0.2, 0.55], side: true, d: 0.05 },
  skirts: { v: [0, -0.04, 0], scaleX: 0.55, d: 0.04 },
  headlight_l: { v: [0.55, 0.4, 0.95], side: true, d: 0.12 },
  headlight_r: { v: [0.55, 0.4, 0.95], side: true, d: 0.12 },
  taillight_l: { v: [0.5, 0.4, -0.95], side: true, d: 0.12 },
  taillight_r: { v: [0.5, 0.4, -0.95], side: true, d: 0.12 },
  exhaust: { v: [0, -0.03, -1.55], d: 0.1 },
  wheel_fl: { v: [1.15, 0, 0], side: true, d: 0 }, wheel_fr: { v: [1.15, 0, 0], side: true, d: 0 },
  wheel_rl: { v: [1.15, 0, 0], side: true, d: 0 }, wheel_rr: { v: [1.15, 0, 0], side: true, d: 0 },
  brake_fl: { v: [0.5, 0, 0], side: true, d: 0.08 }, brake_fr: { v: [0.5, 0, 0], side: true, d: 0.08 },
  brake_rl: { v: [0.5, 0, 0], side: true, d: 0.08 }, brake_rr: { v: [0.5, 0, 0], side: true, d: 0.08 },
  // BC Racing coilovers: rise out of the strut towers and step outboard, between the brakes and the body
  coilover_fl: { v: [0.22, 0.42, 0], side: true, d: 0.1 }, coilover_fr: { v: [0.22, 0.42, 0], side: true, d: 0.1 },
  coilover_rl: { v: [0.22, 0.42, 0], side: true, d: 0.1 }, coilover_rr: { v: [0.22, 0.42, 0], side: true, d: 0.1 },
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10); }; // smootherstep
const ease = (x) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

function fail(err) {
  console.warn('Hero 3D unavailable, using the text hero.', err);
  root?.classList.add('hero-failed');
  root?.classList.remove('hero-ready');
}

async function start() {
  if (!root || !stage || !canvas) return;
  let THREE, GLTFLoader, DRACOLoader, RoomEnvironment;
  try {
    const mods = await Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/loaders/DRACOLoader.js'),
      import('three/addons/environments/RoomEnvironment.js'),
    ]);
    THREE = mods[0]; GLTFLoader = mods[1].GLTFLoader; DRACOLoader = mods[2].DRACOLoader; RoomEnvironment = mods[3].RoomEnvironment;
  } catch (e) { return fail(e); }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) { return fail(e); }
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  // ---------- scene ----------
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(26, 1, 0.5, 80);

  const sun = new THREE.DirectionalLight(0xfff4e6, 1.3);
  sun.position.set(3.2, 8.5, 4.2);
  sun.castShadow = true;
  const sc = sun.shadow.camera;
  sc.left = -5.5; sc.right = 5.5; sc.top = 5.5; sc.bottom = -5.5; sc.near = 2; sc.far = 22;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // studio floor: dim, lit, fades out radially; receives the car's shadow
  const gc = document.createElement('canvas'); gc.width = gc.height = 256;
  const gx = gc.getContext('2d');
  const grad = gx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, '#fff'); grad.addColorStop(0.45, '#9a9a9a'); grad.addColorStop(1, '#000');
  gx.fillStyle = grad; gx.fillRect(0, 0, 256, 256);
  const floorAlpha = new THREE.CanvasTexture(gc);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(8, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.92, metalness: 0, transparent: true, alphaMap: floorAlpha, depthWrite: false, envMapIntensity: 0.25 })
  );
  floor.receiveShadow = true; floor.renderOrder = -2; floor.position.y = -0.002;
  scene.add(floor);

  // ---------- load the model ----------
  const loadEl = root.querySelector('.g-loading');
  const draco = new DRACOLoader().setDecoderPath(DRACO_PATH);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  let gltf;
  try {
    gltf = await loader.loadAsync(MODEL_URL, (e) => {
      if (e.lengthComputable && e.total) { loadEl?.classList.remove('indet'); root.style.setProperty('--load', (e.loaded / e.total).toFixed(3)); }
    });
  } catch (e) { draco.dispose(); renderer.dispose(); return fail(e); }
  draco.dispose();

  const car = gltf.scene;
  scene.add(car);
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // ---------- materials ----------
  const PAINT = { color: 0x142d85, metalness: 0.5, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.25, sheen: 0.7, sheenRoughness: 0.4, sheenColor: new THREE.Color(0x5f8cff) };
  const mats = new Set();
  const seen = new Map();
  const names = {};
  const makeMat = (src, partName) => {
    const n = src.name;
    let m;
    let order = 0;
    let shadow = true;
    if (/CarPaint/.test(n) && !/Trim_Carbon/.test(n)) {
      m = new THREE.MeshPhysicalMaterial(PAINT);
      m.userData.paint = true;
    } else if (/Trim_Carbon/.test(n)) {
      m = src.clone(); m.metalness = 0.1; m.roughness = 0.35; m.clearcoat = 1; m.clearcoatRoughness = 0.05;
    } else if (/LightGlass/.test(n)) {
      shadow = false; order = 10;
      const red = /Red/.test(n), orange = /Orange/.test(n);
      m = new THREE.MeshPhysicalMaterial({
        color: red ? 0xd1081c : orange ? 0xe0700f : 0xe8eef2, metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02,
        opacity: red ? 0.82 : orange ? 0.85 : 0.18, emissive: red ? 0x6a0008 : orange ? 0x4a1d00 : 0x000000, envMapIntensity: 1.6, depthWrite: false,
      });
    } else if (n === 'dark_glass') {
      shadow = false; order = 9;
      m = new THREE.MeshPhysicalMaterial({ color: 0x05070a, metalness: 0, roughness: 0.06, opacity: 0.78, envMapIntensity: 1.4, depthWrite: false, side: THREE.DoubleSide });
    } else if (/Glass_Window(Front|Surround)/.test(n) && !/Surround/.test(n)) {
      shadow = false; order = 10;
      m = new THREE.MeshPhysicalMaterial({ color: 0x0c131b, metalness: 0, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, opacity: 0.4, envMapIntensity: 1.8, depthWrite: false, side: THREE.DoubleSide });
    } else if (/GlassOpaque_Mirror/.test(n)) {
      m = new THREE.MeshPhysicalMaterial({ color: 0xcfd4d8, metalness: 1, roughness: 0.04, envMapIntensity: 1.2 });
    } else if (/Chrome|Nickel/.test(n)) {
      m = new THREE.MeshPhysicalMaterial({ color: 0xc9ccd0, metalness: 1, roughness: /Rough/.test(n) ? 0.38 : 0.12, envMapIntensity: 1.1 });
    } else if (n === 'rim_mat') {
      m = new THREE.MeshPhysicalMaterial({ color: src.color, metalness: 0.9, roughness: 0.28, clearcoat: 0.5, clearcoatRoughness: 0.15, envMapIntensity: 1.1 });
    } else if (n === 'rim_C2') {
      m = new THREE.MeshPhysicalMaterial({ color: 0x050506, metalness: 0.6, roughness: 0.35, envMapIntensity: 0.9 });
    } else if (n === 'tire1') {
      m = new THREE.MeshPhysicalMaterial({ color: 0x0c0c0d, metalness: 0, roughness: 0.82, envMapIntensity: 0.5 });
    } else if (n === 'calipers1') {
      m = new THREE.MeshPhysicalMaterial({ color: 0xb30c0c, metalness: 0.3, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.1 });
    } else if (n === 'breaks1') { // brake disc, textured
      m = src.clone(); m.metalness = 0.85; m.roughness = 0.42;
    } else if (/^k24_/.test(n)) { // the K24 and gearbox
      const K = {
        k24_red_crinkle: { color: 0xa3121a, metalness: 0.15, roughness: 0.62, clearcoat: 0.25, clearcoatRoughness: 0.5 },
        k24_silver_cover: { color: 0xd9dcdf, metalness: 0.35, roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.25 },
        k24_badge_plate: { color: 0xe6e8ea, metalness: 0.6, roughness: 0.25 },
        k24_badge_red: { color: 0xc8101e, metalness: 0.1, roughness: 0.35 },
        k24_text_light: { color: 0xe9eaec, metalness: 0.4, roughness: 0.3 },
        k24_cast_alu: { color: 0x9ea3a8, metalness: 0.85, roughness: 0.52 },
        k24_steel: { color: 0xc4c7cb, metalness: 1, roughness: 0.22 },
        k24_steel_dark: { color: 0x5c6066, metalness: 0.9, roughness: 0.4 },
        k24_black_plastic: { color: 0x101113, metalness: 0, roughness: 0.55 },
        k24_rubber: { color: 0x0b0b0c, metalness: 0, roughness: 0.85 },
      }[n];
      m = K ? new THREE.MeshPhysicalMaterial({ ...K, envMapIntensity: 1.1 }) : src.clone();
    } else if (/^bc /.test(n)) { // BC Racing coilovers
      const B = { 'bc black': { color: 0x111214, metalness: 0.3, roughness: 0.35, clearcoat: 0.6 }, 'bc gold': { color: 0xc9a14a, metalness: 1, roughness: 0.25 },
        'bc silver': { color: 0xb9bdc1, metalness: 1, roughness: 0.3 }, 'bc chrome': { color: 0xdfe2e5, metalness: 1, roughness: 0.08 }, 'bc rubber': { color: 0x0b0b0c, metalness: 0, roughness: 0.8 } }[n];
      m = B ? new THREE.MeshPhysicalMaterial({ ...B, envMapIntensity: 1.1 }) : src.clone();
    } else {
      m = src.clone();
      m.metalness = 0; m.roughness = Math.max(0.45, src.roughness);
      m.envMapIntensity = 1.1;
    }
    if (m.specularColor) m.specularColor.setRGB(1, 1, 1);
    if (m.map) { m.map.anisotropy = maxAniso; if (src.alphaMap == null && !m.userData.paint) m.alphaTest = 0.4; }
    m.transparent = true; // every material is blendable so focus can fade parts without a shader recompile
    m.userData.base = m.opacity;
    m.userData.order = order;
    m.userData.shadow = shadow;
    names[n] = (names[n] || 0) + 1;
    mats.add(m);
    return m;
  };

  // ---------- parts ----------
  const parts = []; // { node, base, v, d, yaw, meshes[], opacity, target, sys }
  const byName = {};
  const meshes = [];
  car.children.forEach((node) => {
    const cfg = EXPLODE[node.name] || { v: [0, 0, 0] };
    const side = node.position.x < 0 ? -1 : 1;
    const part = {
      node, name: node.name, base: node.position.clone(), baseYaw: node.rotation.y,
      v: new THREE.Vector3(cfg.v[0] * (cfg.side ? side : 1), cfg.v[1], cfg.v[2]),
      yaw: (cfg.yaw || 0) * side, scaleX: cfg.scaleX || 0, d: cfg.d || 0,
      meshes: [], opacity: 1, target: 1, sys: -1,
    };
    node.traverse((o) => {
      if (!o.isMesh) return;
      const key = node.name + '|' + o.material.uuid;
      let m = seen.get(key);
      if (!m) { m = makeMat(o.material, node.name); seen.set(key, m); }
      o.material = m;
      o.castShadow = m.userData.shadow;
      o.renderOrder = m.userData.order;
      o.userData.part = parts.length;
      part.meshes.push(o); meshes.push(o);
    });
    byName[node.name] = part;
    parts.push(part);
  });
  SYSTEMS.forEach((s, i) => { s.list = s.parts.map((n) => byName[n]).filter(Boolean); s.list.forEach((p) => (p.sys = i)); });
  console.info('RSX materials:', JSON.stringify(names), 'meshes:', meshes.length);

  // ---------- explode / camera maths ----------
  let exploded = -1;
  const applyExplode = (e) => {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const t = e <= 0 ? 0 : smooth((e - p.d) / (1 - p.d));
      p.node.position.copy(p.base).addScaledVector(p.v, t);
      if (p.yaw) p.node.rotation.y = p.baseYaw + p.yaw * t;
      if (p.scaleX) p.node.scale.x = 1 + p.scaleX * t;
    }
    exploded = e;
  };

  const box = new THREE.Box3(), ctr = new THREE.Vector3(), sz = new THREE.Vector3();
  applyExplode(1); car.updateMatrixWorld(true); box.setFromObject(car);
  const boxE = box.clone();
  applyExplode(0); car.updateMatrixWorld(true); box.setFromObject(car);
  const boxA = box.clone();
  const radius = (b) => b.getSize(sz).length() / 2;
  const R_A = radius(boxA), R_E = radius(boxE);
  const midA = boxA.getCenter(new THREE.Vector3()), midE = boxE.getCenter(new THREE.Vector3());
  console.info('RSX size', boxA.getSize(new THREE.Vector3()).toArray().map((x) => +x.toFixed(2)), 'exploded', boxE.getSize(new THREE.Vector3()).toArray().map((x) => +x.toFixed(2)));

  // ---------- state ----------
  let W = 1, H = 1, isMobile = mobileMQ.matches;
  let targetP = 0, P = 0, manual = false;
  let fa = 0, hs = 0, labelsOn = false, focus = -1, hover = -1;
  let spanPx = 1;
  let pointerX = 0, pointerY = 0, px = 0, py = 0;
  let userYaw = 0, userPitch = 0, velYaw = 0, velPitch = 0, dragging = false, dragId = -1, dragX = 0, dragY = 0;
  let introT = reduced ? 99 : 0;
  let raf = 0, last = 0, visible = true, renders = 0, ready = false;
  let distA = 10, distE = 13;
  const camTarget = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const FOV = 26;

  const fitDist = (R, fw, fh, aspect) => {
    const hv = (FOV * Math.PI) / 360;
    const ang = Math.min(Math.atan(Math.tan(hv) * fh), Math.atan(Math.tan(hv) * aspect * fw));
    return R / Math.sin(ang);
  };

  const layout = () => {
    const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
    isMobile = mobileMQ.matches;
    W = w; H = h;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : 1.5));
    renderer.setSize(w, h, false);
    const s = isMobile ? 1024 : 2048;
    if (sun.shadow.mapSize.x !== s) { sun.shadow.mapSize.set(s, s); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    camera.aspect = w / h;
    // Frame the car in the right two thirds on desktop, the upper half on mobile.
    if (isMobile) {
      camera.setViewOffset(w, h, 0, h * 0.2, w, h);
      distA = fitDist(R_A * 0.74, 0.9, 0.46, camera.aspect);
      distE = fitDist(R_E * 0.72, 0.94, 0.5, camera.aspect);
    } else {
      camera.setViewOffset(w, h, -w * 0.19, 0, w, h);
      distA = fitDist(R_A * 0.78, 0.6, 0.72, camera.aspect);
      distE = fitDist(R_E * 0.56, 0.64, 0.8, camera.aspect);
    }
    camera.updateProjectionMatrix();
    spanPx = Math.max(1, root.offsetHeight - h);
    measureLabels();
    request();
  };

  // ---------- labels + leaders ----------
  const labelEls = [...root.querySelectorAll('.g-label')];
  const leader = document.getElementById('g-leader');
  const SVGNS = 'http://www.w3.org/2000/svg';
  const leaderG = [], leaderPath = [], leaderDot = [];
  labelEls.forEach(() => {
    const g = document.createElementNS(SVGNS, 'g');
    const path = document.createElementNS(SVGNS, 'path');
    const dot = document.createElementNS(SVGNS, 'rect');
    dot.setAttribute('width', '5'); dot.setAttribute('height', '5');
    g.append(path, dot); leader.append(g);
    leaderG.push(g); leaderPath.push(path); leaderDot.push(dot);
  });
  const lw = new Float32Array(8), lh = new Float32Array(8);
  const ax = new Float32Array(8), ay = new Float32Array(8), ly = new Float32Array(8), side = new Int8Array(8), order = [0, 1, 2, 3, 4, 5, 6, 7];
  function measureLabels() {
    labelEls.forEach((el, i) => { lw[i] = el.offsetWidth; lh[i] = el.offsetHeight; });
  }

  const centre = new THREE.Vector3(0, 0.6, 0);
  function placeLabels() {
    // project the centre and each anchor
    tmp.copy(centre).project(camera);
    const cx = (tmp.x * 0.5 + 0.5) * W, cy = (-tmp.y * 0.5 + 0.5) * H;
    for (let i = 0; i < 8; i++) {
      const s = SYSTEMS[i], p = byName[s.anchor];
      if (!p) continue;
      tmp.copy(p.node.position).add(p.node.position.x < 0 ? offFlip(s.off) : offVec(s.off)).project(camera);
      ax[i] = (tmp.x * 0.5 + 0.5) * W; ay[i] = (-tmp.y * 0.5 + 0.5) * H;
      side[i] = ax[i] < cx ? -1 : 1;
      ly[i] = ay[i] + (ay[i] < cy ? -1 : 1) * (isMobile ? 22 : 30);
    }
    // keep labels on the same side from stacking: sort by y and push apart
    const gap = (isMobile ? 24 : 32);
    for (let sd = -1; sd <= 1; sd += 2) {
      let prev = -1e9;
      order.sort((a, b) => ly[a] - ly[b]);
      for (let k = 0; k < 8; k++) {
        const i = order[k];
        if (side[i] !== sd) continue;
        if (ly[i] < prev + gap) ly[i] = prev + gap;
        prev = ly[i];
      }
    }
    const reach = isMobile ? 26 : 38;
    for (let i = 0; i < 8; i++) {
      const sd = side[i];
      let ex = ax[i] + sd * reach, ey = ly[i];
      const w = lw[i], h = lh[i];
      let lx = sd > 0 ? ex : ex - w;
      const lo = 12, hi = W - 12 - w;
      if (lx < lo) { lx = lo; ex = lx + w; } else if (lx > hi) { lx = hi; ex = lx; }
      const top = ey - h / 2;
      labelEls[i].style.transform = `translate(${lx.toFixed(1)}px,${top.toFixed(1)}px)`;
      leaderPath[i].setAttribute('d', `M${ax[i].toFixed(1)} ${ay[i].toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}`);
      leaderDot[i].setAttribute('x', (ax[i] - 2.5).toFixed(1)); leaderDot[i].setAttribute('y', (ay[i] - 2.5).toFixed(1));
    }
  }
  const _o = new THREE.Vector3();
  const offVec = (o) => _o.set(o[0], o[1], o[2]);
  const offFlip = (o) => _o.set(-o[0], o[1], o[2]);

  // ---------- focus ----------
  const headEl = stage.querySelector('.g-head');
  const cards = [...root.querySelectorAll('.g-card')];
  function setFocus(i) {
    if (i === focus) return;
    focus = i;
    root.classList.toggle('has-focus', i >= 0);
    labelEls.forEach((el, k) => el.setAttribute('aria-pressed', String(k === i)));
    leaderG.forEach((g, k) => g.classList.toggle('act', k === i));
    cards.forEach((c) => c.classList.toggle('on', Number(c.dataset.sys) === i));
    for (const p of parts) {
      p.target = i < 0 || p.sys === i ? 1 : 0.16;
      const faded = i >= 0 && p.sys !== i;
      for (const m of p.meshes) m.renderOrder = faded ? 20 : m.material.userData.order;
    }
    request();
  }

  // ---------- frame ----------
  function frame(now) {
    raf = 0;
    if (!visible) return;
    const real = last ? (now - last) / 1000 : 0.016;
    const dt = Math.min(0.05, real);
    last = now;
    let busy = false;

    // scroll progress eased
    if (reduced || manual === 'snap') { P = targetP; }
    else {
      const diff = targetP - P;
      if (Math.abs(diff) > 0.0004) { P += diff * (1 - Math.exp(-dt * 7)); busy = true; } else P = targetP;
    }
    if (manual === 'snap') manual = true;

    // pointer parallax + intro drift
    if (!reduced) {
      const k = 1 - Math.exp(-dt * 4);
      const dx = pointerX - px, dy = pointerY - py;
      if (Math.abs(dx) > 0.0005 || Math.abs(dy) > 0.0005) { px += dx * k; py += dy * k; busy = true; }
      if (introT < 7) { introT += real; busy = true; }
    }
    const drift = reduced ? 0 : -0.1 * (1 - ease(introT / 7));

    // drag-to-rotate momentum
    if (!dragging && (Math.abs(velYaw) > 1e-4 || Math.abs(velPitch) > 1e-4)) {
      const f = Math.exp(-dt * 5);
      userYaw += velYaw; userPitch = Math.max(-0.12, Math.min(0.75, userPitch + velPitch));
      velYaw *= f; velPitch *= f; busy = true;
    }

    // explode
    const e = clamp01((P - 0.15) / 0.45);
    let moved = false;
    if (Math.abs(e - exploded) > 1e-5) { applyExplode(e); moved = true; renderer.shadowMap.needsUpdate = true; }

    // part opacity (focus fade)
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const d = p.target - p.opacity;
      if (d === 0) continue;
      p.opacity = Math.abs(d) < 0.004 ? p.target : p.opacity + d * (reduced ? 1 : 1 - Math.exp(-dt * 9));
      if (p.opacity !== p.target) busy = true;
      const solid = p.opacity > 0.995;
      for (const o of p.meshes) {
        const m = o.material;
        // materials are per part, so this only touches this part
        m.opacity = m.userData.base * p.opacity;
        m.depthWrite = solid && m.userData.order === 0;
        o.visible = p.opacity > 0.02;
      }
    }

    // camera (the car slides right while a card is open so the card never covers it)
    const fd = (focus >= 0 ? 1 : 0) - fa;
    if (fd !== 0) { fa = Math.abs(fd) < 0.002 || reduced ? (focus >= 0 ? 1 : 0) : fa + fd * (1 - Math.exp(-dt * 6)); if (fa !== (focus >= 0 ? 1 : 0)) busy = true; }
    const c = smooth((P - 0.12) / 0.55);
    const dist = distA + (distE - distA) * c;
    const az = ((36 + 16 * c) * Math.PI) / 180 + drift + px * 0.06 + userYaw;
    const el = Math.max(0.02, Math.min(1.25, ((9 + 15 * c) * Math.PI) / 180 + py * 0.03 + userPitch));
    camTarget.set(0, midA.y + (midE.y - midA.y) * c, midA.z + (midE.z - midA.z) * c);
    const ce = Math.cos(el);
    camera.position.set(camTarget.x + Math.sin(az) * ce * dist, camTarget.y + Math.sin(el) * dist, camTarget.z + Math.cos(az) * ce * dist);
    camera.lookAt(camTarget);
    if (isMobile) camera.setViewOffset(W, H, 0, H * 0.2, W, H); else camera.setViewOffset(W, H, -W * (0.19 - 0.075 * c + 0.07 * fa), 0, W, H);
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);
    renders++;

    // overlay state (writes only)
    const h = clamp01((P - 0.04) / 0.2);
    if (Math.abs(h - hs) > 0.002) { hs = h; root.style.setProperty('--hs', h.toFixed(3)); headEl.classList.toggle('gone', h >= 1); }
    const lon = P >= 0.62;
    if (lon !== labelsOn) {
      labelsOn = lon; root.classList.toggle('labels-on', lon);
      if (!lon && focus >= 0) setFocus(-1);
      labelEls.forEach((el) => (el.tabIndex = lon ? 0 : -1));
    }
    if (P > 0.5) placeLabels();

    if (busy) request();
  }

  function request() {
    if (raf || !visible || !ready) return;
    raf = requestAnimationFrame(frame);
  }

  // ---------- input ----------
  const readScroll = () => {
    if (manual === true) return;
    const r = root.getBoundingClientRect();
    targetP = clamp01(-r.top / spanPx);
    request();
  };
  addEventListener('scroll', readScroll, { passive: true });

  if (!reduced) {
    stage.addEventListener('pointermove', (ev) => {
      if (ev.pointerType === 'touch' || dragging) return;
      pointerX = ev.clientX / W - 0.5; pointerY = ev.clientY / H - 0.5; request();
    }, { passive: true });
  }

  labelEls.forEach((el, i) => el.addEventListener('click', (ev) => { ev.stopPropagation(); setFocus(focus === i ? -1 : i); }));
  cards.forEach((c) => c.querySelector('.g-close').addEventListener('click', () => setFocus(-1)));
  addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && focus >= 0) setFocus(-1); });

  // click a part (only once exploded); raycast on click only, never per move
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let downX = 0, downY = 0;
  canvas.addEventListener('pointerdown', (ev) => { downX = ev.clientX; downY = ev.clientY; }, { passive: true });

  // drag to rotate (horizontal spins freely, vertical tilts within limits; touch keeps vertical page scroll)
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    dragging = true; dragId = ev.pointerId; dragX = ev.clientX; dragY = ev.clientY; velYaw = velPitch = 0;
    canvas.setPointerCapture?.(ev.pointerId);
    root.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!dragging || ev.pointerId !== dragId) return;
    const dx = ev.clientX - dragX, dy = ev.clientY - dragY;
    dragX = ev.clientX; dragY = ev.clientY;
    velYaw = -dx * 0.0065;
    velPitch = ev.pointerType === 'touch' ? 0 : dy * 0.004;
    userYaw += velYaw; userPitch = Math.max(-0.12, Math.min(0.75, userPitch + velPitch));
    if (Math.abs(dx) + Math.abs(dy) > 2) root.classList.add('rotated');
    request();
  });
  const endDrag = (ev) => {
    if (!dragging || ev.pointerId !== dragId) return;
    dragging = false; dragId = -1; root.classList.remove('dragging'); request();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('dblclick', () => { userYaw = 0; userPitch = 0; velYaw = velPitch = 0; request(); });
  canvas.addEventListener('click', (ev) => {
    if (Math.abs(ev.clientX - downX) + Math.abs(ev.clientY - downY) > 8) return;
    if (P < 0.62) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(meshes, false);
    for (const h of hits) {
      const part = parts[h.object.userData.part];
      if (part.opacity < 0.5) continue;
      if (part.sys >= 0) { setFocus(part.sys); return; }
    }
    setFocus(-1);
  });

  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible) { last = 0; readScroll(); request(); }
  }, { rootMargin: '100px 0px' }).observe(root);

  let rs = 0;
  new ResizeObserver(() => { cancelAnimationFrame(rs); rs = requestAnimationFrame(layout); }).observe(stage);
  mobileMQ.addEventListener?.('change', layout);

  // ---------- go ----------
  car.traverse((o) => { o.matrixAutoUpdate = true; });
  layout();
  readScroll();
  P = targetP;
  ready = true;
  applyExplode(clamp01((P - 0.15) / 0.45));
  // warm up shaders and upload textures once, behind the loading state
  renderer.compile(scene, camera);
  request();
  requestAnimationFrame(() => requestAnimationFrame(() => { root.classList.add('hero-ready'); loadEl?.remove(); }));

  window.__hero = {
    setP(p, instant = true) { manual = instant ? 'snap' : true; targetP = clamp01(p); request(); },
    scroll() { manual = false; readScroll(); },
    focus(i) { setFocus(i); },
    renders: () => renders,
    state: () => ({ P, e: exploded, focus, ready, labelsOn, R_A, R_E, distA, distE, userYaw, userPitch }),
    rotate(y, p = 0) { userYaw = y; userPitch = p; request(); },
  };
}

if (root && stage && canvas) {
  root.querySelector('.g-loading')?.classList.add('indet');
  start().catch(fail);
}
