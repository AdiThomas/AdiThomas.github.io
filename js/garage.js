// The garage: a JDM coupe (Vivid Blue Pearl, inspired by the RSX Type-S) that comes apart as you
// scroll. Every system of the car stands for one area of skills. All geometry is generated in code:
// the body is a set of lofted surfaces cut into real panels, everything else is primitives.
// Units are metres; +x is the nose, +y is up, +z is the passenger (right) side.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const section = document.getElementById('garage');
const canvas = document.getElementById('g-canvas');
if (section && canvas) init().catch((err) => { console.error('Garage failed to start', err); section.classList.remove('g-on'); });

async function init() {
  // ------------------------------------------------------------------ setup
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: /[?&]debug/.test(location.search) });
  } catch (_) { return; } // no WebGL: the static fallback stays
  section.classList.add('g-on');

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = () => innerWidth < 900;
  const lowPower = innerWidth < 700 || (navigator.hardwareConcurrency || 8) <= 4;
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1 : 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // redrawn only when parts move
  renderer.shadowMap.needsUpdate = true;

  try { await Promise.race([document.fonts.load('700 italic 80px "Chakra Petch"'), new Promise((r) => setTimeout(r, 1500))]); } catch (_) { /* fonts are optional */ }

  const scene = new THREE.Scene();
  const BG = new THREE.Color('#07090c');
  scene.background = BG;
  scene.fog = new THREE.Fog(BG, 16, 34);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 80);

  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const cr = (a, b, c, d, t) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);

  // ------------------------------------------------------------------ environment: a garage with hex lights
  // Only used for reflections, so the clearcoat picks up the hexagon grid like a detailing bay.
  {
    const env = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.BoxGeometry(34, 14, 34), new THREE.MeshBasicMaterial({ color: 0x06080b, side: THREE.BackSide }));
    room.position.y = 5;
    env.add(room);
    const edges = [];
    const R = 1.05;
    for (let q = -5; q <= 5; q++) for (let r = -5; r <= 5; r++) {
      const cx = R * 1.5 * q, cz = R * Math.sqrt(3) * (r + q / 2);
      if (Math.hypot(cx, cz) > 8.5) continue;
      for (let k = 0; k < 6; k++) {
        const a0 = (Math.PI / 3) * k, a1 = (Math.PI / 3) * (k + 1);
        const x0 = cx + R * Math.cos(a0), z0 = cz + R * Math.sin(a0), x1 = cx + R * Math.cos(a1), z1 = cz + R * Math.sin(a1);
        const g = new THREE.BoxGeometry(Math.hypot(x1 - x0, z1 - z0) * 0.86, 0.05, 0.09);
        g.rotateY(-Math.atan2(z1 - z0, x1 - x0));
        g.translate((x0 + x1) / 2, 7, (z0 + z1) / 2);
        edges.push(g);
      }
    }
    env.add(new THREE.Mesh(mergeGeometries(edges), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(2.6) })));
    const strip = (w, h, color, k, pos, rotY) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.copy(pos); m.rotation.y = rotY; env.add(m);
    };
    strip(14, 1.2, '#cfe0ff', 1.4, V(0, 2.6, -11), 0);
    strip(14, 1.2, '#cfe0ff', 1.6, V(0, 2.6, 11), 0);
    strip(1.2, 6, '#ff7a50', 0.5, V(-12, 2.5, 0), Math.PI / 2);
    strip(1.2, 6, '#ffffff', 1.2, V(12, 2.5, 0), Math.PI / 2);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(env, 0.015).texture;
    pm.dispose();
  }

  // ------------------------------------------------------------------ textures
  const tex = (w, h, draw, srgb = true) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  };
  const DISPLAY = '"Chakra Petch", "Arial Narrow", sans-serif';
  const MONO = '"JetBrains Mono", Consolas, monospace';

  const carbonTex = tex(128, 128, (g) => {
    g.fillStyle = '#121418'; g.fillRect(0, 0, 128, 128);
    const s = 16;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      const horiz = (i + j) % 4 < 2;
      const gr = horiz ? g.createLinearGradient(0, j * s, 0, j * s + s) : g.createLinearGradient(i * s, 0, i * s + s, 0);
      gr.addColorStop(0, '#0d0f12'); gr.addColorStop(0.5, '#2a2f37'); gr.addColorStop(1, '#0d0f12');
      g.fillStyle = gr; g.fillRect(i * s + 0.5, j * s + 0.5, s - 1, s - 1);
    }
  });
  carbonTex.wrapS = carbonTex.wrapT = THREE.RepeatWrapping;
  carbonTex.repeat.set(4, 4);

  const finTex = tex(64, 256, (g, w, h) => {
    g.fillStyle = '#7d848c'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) { g.fillStyle = y % 8 ? '#4a5058' : '#a9b0b8'; g.fillRect(0, y, w, 2); }
    for (let x = 0; x < w; x += 16) { g.fillStyle = '#2c3036'; g.fillRect(x, 0, 3, h); }
  });
  finTex.wrapS = finTex.wrapT = THREE.RepeatWrapping;
  finTex.repeat.set(8, 2);

  const rotorTex = tex(256, 256, (g) => {
    g.fillStyle = '#5c6168'; g.fillRect(0, 0, 256, 256);
    const grd = g.createRadialGradient(128, 128, 40, 128, 128, 128);
    grd.addColorStop(0, '#3a3e44'); grd.addColorStop(0.62, '#8a9098'); grd.addColorStop(1, '#5c6168');
    g.fillStyle = grd; g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#16181b';
    for (let k = 0; k < 30; k++) {
      const a = (k / 30) * Math.PI * 2;
      for (const rr of [78, 96, 112]) {
        const off = (rr - 78) * 0.012;
        g.beginPath(); g.arc(128 + Math.cos(a + off) * rr, 128 + Math.sin(a + off) * rr, 3.4, 0, Math.PI * 2); g.fill();
      }
    }
    g.strokeStyle = '#2a2d31'; g.lineWidth = 2;
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + 0.2; g.beginPath(); g.arc(128, 128, 102, a, a + 0.45); g.stroke(); }
    g.fillStyle = '#9aa0a8'; g.beginPath(); g.arc(128, 128, 62, 0, Math.PI * 2); g.fill();
  });

  const fabricTex = tex(128, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#0d0f13'); gr.addColorStop(0.55, '#141821'); gr.addColorStop(1, '#1a3fa8');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < w; x += 6) {
      const t = y / h; g.fillStyle = `rgba(90,140,255,${0.08 + t * t * 0.55})`;
      g.beginPath(); g.arc(x, y, 1.1 + t * 1.4, 0, Math.PI * 2); g.fill();
    }
  });

  const decal26 = (fill, stroke) => tex(256, 128, (g, w, h) => {
    g.font = `700 italic 112px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (stroke) { g.lineWidth = 8; g.strokeStyle = stroke; g.strokeText('26', w / 2, h / 2 + 6); }
    g.fillStyle = fill; g.fillText('26', w / 2, h / 2 + 6);
  });

  const valveTex = tex(512, 128, (g, w, h) => {
    g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, w, h);
    g.font = `700 italic 64px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#e8ebee'; g.fillText('K20 · i-VTEC', w / 2, h / 2 + 4);
  });

  const honeyTex = tex(128, 64, (g, w, h) => {
    g.fillStyle = '#020304'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2a2f36'; g.lineWidth = 1.4;
    const r = 4.2;
    for (let row = 0; row * r * 1.5 < h + r; row++) for (let col = 0; col * r * 1.732 < w + r; col++) {
      const cx = col * r * 1.732 + (row % 2 ? r * 0.866 : 0), cy = row * r * 1.5;
      g.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; g[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); g.stroke();
    }
  });
  honeyTex.wrapS = honeyTex.wrapT = THREE.RepeatWrapping;
  const plateTex = tex(256, 128, (g, w, h) => {
    g.fillStyle = '#f2f4f6'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1d3f9e'; g.lineWidth = 6; g.strokeRect(5, 5, w - 10, h - 10);
    g.fillStyle = '#1d3f9e'; g.font = `700 76px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('AT 26', w / 2, h / 2 + 8);
    g.font = `600 16px ${MONO}`; g.fillText('BUILD SHEET', w / 2, 22);
  });

  const bannerTex = tex(1024, 96, (g, w, h) => {
    g.fillStyle = 'rgba(8,10,14,0.92)'; g.fillRect(0, 0, w, h);
    g.font = `700 italic 66px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#e9ecef'; g.fillText('A · T H O M A S', w / 2, h / 2 + 4);
  });

  // Sidewall lettering, laid out for RingGeometry's planar UVs.
  const sidewallTex = (outer, mid) => tex(512, 512, (g, w) => {
    g.clearRect(0, 0, w, w);
    g.translate(w / 2, w / 2);
    g.font = `700 30px ${DISPLAY}`; g.fillStyle = 'rgba(200,205,212,0.55)'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const r = (mid / outer) * (w / 2);
    const text = 'AT-26 · TRACK SPEC · 215/45 R17 · ';
    const chars = (text + text).split('');
    const step = (Math.PI * 2) / chars.length;
    chars.forEach((ch, i) => { g.save(); g.rotate(i * step); g.translate(0, -r); g.fillText(ch, 0, 0); g.restore(); });
  });

  // Gauge cluster: redrawn when the rpm changes.
  const clusterCanvas = document.createElement('canvas');
  clusterCanvas.width = 512; clusterCanvas.height = 192;
  const clusterTex = new THREE.CanvasTexture(clusterCanvas);
  clusterTex.colorSpace = THREE.SRGBColorSpace;
  function drawCluster(rpm) {
    const g = clusterCanvas.getContext('2d');
    g.fillStyle = '#05070a'; g.fillRect(0, 0, 512, 192);
    const dial = (cx, cy, r, max, val, red, label, ticks) => {
      g.lineWidth = 3; g.strokeStyle = '#1d2a44'; g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25); g.stroke();
      const a = (v) => Math.PI * 0.75 + (v / max) * Math.PI * 1.5;
      if (red) { g.strokeStyle = '#ff2b2b'; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, r - 3, a(red), a(max)); g.stroke(); }
      g.fillStyle = '#9ec4ff'; g.font = `600 13px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let i = 0; i <= ticks; i++) {
        const v = (i / ticks) * max, an = a(v);
        g.strokeStyle = '#9ec4ff'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(cx + Math.cos(an) * (r - 12), cy + Math.sin(an) * (r - 12)); g.lineTo(cx + Math.cos(an) * (r - 3), cy + Math.sin(an) * (r - 3)); g.stroke();
        g.fillText(String(Math.round(v / (max > 1000 ? 1000 : 1))), cx + Math.cos(an) * (r - 24), cy + Math.sin(an) * (r - 24));
      }
      const an = a(val);
      g.strokeStyle = '#ff4d2e'; g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(cx - Math.cos(an) * 10, cy - Math.sin(an) * 10); g.lineTo(cx + Math.cos(an) * (r - 8), cy + Math.sin(an) * (r - 8)); g.stroke();
      g.fillStyle = '#ff4d2e'; g.beginPath(); g.arc(cx, cy, 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#5f7aa8'; g.font = `600 11px ${MONO}`; g.fillText(label, cx, cy + r * 0.45);
    };
    dial(110, 100, 84, 9000, rpm, 8100, 'x1000 RPM', 9);
    const speed = Math.round(rpm / 9000 * 160);
    dial(402, 100, 84, 240, speed, 0, 'KM/H', 6);
    g.textAlign = 'center';
    g.fillStyle = '#eaf2ff'; g.font = `700 40px ${DISPLAY}`; g.fillText(rpm > 5800 ? '3' : 'N', 256, 86);
    g.fillStyle = rpm > 5800 ? '#ffd23f' : '#23324d'; g.font = `700 16px ${MONO}`; g.fillText('VTEC', 256, 124);
    g.fillStyle = '#5f7aa8'; g.font = `600 11px ${MONO}`; g.fillText('TYPE-S', 256, 150);
    clusterTex.needsUpdate = true;
  }
  drawCluster(850);

  // ------------------------------------------------------------------ materials
  const PAINTS = { blue: '#1d4fe6' };
  const M = {
    paint: new THREE.MeshPhysicalMaterial({ color: PAINTS.blue, metalness: 0.45, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.16, sheen: 0.6, sheenRoughness: 0.35, sheenColor: new THREE.Color('#7fb2ff'), envMapIntensity: 1.25 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#0b1018', metalness: 0, roughness: 0.14, transparent: true, opacity: 0.62, envMapIntensity: 1.5 }),
    trim: new THREE.MeshStandardMaterial({ color: '#0c0d0f', roughness: 0.55, metalness: 0.2 }),
    gloss: new THREE.MeshPhysicalMaterial({ color: '#0a0b0d', roughness: 0.2, metalness: 0.3, clearcoat: 1 }),
    underbody: new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.85 }),
    carbon: new THREE.MeshPhysicalMaterial({ map: carbonTex, color: '#ffffff', roughness: 0.4, metalness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.08 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#131416', roughness: 0.88, metalness: 0 }),
    bronze: new THREE.MeshStandardMaterial({ color: '#a07a3c', roughness: 0.28, metalness: 1 }),
    alu: new THREE.MeshStandardMaterial({ color: '#c3c8ce', roughness: 0.28, metalness: 1 }),
    aluDark: new THREE.MeshStandardMaterial({ color: '#6b7179', roughness: 0.42, metalness: 0.9 }),
    steel: new THREE.MeshStandardMaterial({ color: '#9aa0a7', roughness: 0.22, metalness: 1 }),
    crinkleRed: new THREE.MeshStandardMaterial({ color: '#b0161b', roughness: 0.62, metalness: 0.25 }),
    caliper: new THREE.MeshPhysicalMaterial({ color: '#d1161d', roughness: 0.3, metalness: 0.2, clearcoat: 1 }),
    spring: new THREE.MeshPhysicalMaterial({ color: '#e5383b', roughness: 0.32, metalness: 0.3, clearcoat: 0.8 }),
    gold: new THREE.MeshStandardMaterial({ color: '#d4a64a', roughness: 0.25, metalness: 1 }),
    hose: new THREE.MeshStandardMaterial({ color: '#1f5fff', roughness: 0.55, metalness: 0 }),
    cage: new THREE.MeshPhysicalMaterial({ color: '#3b4048', roughness: 0.45, metalness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
    fabric: new THREE.MeshStandardMaterial({ map: fabricTex, roughness: 0.9 }),
    seatShell: new THREE.MeshStandardMaterial({ color: '#0f1115', roughness: 0.7 }),
    harness: new THREE.MeshStandardMaterial({ color: '#d42a2a', roughness: 0.75 }),
    dash: new THREE.MeshStandardMaterial({ color: '#16181c', roughness: 0.8 }),
    filter: new THREE.MeshStandardMaterial({ color: '#c91e24', roughness: 0.85 }),
    ti: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 1 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#e6e9ec', roughness: 0.08, metalness: 1 }),
    fin: new THREE.MeshStandardMaterial({ map: finTex, roughness: 0.45, metalness: 0.8 }),
    rotorFace: new THREE.MeshStandardMaterial({ map: rotorTex, roughness: 0.45, metalness: 0.85 }),
    rotorEdge: new THREE.MeshStandardMaterial({ color: '#4c5157', roughness: 0.5, metalness: 0.85 }),
    head: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#dfe9ff', emissiveIntensity: 0.15, roughness: 0.1, metalness: 0.6 }),
    lens: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.02, metalness: 0, transparent: true, opacity: 0.1, clearcoat: 1, envMapIntensity: 2 }),
    tailLens: new THREE.MeshPhysicalMaterial({ color: '#7a0710', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.55, clearcoat: 1, envMapIntensity: 1.6 }),
    tail: new THREE.MeshStandardMaterial({ color: '#2a0204', emissive: '#ff0010', emissiveIntensity: 0.6, roughness: 0.42 }),
    led: new THREE.MeshStandardMaterial({ color: '#0a1a10', emissive: '#3ddc84', emissiveIntensity: 14 }),
    gauge: new THREE.MeshStandardMaterial({ map: clusterTex, emissiveMap: clusterTex, emissive: '#ffffff', emissiveIntensity: 1.3, roughness: 0.3 }),
    flame: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff8a3d').multiplyScalar(16), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  };
  M.paint.userData.paint = true;
  M.head.userData.glow = 'head';
  M.tail.userData.glow = 'tail';
  M.led.userData.glow = 'led';
  M.gauge.userData.glow = 'gauge';
  for (const m of Object.values(M)) m.side = THREE.DoubleSide;
  const decalMat = (map, opts = {}) => new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.45, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false, side: THREE.DoubleSide, ...opts });

  // ------------------------------------------------------------------ geometry helpers
  const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
  const rbox = (w, h, d, r, mat, x, y, z) => mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2) * 0.999), mat, x, y, z);
  const cyl = (rt, rb, len, mat, axis = 'y', seg = 32) => {
    const g = new THREE.CylinderGeometry(rt, rb, len, seg);
    if (axis === 'x') g.rotateZ(-Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    return new THREE.Mesh(g, mat);
  };
  const rod = (a, b, r, mat, seg = 10) => {
    const d = b.clone().sub(a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), seg), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
    return m;
  };
  const tube = (pts, r, mat, seg = 64, radial = 10, closed = false) =>
    new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), seg, r, radial, closed), mat);
  // Burnt titanium: gold to purple to blue along the length of a tube.
  const tiColor = (geo, flip = false) => {
    const uv = geo.attributes.uv, cols = [];
    const stops = [new THREE.Color('#c9a25a'), new THREE.Color('#8a4fd6'), new THREE.Color('#2f6bff'), new THREE.Color('#9aa3ad')];
    for (let i = 0; i < uv.count; i++) {
      let u = clamp(uv.getX(i)); if (flip) u = 1 - u;
      const s = u * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(s));
      const c = stops[k].clone().lerp(stops[k + 1], s - k);
      cols.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    return geo;
  };

  // A lofted surface described by cross-sections along x. Each section is a superellipse:
  // w = full width, yt/yb = top/bottom, n = squareness, tumble = how much the top pinches in.
  function surface(secs, crease = null) {
    const S = secs.map((s) => ({ z: 0, n: 4, tumble: 0, ...s })).map((s) => ({ nb: s.n, ...s })).sort((a, b) => a.x - b.x);
    const keys = ['w', 'yt', 'yb', 'z', 'n', 'nb', 'tumble'];
    const at = (x) => {
      let i = 0;
      while (i < S.length - 2 && x > S[i + 1].x) i++;
      const a = S[Math.max(0, i - 1)], b = S[i], c = S[i + 1], d = S[Math.min(S.length - 1, i + 2)];
      const t = clamp((x - b.x) / (c.x - b.x));
      const o = { x };
      for (const k of keys) o[k] = cr(a[k], b[k], c[k], d[k], t);
      return o;
    };
    const point = (s, th, out) => {
      const c = Math.cos(th), si = Math.sin(th), e = 2 / (si < 0 ? s.nb : s.n);
      const py = Math.sign(si) * Math.pow(Math.abs(si), e);
      const pz = Math.sign(c) * Math.pow(Math.abs(c), e);
      const zs = 1 - s.tumble * Math.max(0, py);
      let k = 1;
      if (crease) { const a = Math.min(Math.abs(th - crease.t), Math.abs(th - (Math.PI - crease.t))); k += crease.h(s.x) * Math.exp(-((a / crease.w) ** 2)) - crease.h(s.x) * 0.35 * Math.exp(-(((a - crease.w * 1.6) / crease.w) ** 2)); }
      return out.set(s.x, (s.yt + s.yb) / 2 + ((s.yt - s.yb) / 2) * py * k, s.z + (s.w / 2) * pz * zs * k);
    };
    return { at, point, S };
  }

  const ARCHES = [[1.3, 0.325, 0.358], [-1.27, 0.325, 0.358]]; // [x, centre y, radius]
  function archCut(v) {
    if (Math.abs(v.z) < 0.5) return;
    for (const [xw, yc, R] of ARCHES) {
      const dx = v.x - xw;
      if (Math.abs(dx) < R) { const ya = yc + Math.sqrt(R * R - dx * dx); if (v.y < ya) v.y = ya; }
    }
  }

  // One panel of a surface: x0..x1 along the car, t0..t1 around the section (0 = right side, PI/2 = top).
  function patch(surf, x0, x1, t0, t1, o = {}) {
    const gap = o.gap ?? 0.006, tg = o.tgap ?? 0.004;
    const xa = Math.min(x0, x1) + gap, xb = Math.max(x0, x1) - gap;
    const T0 = typeof t0 === 'function' ? t0 : () => t0, T1 = typeof t1 === 'function' ? t1 : () => t1;
    const TA = (x) => T0(x) + tg, TB = (x) => T1(x) - tg;
    const nx = Math.max(2, Math.ceil((xb - xa) * (o.dx ?? 56)));
    let span = 0;
    for (let i = 0; i <= 8; i++) { const x = lerp(xa, xb, i / 8); span = Math.max(span, TB(x) - TA(x)); }
    const nt = Math.max(2, Math.ceil((span / (Math.PI * 2)) * (o.dt ?? 104)));
    const pos = [], uv = [], idx = [], ctr = [];
    const v = new THREE.Vector3();
    for (let i = 0; i <= nx; i++) {
      const x = lerp(xa, xb, i / nx), s = surf.at(x), ta = TA(x), tb = TB(x);
      for (let j = 0; j <= nt; j++) {
        surf.point(s, lerp(ta, tb, j / nt), v);
        if (o.arch) archCut(v);
        pos.push(v.x, v.y, v.z); uv.push(i / nx, j / nt); ctr.push((s.yt + s.yb) / 2, s.z);
      }
    }
    for (let i = 0; i < nx; i++) for (let j = 0; j < nt; j++) {
      const a = i * (nt + 1) + j, b = a + nt + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const cap = (x) => {
      const s = surf.at(x), base = pos.length / 3, ta = TA(x), tb = TB(x);
      pos.push(x, (s.yt + s.yb) / 2, s.z); uv.push(0.5, 0.5); ctr.push((s.yt + s.yb) / 2, s.z);
      for (let j = 0; j <= nt; j++) { surf.point(s, lerp(ta, tb, j / nt), v); pos.push(v.x, v.y, v.z); uv.push(0.5, 0.5); ctr.push((s.yt + s.yb) / 2, s.z); }
      for (let j = 0; j < nt; j++) idx.push(base, base + 1 + j, base + 2 + j);
    };
    if (o.cap0) cap(xa);
    if (o.cap1) cap(xb);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (o.inflate) {
      const p = g.attributes.position, n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        const ry = p.getY(i) - ctr[i * 2], rz = p.getZ(i) - ctr[i * 2 + 1];
        const sgn = Math.sign(n.getY(i) * ry + n.getZ(i) * rz) || 1;
        p.setXYZ(i, p.getX(i) + n.getX(i) * o.inflate * sgn, p.getY(i) + n.getY(i) * o.inflate * sgn, p.getZ(i) + n.getZ(i) * o.inflate * sgn);
      }
      p.needsUpdate = true;
    }
    return g;
  }

  // ------------------------------------------------------------------ the systems
  const SYS = [
    { key: 'chassis', name: 'Chassis', anchor: 'cage', view: [0.85, 0.42], frame: ['cage', 'seatL', 'seatR', 'shell'] },
    { key: 'engine', name: 'Engine', anchor: 'engine', view: [0.55, 0.38], frame: ['engine', 'intake'] },
    { key: 'body', name: 'Body', anchor: 'doorR', view: [0.75, 0.3] },
    { key: 'ecu', name: 'ECU & cockpit', anchor: 'ecu', view: [0.25, 0.3] },
    { key: 'cooling', name: 'Cooling', anchor: 'radiator', view: [0.5, 0.3] },
    { key: 'gearbox', name: 'Gearbox', anchor: 'gearbox', view: [-0.6, 0.4] },
    { key: 'wheels', name: 'Wheels & brakes', anchor: 'wheelFR', view: [1.05, 0.2], frame: ['wheelFR', 'brakeFR'] },
    { key: 'susp', name: 'Suspension', anchor: 'coiloverFR', view: [0.95, 0.42] },
  ].map((s) => ({ ...s, parts: [], solids: [], ghosts: [], mats: new Map(), g: 0, hover: 0 }));
  const S = Object.fromEntries(SYS.map((s, i) => [s.key, i]));

  const car = new THREE.Group();
  scene.add(car);
  const parts = [];
  const byName = {};
  // Register a part: objects are authored in car space; the part's origin becomes its centre.
  function part(sysKey, name, objects, offset = [0, 0, 0], o = {}) {
    const grp = new THREE.Group();
    objects.forEach((ob) => grp.add(ob));
    const c = new THREE.Box3().setFromObject(grp).getCenter(new THREE.Vector3());
    grp.children.forEach((ch) => ch.position.sub(c));
    grp.position.copy(c);
    car.add(grp);
    const p = { name, grp, home: c.clone(), offset: V(...offset), delay: o.delay ?? 0.2, rot: o.rot ?? [0, 0, 0], spin: o.spin, sys: S[sysKey], phase: Math.random() * Math.PI * 2, shake: !!o.shake };
    SYS[p.sys].parts.push(p);
    parts.push(p);
    byName[name] = p;
    return p;
  }

  // ------------------------------------------------------------------ body
  // Sections traced from a DC5 side elevation and scaled to the real car: 4374 mm long, 2570 mm
  // wheelbase, 1725 mm wide, about 1400 mm tall. yt is the hood line up front and the body's crown
  // under the glass; the greenhouse sits on the shoulder.
  const body = surface([
    { x: 2.235, w: 0.84, yt: 0.5, yb: 0.33, n: 2.8, nb: 2.6 },
    { x: 2.2, w: 1.16, yt: 0.6, yb: 0.245, n: 3.1, nb: 2.8 },
    { x: 2.12, w: 1.43, yt: 0.69, yb: 0.2, n: 3.4, nb: 3 },
    { x: 2.0, w: 1.6, yt: 0.765, yb: 0.19, n: 3.6, nb: 3 },
    { x: 1.8, w: 1.69, yt: 0.845, yb: 0.18, n: 3.8, nb: 3 },
    { x: 1.5, w: 1.725, yt: 0.915, yb: 0.17, n: 3.9, nb: 3 },
    { x: 1.2, w: 1.725, yt: 0.975, yb: 0.165, n: 4, nb: 3 },
    { x: 1.0, w: 1.725, yt: 1.005, yb: 0.165, n: 4, nb: 3 },
    { x: 0.6, w: 1.725, yt: 0.99, yb: 0.165, n: 4, nb: 3 },
    { x: 0.0, w: 1.725, yt: 1.0, yb: 0.165, n: 4, nb: 3 },
    { x: -0.6, w: 1.725, yt: 1.025, yb: 0.165, n: 4, nb: 3 },
    { x: -1.0, w: 1.725, yt: 1.05, yb: 0.17, n: 4, nb: 3 },
    { x: -1.5, w: 1.71, yt: 1.1, yb: 0.185, n: 4, nb: 3 },
    { x: -1.85, w: 1.68, yt: 1.145, yb: 0.21, n: 3.8, nb: 3 },
    { x: -2.05, w: 1.62, yt: 1.15, yb: 0.255, n: 4, nb: 3 },
    { x: -2.15, w: 1.57, yt: 1.12, yb: 0.27, n: 4.2, nb: 3.2 },
    { x: -2.2, w: 1.5, yt: 1.04, yb: 0.3, n: 4, nb: 3.2 },
    { x: -2.222, w: 1.3, yt: 0.9, yb: 0.36, n: 3.4, nb: 3 },
    { x: -2.228, w: 0.9, yt: 0.72, yb: 0.44, n: 3, nb: 3 },
  ], { t: 0.5, w: 0.05, h: (x) => 0.011 * smooth(1.95, 1.55, x) * smooth(-2.12, -1.85, x) });
  // Height of the body's upper surface at a given half-width (the shoulder the glass sits on).
  const shoulderY = (x, z) => {
    const s = body.at(x), pz = clamp(Math.abs(z) / (s.w / 2), 0, 0.999);
    return (s.yt + s.yb) / 2 + ((s.yt - s.yb) / 2) * Math.pow(1 - Math.pow(pz, s.n), 1 / s.n);
  };
  // Angle on a body section where the greenhouse meets it.
  const shoulderT = (x, z) => { const s = body.at(x); return Math.acos(Math.pow(clamp(Math.abs(z) / (s.w / 2), 0, 0.999), s.n / 2)); };
  const GH = [
    [1.0, 1.44, 1.0], [0.8, 1.44, 1.1], [0.6, 1.43, 1.21], [0.4, 1.42, 1.3], [0.2, 1.41, 1.375], [0.0, 1.4, 1.41],
    [-0.4, 1.38, 1.43], [-0.7, 1.36, 1.415], [-0.95, 1.34, 1.385], [-1.2, 1.3, 1.31], [-1.5, 1.24, 1.22], [-1.7, 1.18, 1.165], [-1.9, 1.1, 1.13],
  ];
  const gh = surface(GH.map(([x, w, roof]) => {
    const belt = shoulderY(x, w / 2);
    return { x, w, yt: Math.max(roof, belt + 0.01), yb: 2 * belt - Math.max(roof, belt + 0.01), n: 3.6, tumble: 0.2 };
  }));
  const ghW = (x) => gh.at(x).w;

  const PI = Math.PI, TOP = PI / 2;
  const L = (r) => (typeof r[0] === 'function' || typeof r[1] === 'function')
    ? [(x) => PI - (typeof r[1] === 'function' ? r[1](x) : r[1]), (x) => PI - (typeof r[0] === 'function' ? r[0](x) : r[0])]
    : [PI - r[1], PI - r[0]];
  const P = (surf, x0, x1, t, mat, o) => mesh(patch(surf, x0, x1, t[0], t[1], o), mat);
  const ramp = (x, pts) => { // piecewise-linear lookup, pts sorted by x ascending: [[x, v], ...]
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) return lerp(pts[i - 1][1], pts[i][1], (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]));
    return pts[pts.length - 1][1];
  };
  // Surface frame: position and outward normal at (x, angle).
  const surfFrame = (surf, x, th) => {
    const p = surf.point(surf.at(x), th, new THREE.Vector3());
    const a = surf.point(surf.at(x + 0.004), th, new THREE.Vector3()), b = surf.point(surf.at(x), th + 0.004, new THREE.Vector3());
    const n = a.sub(p).cross(b.sub(p)).normalize();
    const s = surf.at(x);
    if (n.y * (p.y - (s.yt + s.yb) / 2) + n.z * (p.z - s.z) < 0) n.negate();
    return { p, n };
  };
  const onSurface = (obj, surf, x, th, lift = 0) => {
    const { p, n } = surfFrame(surf, x, th);
    obj.position.copy(p).addScaledVector(n, lift);
    obj.quaternion.setFromUnitVectors(V(0, 0, 1), n);
    return obj;
  };

  const flareTex = tex(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
  const headFlares = [], tailFlares = [];
  const flare = (color, size, list) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTex, color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); sp.scale.setScalar(size); sp.raycast = () => {}; list.push(sp); return sp; };
  // Key lines on the body
  const hoodHalf = (x) => ramp(x, [[1.0, 0.86], [1.7, 0.74], [2.12, 0.56], [2.21, 0.46]]); // hood band, radians either side of the top
  const hoodEdge = (x) => TOP - hoodHalf(x);
  const hlLow = (x) => ramp(x, [[1.68, 0.86], [1.78, 0.56], [1.9, 0.38], [2.02, 0.3], [2.12, 0.34], [2.19, 0.52], [2.21, 0.86]]);
  const doorTop = (x) => shoulderT(x, ghW(clamp(x, -1.89, 0.99)) / 2);
  const roofT = 0.78; // roof band edge on the greenhouse
  const aPillar = (x) => ramp(x, [[0.05, roofT], [1.0, 0.06]]);
  const qTop = (x) => ramp(x, [[-1.02, 0.04], [-0.58, roofT - 0.06]]); // rear quarter window, a triangle

  // Shell (stays put): rear quarters, sills, the crown under the glass, underbody, roof, pillars, glass.
  const shellObjs = [
    P(body, -2.0, -0.48, [-0.62, (x) => (x < -1.9 ? 0.76 : doorTop(x))], M.paint, { arch: true }),
    P(body, -2.0, -0.48, L([-0.62, (x) => (x < -1.9 ? 0.76 : doorTop(x))]), M.paint, { arch: true }),
    P(body, -0.96, 0.95, [-0.92, -0.62], M.paint),
    P(body, -0.96, 0.95, L([-0.92, -0.62]), M.paint),
    P(body, -0.94, 0.93, [-1.12, -0.92], M.trim, { inflate: 0.004, gap: 0 }),
    P(body, -0.94, 0.93, L([-1.12, -0.92]), M.trim, { inflate: 0.004, gap: 0 }),
    P(body, -1.9, 1.0, [0.4, PI - 0.4], M.paint, { gap: 0 }),
    P(body, -1.98, 1.95, [PI + 0.9, 2 * PI - 0.9], M.underbody, { gap: 0 }),
    // glass all round, then the opaque bits laid over it
    P(gh, -1.9, 1.0, [-0.05, PI + 0.05], M.glass, { gap: 0, tgap: 0 }),
    P(gh, -0.95, 0.05, [roofT, PI - roofT], M.paint, { inflate: 0.004, gap: 0.002 }),
    P(gh, 0.05, 1.0, [(x) => aPillar(x) - 0.05, aPillar], M.paint, { inflate: 0.004, gap: 0, tgap: 0 }),
    P(gh, 0.05, 1.0, L([(x) => aPillar(x) - 0.05, aPillar]), M.paint, { inflate: 0.004, gap: 0, tgap: 0 }),
    P(gh, -0.95, 0.05, [roofT - 0.05, roofT], M.trim, { inflate: 0.005, gap: 0, tgap: 0 }),
    P(gh, -0.95, 0.05, L([roofT - 0.05, roofT]), M.trim, { inflate: 0.005, gap: 0, tgap: 0 }),
    P(gh, -0.58, -0.48, [0, roofT], M.trim, { inflate: 0.005, gap: 0, tgap: 0 }),
    P(gh, -0.58, -0.48, L([0, roofT]), M.trim, { inflate: 0.005, gap: 0, tgap: 0 }),
    P(gh, -1.9, -0.58, [(x) => (x < -1.02 ? -0.05 : qTop(x)), roofT], M.paint, { inflate: 0.005, gap: 0, tgap: 0 }),
    P(gh, -1.9, -0.58, L([(x) => (x < -1.02 ? -0.05 : qTop(x)), roofT]), M.paint, { inflate: 0.005, gap: 0, tgap: 0 }),
    P(gh, -1.02, 0.98, [-0.05, 0.02], M.trim, { inflate: 0.006, gap: 0, tgap: 0 }),
    P(gh, -1.02, 0.98, L([-0.05, 0.02]), M.trim, { inflate: 0.006, gap: 0, tgap: 0 }),
  ];
  // wheel-arch liners
  for (const [xw, yc, R] of ARCHES) for (const sd of [1, -1]) {
    const g = new THREE.CylinderGeometry(R - 0.008, R - 0.008, 0.32, 32, 1, true, 0, PI);
    g.rotateX(PI / 2);
    shellObjs.push(mesh(g, M.trim, xw, yc, sd * 0.7));
  }
  // firewall, carpet, dash, console
  shellObjs.push(rbox(0.03, 0.55, 1.36, 0.01, M.underbody, 1.0, 0.5, 0));
  shellObjs.push(rbox(2.4, 0.02, 1.4, 0.01, M.dash, -0.35, 0.2, 0));
  shellObjs.push(rbox(0.36, 0.2, 1.44, 0.06, M.dash, 0.78, 0.82, 0));
  shellObjs.push(rbox(0.5, 0.18, 0.2, 0.04, M.dash, 0.32, 0.32, 0));
  part('chassis', 'shell', shellObjs, [0, 0, 0], { delay: 0 });

  // Hood: wide at the windshield, narrowing to a point between the headlights
  part('body', 'hood', [P(body, 1.0, 2.205, [hoodEdge, (x) => PI - hoodEdge(x)], M.paint)], [0.3, 1.6, 0], { delay: 0.02, rot: [0, 0, 0.22] });

  // Front bumper: wraps from below one headlight, under the nose, to the other; small grille under the hood tip
  const meshMat = (rep) => { const t = honeyTex.clone(); t.needsUpdate = true; t.repeat.set(rep, rep / 3); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0.3, side: THREE.DoubleSide }); };
  const bumperTop = (x) => (x < 2.205 ? hlLow(x) : hoodEdge(x));
  const fogLens = new THREE.MeshPhysicalMaterial({ color: '#eef2f6', emissive: '#fff6e0', emissiveIntensity: 0.15, roughness: 0.05, clearcoat: 1, side: THREE.DoubleSide });
  const fog = (sd) => {
    const g = new THREE.Group();
    g.add(cyl(0.05, 0.05, 0.02, M.trim, 'z', 24));
    const lens = cyl(0.04, 0.04, 0.012, fogLens, 'z', 24); lens.position.z = 0.012; g.add(lens);
    return onSurface(g, body, 2.13, sd > 0 ? -0.62 : PI + 0.62, 0.004);
  };
  part('body', 'bumperF', [
    P(body, 1.68, 2.235, [(x) => -PI - bumperTop(x), bumperTop], M.paint, { cap1: true, arch: true }),
    P(body, 2.2, 2.235, [(x) => hoodEdge(x) + 0.02, (x) => PI - hoodEdge(x) - 0.02], meshMat(5), { cap1: true, gap: 0.002, inflate: -0.002 }),
    P(body, 2.12, 2.235, [-PI / 2 - 0.82, -PI / 2 + 0.82], meshMat(9), { inflate: 0.003, gap: 0.004, cap1: true }),
    fog(1), fog(-1),
  ], [1.05, 0, 0], { delay: 0.08 });

  // Front fenders: from the door to the bumper, up to the hood line, cut round the arch
  const fenderTop = (x) => (x > 1.68 ? hlLow(x) : hoodEdge(x));
  part('body', 'fenderR', [P(body, 0.95, 1.68, [-0.62, fenderTop], M.paint, { arch: true }), P(body, 1.62, 2.0, [(x) => (x > 1.68 ? hlLow(x) : hoodEdge(x)), hoodEdge], M.paint, { gap: 0.003 })], [0.1, 0.12, 0.95], { delay: 0.1, rot: [0, -0.1, 0] });
  part('body', 'fenderL', [P(body, 0.95, 1.68, L([-0.62, fenderTop]), M.paint, { arch: true }), P(body, 1.62, 2.0, L([(x) => (x > 1.68 ? hlLow(x) : hoodEdge(x)), hoodEdge]), M.paint, { gap: 0.003 })], [0.1, 0.12, -0.95], { delay: 0.1, rot: [0, 0.1, 0] });

  // Doors: long, with frameless-look glass, a mirror on the sail and a handle
  const mirror = (sd) => {
    const g = new THREE.Group();
    const housing = rbox(0.11, 0.075, 0.17, 0.035, M.paint, 0, 0, sd * 0.09); housing.rotation.y = sd * -0.08; g.add(housing);
    const glassM = rbox(0.008, 0.058, 0.14, 0.004, M.chrome, -0.056, 0, sd * 0.09); g.add(glassM);
    g.add(rbox(0.07, 0.03, 0.07, 0.01, M.trim, 0.0, -0.025, sd * 0.01));
    const y = shoulderY(0.82, 0.74);
    g.position.set(0.8, y + 0.045, sd * 0.79);
    return g;
  };
  const handle = (sd) => { const zz = body.point(body.at(-0.3), sd > 0 ? 0.42 : PI - 0.42, new THREE.Vector3()); return rbox(0.11, 0.022, 0.02, 0.008, M.trim, -0.3, zz.y, zz.z + sd * 0.006); };
  const doorGlassTop = (x) => (x > 0.05 ? aPillar(x) - 0.05 : roofT - 0.05);
  part('body', 'doorR', [P(body, -0.48, 0.95, [-0.62, doorTop], M.paint), P(gh, -0.48, 0.95, [0.02, doorGlassTop], M.glass, { inflate: 0.003, gap: 0.004 }), mirror(1), handle(1)], [0, 0.08, 1.3], { delay: 0.14, rot: [0, -0.28, 0] });
  part('body', 'doorL', [P(body, -0.48, 0.95, L([-0.62, doorTop]), M.paint), P(gh, -0.48, 0.95, L([0.02, doorGlassTop]), M.glass, { inflate: 0.003, gap: 0.004 }), mirror(-1), handle(-1)], [0, 0.08, -1.3], { delay: 0.14, rot: [0, 0.28, 0] });

  // Hatch: big rear glass, the tail panel between the lamps, plate, and the Type-S spoiler
  const plate = mesh(new THREE.PlaneGeometry(0.34, 0.17), decalMat(plateTex, { transparent: false, depthWrite: true }), 0, 0, 0);
  plate.position.set(-2.236, 0.52, 0); plate.rotation.set(0, -PI / 2, 0);
  const rsxTex = tex(256, 64, (g, w, h) => { g.font = `700 italic 40px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#d9dde2'; g.fillText('TYPE-S', w / 2, h / 2 + 2); });
  const badge = mesh(new THREE.PlaneGeometry(0.16, 0.04), decalMat(rsxTex), -2.234, 0.8, -0.3); badge.rotation.y = -PI / 2;
  const spoiler = (() => {
    const sh = new THREE.Shape(), N = 18, c = 0.2, t = 0.13;
    const th = (x) => 5 * t * c * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    for (let i = 0; i <= N; i++) { const x = (1 - Math.cos((i / N) * PI)) / 2; sh[i ? 'lineTo' : 'moveTo'](-x * c, th(x)); }
    for (let i = N; i >= 0; i--) { const x = (1 - Math.cos((i / N) * PI)) / 2; sh.lineTo(-x * c, -th(x) * 0.5); }
    const g = new THREE.ExtrudeGeometry(sh, { depth: 1.22, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 1 });
    g.translate(0, 0, -0.61);
    const geo = mergeVertices(g, 1e-4); geo.computeVertexNormals();
    const grp = new THREE.Group();
    const blade = mesh(geo, M.paint); blade.rotation.z = -0.05; grp.add(blade);
    const brake = rbox(0.012, 0.012, 0.42, 0.004, M.tail, -0.2, 0.004, 0); grp.add(brake);
    for (const sd of [1, -1]) grp.add(rbox(0.08, 0.05, 0.03, 0.01, M.paint, -0.1, -0.035, sd * 0.46));
    grp.position.set(-1.87, 1.185, 0);
    return grp;
  })();
  part('body', 'hatch', [
    P(gh, -1.9, -0.95, [roofT, PI - roofT], M.glass, { inflate: 0.006, gap: 0.004 }),
    P(body, -2.228, -1.9, [0.76, PI - 0.76], M.paint, { cap0: true }),
    P(body, -2.2282, -2.2262, [-PI, PI], M.paint, { cap0: true, gap: 0, tgap: 0 }),
    badge, spoiler,
  ], [-0.6, 1.1, 0], { delay: 0.04, rot: [0, 0, -0.35] });

  // Rear bumper: one wrap from shoulder to shoulder under the tail
  part('body', 'bumperR', [
    plate,
    P(body, -2.228, -2.0, [-PI - 0.1, 0.1], M.paint, { cap0: true, arch: true }),
    P(body, -2.21, -2.04, [-PI / 2 - 0.9, -PI / 2 + 0.9], M.trim, { inflate: 0.006, gap: 0 }),
  ], [-1.0, -0.02, 0], { delay: 0.08 });

  // Headlights: almond-shaped clear lens over a dark housing with three projector bowls
  const reflector = new THREE.MeshStandardMaterial({ color: '#c9ced4', roughness: 0.22, metalness: 1, side: THREE.DoubleSide });
  const lamp = (sd) => {
    const rng = sd > 0 ? [hlLow, hoodEdge] : L([hlLow, hoodEdge]);
    const objs = [
      P(body, 1.69, 2.205, rng, M.lens, { inflate: 0.012, gap: 0.004, tgap: 0.01 }),
      P(body, 1.69, 2.205, rng, reflector, { inflate: 0.001, gap: 0.006, tgap: 0.012 }),
    ];
    for (const [x, t, r] of [[2.09, 0.5, 0.05], [1.97, 0.55, 0.046], [1.85, 0.66, 0.034]]) {
      const g = new THREE.Group();
      const bowl = mesh(new THREE.SphereGeometry(r, 24, 12, 0, PI * 2, 0, PI / 2), M.chrome); bowl.rotation.x = -PI / 2; bowl.scale.z = 0.6; g.add(bowl);
      const lens = mesh(new THREE.SphereGeometry(r * 0.5, 20, 12), M.head); lens.scale.z = 0.5; lens.position.z = r * 0.25; g.add(lens);
      objs.push(onSurface(g, body, x, sd > 0 ? t : PI - t, -0.012));
      const fl = flare('#dfeaff', r * 9, headFlares); onSurface(fl, body, x, sd > 0 ? t : PI - t, 0.05); objs.push(fl);
    }
    return objs;
  };
  part('body', 'lampR', lamp(1), [0.75, 0.5, 0.3], { delay: 0.12 });
  part('body', 'lampL', lamp(-1), [0.75, 0.5, -0.3], { delay: 0.12 });

  // Taillights: red lens on each rear corner with three round lamps
  const tl = (sd) => {
    const t0 = 0.1, t1 = 0.74;
    const objs = [
      P(body, -2.226, -1.98, sd > 0 ? [t0, t1] : L([t0, t1]), M.tailLens, { inflate: 0.008, gap: 0.004 }),
      P(body, -2.228, -1.98, sd > 0 ? [t0, t1] : L([t0, t1]), M.gloss, { inflate: 0.002, gap: 0.002 }),
    ];
    for (const [x, t, r] of [[-2.224, 0.56, 0.06], [-2.21, 0.36, 0.06], [-2.13, 0.2, 0.04]]) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 8, 32), M.chrome));
      const d = mesh(new THREE.CircleGeometry(r * 0.92, 28), M.tail); d.position.z = -0.002; g.add(d);
      objs.push(onSurface(g, body, x, sd > 0 ? t : PI - t, 0.004));
      const fl = flare('#ff1a2a', r * 6, tailFlares); onSurface(fl, body, x, sd > 0 ? t : PI - t, 0.03); objs.push(fl);
    }
    return objs;
  };
  part('body', 'tailR', tl(1), [-0.8, 0.5, 0.3], { delay: 0.12 });
  part('body', 'tailL', tl(-1), [-0.8, 0.5, -0.3], { delay: 0.12 });

  // ------------------------------------------------------------------ interior & cage (chassis)
  const seat = (z) => {
    const objs = [
      rbox(0.5, 0.08, 0.46, 0.03, M.fabric, -0.12, 0.27, z),
      rbox(0.44, 0.12, 0.06, 0.03, M.seatShell, -0.12, 0.33, z + 0.22),
      rbox(0.44, 0.12, 0.06, 0.03, M.seatShell, -0.12, 0.33, z - 0.22),
    ];
    const back = new THREE.Group();
    back.add(rbox(0.08, 0.66, 0.46, 0.03, M.fabric, 0, 0.33, 0));
    back.add(rbox(0.12, 0.42, 0.06, 0.03, M.seatShell, 0.03, 0.28, 0.23));
    back.add(rbox(0.12, 0.42, 0.06, 0.03, M.seatShell, 0.03, 0.28, -0.23));
    back.add(rbox(0.1, 0.07, 0.1, 0.02, M.trim, 0.0, 0.53, 0));
    for (const dz of [-0.09, 0.09]) back.add(rbox(0.01, 0.55, 0.05, 0.004, M.harness, 0.05, 0.3, dz));
    back.position.set(-0.36, 0.28, z); back.rotation.z = 0.2;
    objs.push(back);
    return objs;
  };
  part('chassis', 'seatL', seat(-0.37), [0, 1.3, -0.15], { delay: 0.38 });
  part('chassis', 'seatR', seat(0.37), [0, 1.3, 0.15], { delay: 0.38 });
  {
    const c = [];
    const r = 0.02;
    const hoop = (x, w, top) => [V(x, 0.21, w), V(x, 0.9, w * 1.0), V(x, top - 0.04, w * 0.78), V(x, top, 0), V(x, top - 0.04, -w * 0.78), V(x, 0.9, -w), V(x, 0.21, -w)];
    c.push(tube(hoop(-0.55, 0.62, 1.26), r, M.cage, 80));
    for (const s of [1, -1]) {
      c.push(tube([V(-0.55, 1.22, s * 0.48), V(0.1, 1.2, s * 0.52), V(0.5, 1.02, s * 0.6), V(0.82, 0.62, s * 0.64), V(0.85, 0.22, s * 0.64)], r, M.cage, 60));
      c.push(tube([V(-0.55, 1.18, s * 0.5), V(-1.0, 0.9, s * 0.55), V(-1.45, 0.42, s * 0.58)], r, M.cage, 40));
      c.push(rod(V(-0.55, 0.45, s * 0.62), V(0.8, 0.45, s * 0.64), r * 0.9, M.cage));
    }
    c.push(rod(V(-0.55, 0.25, 0.6), V(-0.55, 1.2, -0.45), r * 0.9, M.cage));
    c.push(rod(V(0.1, 1.2, 0.52), V(0.1, 1.2, -0.52), r * 0.9, M.cage));
    part('chassis', 'cage', c, [-0.3, 2.05, 0], { delay: 0.3 });
  }

  // ------------------------------------------------------------------ engine (transverse K20)
  {
    const e = [];
    e.push(rbox(0.36, 0.34, 0.56, 0.03, M.aluDark, 1.42, 0.38, 0.02));
    e.push(rbox(0.32, 0.12, 0.55, 0.02, M.alu, 1.42, 0.6, 0.02));
    e.push(rbox(0.28, 0.08, 0.5, 0.03, M.crinkleRed, 1.42, 0.69, 0.02));
    const vd = mesh(new THREE.PlaneGeometry(0.42, 0.105), decalMat(valveTex), 1.42, 0.732, 0.02);
    vd.rotation.set(-PI / 2, 0, PI / 2);
    e.push(vd);
    // intake runners into a polished plenum
    for (const z of [-0.18, -0.06, 0.06, 0.18]) e.push(tube([V(1.58, 0.58, z + 0.02), V(1.67, 0.665, z + 0.02), V(1.77, 0.64, z + 0.02), V(1.82, 0.55, z + 0.02)], 0.024, M.alu, 24, 12));
    const plenum = cyl(0.07, 0.07, 0.5, M.alu, 'z'); plenum.position.set(1.82, 0.5, 0.02); e.push(plenum);
    const tb = cyl(0.045, 0.045, 0.07, M.aluDark, 'z'); tb.position.set(1.82, 0.5, -0.27); e.push(tb);
    // exhaust header, burnt titanium
    for (const z of [-0.18, -0.06, 0.06, 0.18]) {
      const m = tube([V(1.25, 0.57, z + 0.02), V(1.13, 0.53, z + 0.02), V(1.06, 0.4, z * 0.55), V(1.08, 0.27, 0.0), V(1.1, 0.2, 0.0)], 0.02, M.ti, 40, 10);
      tiColor(m.geometry); e.push(m);
    }
    // accessory drive on the right end
    for (const [x, y, r] of [[1.4, 0.27, 0.07], [1.52, 0.5, 0.045], [1.34, 0.5, 0.05]]) { const p = cyl(r, r, 0.03, M.alu, 'z'); p.position.set(x, y, 0.34); e.push(p); }
    e.push(tube([V(1.4, 0.195, 0.355), V(1.48, 0.23, 0.355), V(1.57, 0.5, 0.355), V(1.52, 0.548, 0.355), V(1.34, 0.553, 0.355), V(1.29, 0.5, 0.355), V(1.33, 0.25, 0.355)], 0.006, M.rubber, 60, 6, true));
    const of = cyl(0.04, 0.04, 0.1, M.filter, 'x'); of.position.set(1.62, 0.25, 0.18); e.push(of);
    part('engine', 'engine', e, [0.3, 0.95, 0], { delay: 0.3, shake: true });

    // cold-air intake
    const ci = [];
    ci.push(tube([V(1.82, 0.5, -0.3), V(1.86, 0.5, -0.45), V(1.86, 0.43, -0.57), V(1.76, 0.37, -0.66)], 0.04, M.alu, 30, 14));
    const cone = cyl(0.05, 0.075, 0.17, M.filter, 'x'); cone.position.set(1.66, 0.37, -0.66); ci.push(cone);
    part('engine', 'intake', ci, [0.55, 1.0, -0.6], { delay: 0.34 });

    // exhaust system to a single big titanium tip
    const ex = [];
    ex.push(tube([V(1.1, 0.2, 0), V(1.02, 0.14, 0.05), V(0.4, 0.13, 0.12), V(-0.9, 0.14, 0.22), V(-1.55, 0.2, 0.38)], 0.03, M.steel, 80, 10));
    const muff = cyl(0.085, 0.085, 0.4, M.steel, 'x'); muff.position.set(-1.78, 0.26, 0.42); ex.push(muff);
    const tip = cyl(0.058, 0.058, 0.26, M.ti, 'x', 28); tiColor(tip.geometry, true); tip.position.set(-2.12, 0.27, 0.44); ex.push(tip);
    const tipIn = cyl(0.045, 0.045, 0.02, M.trim, 'x', 24); tipIn.position.set(-2.246, 0.27, 0.44); ex.push(tipIn);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 16, 1, true), M.flame);
    flame.geometry.rotateZ(PI / 2); flame.position.set(-2.4, 0.27, 0.44); ex.push(flame);
    part('engine', 'exhaust', ex, [0, -0.6, 0], { delay: 0.2 });
  }

  // ------------------------------------------------------------------ gearbox & shifter
  {
    const g = [];
    const bell = cyl(0.17, 0.14, 0.13, M.aluDark, 'z'); bell.position.set(1.38, 0.37, -0.33); g.push(bell);
    g.push(rbox(0.32, 0.28, 0.24, 0.05, M.aluDark, 1.34, 0.34, -0.5));
    const diff = cyl(0.1, 0.1, 0.14, M.alu, 'z'); diff.position.set(1.3, 0.31, -0.33); g.push(diff);
    g.push(tube([V(1.3, 0.48, -0.45), V(1.05, 0.36, -0.3), V(0.6, 0.24, -0.05), V(0.42, 0.28, 0)], 0.01, M.trim, 40, 6));
    part('gearbox', 'gearbox', g, [0.05, 0.45, -1.0], { delay: 0.32 });
    const ax = [];
    for (const [a, b] of [[V(1.3, 0.31, -0.42), V(1.3, 0.31, -0.62)], [V(1.3, 0.31, -0.2), V(1.3, 0.31, 0.62)]]) {
      ax.push(rod(a, b, 0.018, M.steel));
      for (const p of [a, b]) { const boot = cyl(0.032, 0.022, 0.07, M.rubber, 'z', 14); boot.position.copy(p); ax.push(boot); }
    }
    part('gearbox', 'axles', ax, [0, -0.4, 0], { delay: 0.36 });
    const knob = mesh(new THREE.SphereGeometry(0.032, 24, 16), M.ti, 0.37, 0.62, 0);
    tiColor(knob.geometry);
    part('gearbox', 'shifter', [rod(V(0.42, 0.3, 0), V(0.37, 0.6, 0), 0.008, M.chrome), knob, (() => { const b = cyl(0.02, 0.05, 0.08, M.rubber, 'y', 16); b.position.set(0.41, 0.42, 0); return b; })()], [0.05, 1.05, 0], { delay: 0.42 });
  }

  // ------------------------------------------------------------------ cooling
  {
    const r = [];
    r.push(rbox(0.05, 0.34, 1.0, 0.01, M.fin, 1.98, 0.45, 0));
    for (const s of [1, -1]) r.push(rbox(0.06, 0.36, 0.05, 0.01, M.trim, 1.98, 0.45, s * 0.52));
    r.push(rbox(0.035, 0.32, 0.9, 0.01, M.trim, 1.93, 0.45, 0));
    for (const z of [-0.22, 0.22]) { const f = cyl(0.14, 0.14, 0.02, M.gloss, 'x'); f.position.set(1.905, 0.45, z); r.push(f); const hub = cyl(0.03, 0.03, 0.04, M.aluDark, 'x'); hub.position.set(1.9, 0.45, z); r.push(hub); }
    r.push(tube([V(1.96, 0.6, 0.38), V(1.75, 0.66, 0.36), V(1.55, 0.64, 0.3)], 0.022, M.hose, 30, 10));
    r.push(tube([V(1.96, 0.3, -0.38), V(1.75, 0.22, -0.3), V(1.55, 0.25, -0.18)], 0.022, M.hose, 30, 10));
    part('cooling', 'radiator', r, [0.8, 0.4, 0], { delay: 0.22 });
    part('cooling', 'oilcooler', [rbox(0.04, 0.12, 0.3, 0.01, M.fin, 2.07, 0.3, 0.52), tube([V(2.05, 0.3, 0.36), V(1.85, 0.24, 0.3), V(1.62, 0.25, 0.2)], 0.01, M.steel, 20, 6)], [1.0, 0.1, 0.45], { delay: 0.26 });
  }

  // ------------------------------------------------------------------ ECU & cockpit
  {
    const ecu = [rbox(0.22, 0.05, 0.16, 0.01, M.aluDark, 0.82, 0.62, 0.3), rbox(0.012, 0.012, 0.012, 0.003, M.led, 0.705, 0.635, 0.36),
      tube([V(0.82, 0.6, 0.22), V(0.9, 0.55, 0.1), V(0.94, 0.6, -0.1)], 0.008, new THREE.MeshStandardMaterial({ color: '#b46cff', roughness: 0.5, side: THREE.DoubleSide }), 20, 6)];
    part('ecu', 'ecu', ecu, [0.1, 0.65, 0.8], { delay: 0.44 });
    const face = mesh(new THREE.PlaneGeometry(0.33, 0.124), M.gauge, 0, 0, 0);
    face.rotation.y = -PI / 2;
    const cl = new THREE.Group();
    cl.add(rbox(0.1, 0.15, 0.38, 0.03, M.dash, 0.04, 0, 0));
    face.position.set(-0.012, 0, 0); cl.add(face);
    cl.position.set(0.66, 0.9, -0.37); cl.rotation.z = 0.22;
    part('ecu', 'cluster', [cl], [0.25, 1.15, -0.5], { delay: 0.4 });
    const sw = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 14, 48), M.seatShell);
    rim.rotation.y = PI / 2; sw.add(rim);
    for (const a of [PI / 2 + 0.0, PI * 1.25 + 0.2, -PI * 0.25 - 0.2]) {
      const sp = rbox(0.012, 0.16, 0.035, 0.005, M.aluDark, 0, Math.sin(a) * 0.08, Math.cos(a) * 0.08);
      sp.rotation.x = -a + PI / 2; sw.add(sp);
    }
    sw.add(cyl(0.04, 0.04, 0.05, M.dash, 'x', 20));
    sw.add(rbox(0.006, 0.02, 0.03, 0.003, M.cage, -0.03, 0.17, 0));
    sw.position.set(0.44, 0.78, -0.37); sw.rotation.z = 0.35;
    part('ecu', 'wheel', [sw, rod(V(0.48, 0.77, -0.37), V(0.7, 0.66, -0.37), 0.014, M.aluDark)], [-0.05, 0.85, -0.6], { delay: 0.42 });
  }

  // ------------------------------------------------------------------ corners
  const W = { r0: 0.216, r1: 0.31, hw: 0.107 };
  const tyreGeo = (() => {
    const prof = [], rm = (W.r0 + W.r1) / 2, a = (W.r1 - W.r0) / 2;
    for (let i = 0; i <= 64; i++) {
      const th = (i / 64) * PI * 2, c = Math.cos(th), s = Math.sin(th);
      prof.push(new THREE.Vector2(rm + a * Math.sign(c) * Math.abs(c) ** (2 / 6), W.hw * Math.sign(s) * Math.abs(s) ** (2 / 6)));
    }
    const g = new THREE.LatheGeometry(prof, 72);
    g.rotateX(PI / 2);
    return g;
  })();
  const barrelGeo = (() => {
    const pts = [[0.19, -0.1], [0.2, -0.1], [0.214, -0.096], [0.215, -0.082], [0.2, -0.072], [0.198, 0.06], [0.214, 0.084], [0.218, 0.1], [0.208, 0.106], [0.19, 0.102]];
    const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 72);
    g.rotateX(PI / 2);
    return g;
  })();
  const spokeGeo = (() => {
    const sh = new THREE.Shape();
    sh.moveTo(-0.016, 0.05); sh.lineTo(0.016, 0.05); sh.lineTo(0.012, 0.198); sh.lineTo(-0.012, 0.198); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3 });
    return g;
  })();
  const sidewall = sidewallTex(W.r1 - 0.012, (W.r0 + W.r1) / 2 + 0.008);
  const sidewallMat = decalMat(sidewall, { roughness: 0.7 });
  const rotorGeo = new THREE.CylinderGeometry(0.165, 0.165, 0.026, 48); rotorGeo.rotateX(PI / 2);
  const caliperGeo = (() => {
    const sh = new THREE.Shape();
    sh.absarc(0, 0, 0.19, PI * 0.58, PI * 0.95, false);
    sh.absarc(0, 0, 0.125, PI * 0.95, PI * 0.58, true);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 3, curveSegments: 16 });
    g.translate(0, 0, -0.035);
    return g;
  })();

  function corner(name, x, z) {
    const s = Math.sign(z);
    const piv = new THREE.Group();
    piv.add(new THREE.Mesh(tyreGeo, M.rubber));
    const rimG = new THREE.Group();
    rimG.add(new THREE.Mesh(barrelGeo, M.bronze));
    for (let k = 0; k < 5; k++) for (const off of [-0.105, 0.105]) { const sp = new THREE.Mesh(spokeGeo, M.bronze); sp.position.z = 0.055; sp.rotation.z = (k / 5) * PI * 2 + off; rimG.add(sp); }
    const hub = cyl(0.065, 0.07, 0.04, M.bronze, 'z', 32); hub.position.z = 0.07; rimG.add(hub);
    const cap = cyl(0.032, 0.032, 0.02, M.gloss, 'z', 24); cap.position.z = 0.092; rimG.add(cap);
    for (let k = 0; k < 5; k++) { const a = (k / 5) * PI * 2 + PI / 5; const n = cyl(0.008, 0.008, 0.025, M.chrome, 'z', 8); n.position.set(Math.cos(a) * 0.048, Math.sin(a) * 0.048, 0.092); rimG.add(n); }
    piv.add(rimG);
    const ring = new THREE.Mesh(new THREE.RingGeometry(W.r0 + 0.02, W.r1 - 0.012, 96, 1), sidewallMat);
    ring.position.z = W.hw + 0.002; piv.add(ring);
    piv.position.set(x, 0.31, z);
    if (s < 0) piv.rotation.y = PI;
    part('wheels', 'wheel' + name, [piv], [0, 0, s * 1.3], { delay: 0.18, spin: piv });

    const br = new THREE.Group();
    const rotor = new THREE.Mesh(rotorGeo, [M.rotorEdge, M.rotorFace, M.rotorFace]);
    rotor.position.z = -0.03; br.add(rotor);
    const hat = cyl(0.075, 0.075, 0.05, M.alu, 'z', 28); hat.position.z = -0.01; br.add(hat);
    const cal = new THREE.Mesh(caliperGeo, M.caliper); cal.position.z = -0.03; br.add(cal);
    br.add(rbox(0.1, 0.24, 0.05, 0.02, M.aluDark, 0, 0, -0.085));
    br.position.set(x, 0.31, z);
    if (s < 0) br.rotation.y = PI;
    part('wheels', 'brake' + name, [br], [0, 0, s * 0.78], { delay: 0.26 });
  }
  corner('FR', 1.3, 0.745); corner('FL', 1.3, -0.745); corner('RR', -1.27, 0.745); corner('RL', -1.27, -0.745);

  // ------------------------------------------------------------------ suspension
  const helix = (len, r, turns) => { const pts = []; for (let i = 0; i <= turns * 16; i++) { const t = i / (turns * 16); pts.push(V(Math.cos(t * turns * PI * 2) * r, (t - 0.5) * len, Math.sin(t * turns * PI * 2) * r)); } return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 40, 0.008, 8); };
  function coilover(name, a, b) {
    const g = new THREE.Group();
    const len = a.distanceTo(b);
    g.add(cyl(0.026, 0.026, len * 0.62, M.gold, 'y', 18)).position.y = -len * 0.16;
    g.add(cyl(0.011, 0.011, len * 0.5, M.chrome, 'y', 10)).position.y = len * 0.22;
    g.add(new THREE.Mesh(helix(len * 0.5, 0.045, 7), M.spring)).position.y = len * 0.12;
    g.add(cyl(0.055, 0.055, 0.012, M.alu, 'y', 24)).position.y = -len * 0.14;
    g.add(cyl(0.06, 0.06, 0.03, M.aluDark, 'y', 24)).position.y = len * 0.42;
    g.position.copy(a).add(b).multiplyScalar(0.5);
    g.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
    const s = Math.sign(a.z);
    part('susp', 'coilover' + name, [g], [0, 0.35, s * 0.42], { delay: 0.3 });
  }
  coilover('FR', V(1.29, 0.24, 0.58), V(1.24, 0.74, 0.5));
  coilover('FL', V(1.29, 0.24, -0.58), V(1.24, 0.74, -0.5));
  coilover('RR', V(-1.27, 0.24, 0.56), V(-1.24, 0.7, 0.5));
  coilover('RL', V(-1.27, 0.24, -0.56), V(-1.24, 0.7, -0.5));
  {
    const f = [];
    for (const s of [1, -1]) {
      f.push(rod(V(1.48, 0.2, s * 0.26), V(1.3, 0.19, s * 0.62), 0.016, M.trim));
      f.push(rod(V(1.08, 0.2, s * 0.26), V(1.3, 0.19, s * 0.62), 0.016, M.trim));
      f.push(rod(V(1.6, 0.2, s * 0.3), V(1.0, 0.2, s * 0.3), 0.022, M.trim));
    }
    f.push(rod(V(1.6, 0.2, 0.3), V(1.6, 0.2, -0.3), 0.022, M.trim));
    f.push(rod(V(1.0, 0.2, 0.3), V(1.0, 0.2, -0.3), 0.022, M.trim));
    f.push(tube([V(1.12, 0.26, -0.55), V(1.05, 0.24, -0.4), V(1.05, 0.24, 0.4), V(1.12, 0.26, 0.55)], 0.012, M.cage, 30, 8));
    part('susp', 'subframeF', f, [0, -0.55, 0], { delay: 0.34 });
    const r = [];
    for (const s of [1, -1]) {
      r.push(rod(V(-0.75, 0.3, s * 0.56), V(-1.27, 0.25, s * 0.6), 0.02, M.trim));
      r.push(rod(V(-1.27, 0.2, s * 0.15), V(-1.27, 0.2, s * 0.6), 0.016, M.trim));
      r.push(rod(V(-1.2, 0.42, s * 0.15), V(-1.25, 0.44, s * 0.58), 0.014, M.trim));
    }
    r.push(rbox(0.12, 0.08, 1.0, 0.02, M.trim, -1.27, 0.24, 0));
    r.push(tube([V(-1.05, 0.28, -0.55), V(-1.15, 0.27, -0.4), V(-1.15, 0.27, 0.4), V(-1.05, 0.28, 0.55)], 0.011, M.cage, 30, 8));
    part('susp', 'subframeR', r, [0, -0.55, 0], { delay: 0.34 });
  }

  // ------------------------------------------------------------------ per-system materials, ghosts, shadows
  const ghostVert = 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }';
  const ghostFrag = 'uniform float uO; uniform vec3 uC; uniform vec3 uR; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4); gl_FragColor = vec4(mix(uC, uR, f), (0.035 + 0.55 * f) * uO); }';
  let partCount = 0;
  SYS.forEach((sys, i) => {
    sys.ghostMat = new THREE.ShaderMaterial({ uniforms: { uO: { value: 0 }, uC: { value: new THREE.Color('#3d6fd8') }, uR: { value: new THREE.Color('#bcd4ff') } }, vertexShader: ghostVert, fragmentShader: ghostFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const meshes = [];
    sys.parts.forEach((p) => p.grp.traverse((o) => { if (o.isMesh) meshes.push(o); }));
    meshes.forEach((m) => {
      const conv = (mat) => {
        let c = sys.mats.get(mat.uuid);
        if (!c) {
          c = mat.clone();
          c.userData = { ...mat.userData, baseOpacity: mat.opacity, baseTransparent: mat.transparent, baseDepthWrite: mat.depthWrite, baseEmissive: c.emissive ? c.emissive.clone() : null, baseEI: c.emissiveIntensity };
          sys.mats.set(mat.uuid, c);
        }
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
      const isTransparent = (Array.isArray(m.material) ? m.material[0] : m.material).transparent;
      m.castShadow = !isTransparent;
      m.receiveShadow = true;
      m.userData.sys = i;
      sys.solids.push(m);
      if (!isTransparent) { const gm = new THREE.Mesh(m.geometry, sys.ghostMat); gm.visible = false; gm.raycast = () => {}; m.add(gm); sys.ghosts.push(gm); }
    });
    partCount += sys.parts.length;
  });
  const flameMat = SYS[S.engine].mats.get(M.flame.uuid);
  const paintMats = SYS.flatMap((s) => [...s.mats.values()].filter((m) => m.userData.paint));
  const glowMats = (kind) => SYS.flatMap((s) => [...s.mats.values()].filter((m) => m.userData.glow === kind));
  const headMats = glowMats('head'), tailMats = glowMats('tail'), gaugeMats = glowMats('gauge');

  const framed = (sys) => (sys.frame ? sys.frame.map((n) => byName[n]) : sys.parts);
  // Exploded bounds per system, used to frame the camera.
  const LIFT = 0.6;
  parts.forEach((p) => p.grp.position.copy(p.home).add(p.offset));
  car.position.y = LIFT;
  car.updateMatrixWorld(true);
  const exBox = new THREE.Box3().setFromObject(car);
  SYS.forEach((sys) => {
    const b = new THREE.Box3();
    framed(sys).forEach((p) => b.expandByObject(p.grp));
    sys.radius = b.getBoundingSphere(new THREE.Sphere()).radius;
  });
  parts.forEach((p) => p.grp.position.copy(p.home));
  car.position.y = 0;
  const exCenter = exBox.getCenter(new THREE.Vector3());
  const exRadius = exBox.getBoundingSphere(new THREE.Sphere()).radius;

  // assembly guide lines (dashed, from home to current position)
  const guideMat = new THREE.LineDashedMaterial({ color: '#5f7aa8', dashSize: 0.05, gapSize: 0.04, transparent: true, opacity: 0, depthWrite: false });
  parts.forEach((p) => {
    if (p.offset.lengthSq() < 1e-4) return;
    const g = new THREE.BufferGeometry().setFromPoints([p.home.clone(), p.home.clone()]);
    p.guide = new THREE.Line(g, guideMat);
    p.guide.frustumCulled = false;
    car.add(p.guide);
  });

  // ------------------------------------------------------------------ lights & floor
  scene.add(new THREE.HemisphereLight('#9fb8ff', '#0b0d10', 0.35));
  const key = new THREE.DirectionalLight('#ffffff', 2.4);
  key.position.set(4, 9, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(lowPower ? 1024 : 1536, lowPower ? 1024 : 1536);
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 25 });
  key.shadow.bias = -0.0008; key.shadow.normalBias = 0.035;
  scene.add(key);
    const fill = new THREE.DirectionalLight('#dfe8ff', 0.35); fill.position.set(-3, 2, 7); scene.add(fill);
  const beams = [0.42, -0.42].map((z) => {
    const l = new THREE.SpotLight('#eaf2ff', 0, 14, 0.42, 0.6, 1.2);
    l.position.set(2.1, 0.62, z); l.target.position.set(7, 0, z * 1.6);
    car.add(l); car.add(l.target);
    return l;
  });

  const floorMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uC: { value: new THREE.Color('#2a3446') }, uA: { value: new THREE.Color('#ff5a36') } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform vec3 uC; uniform vec3 uA; varying vec3 vW;
      float grid(vec2 p, float s, float w){ vec2 q = p / s; vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q); return 1.0 - min(min(g.x, g.y) / w, 1.0); }
      void main(){ float d = length(vW.xz); float f = 1.0 - smoothstep(3.0, 13.0, d);
        float a = grid(vW.xz, 0.5, 1.0) * 0.28 + grid(vW.xz, 2.5, 1.4) * 0.55;
        float bay = 0.0;
        vec3 col = mix(uC, uA, bay);
        gl_FragColor = vec4(col, (a + bay) * f * 0.55); }`,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorMat);
  floor.rotation.x = -PI / 2; floor.position.y = 0.001;
  scene.add(floor);
  const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.6 }));
  shadowFloor.rotation.x = -PI / 2; shadowFloor.receiveShadow = true;
  scene.add(shadowFloor);
  const glowTex = tex(256, 256, (g) => { const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(7, 4.2), new THREE.MeshBasicMaterial({ map: glowTex, color: M.paint.color.clone(), transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.rotation.x = -PI / 2; glow.position.y = 0.003;
  scene.add(glow);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.6), new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color('#dfeaff'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  pool.rotation.x = -PI / 2; pool.position.set(4.2, 0.004, 0);
  scene.add(pool);
  const ringFx = new THREE.Mesh(new THREE.RingGeometry(0.98, 1, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color('#9ec4ff').multiplyScalar(2), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  ringFx.rotation.x = -PI / 2; ringFx.position.y = 0.005;
  scene.add(ringFx);

  const composer = null, bloom = null;

  // ------------------------------------------------------------------ DOM
  const $ = (id) => document.getElementById(id);
  const head = $('g-head'), cue = $('g-scroll'), next = $('g-next');
  const sysNav = $('g-systems'), tagsEl = $('g-tags'), leader = $('g-leader');
  const sysBtns = [...sysNav.querySelectorAll('button')];
  const cards = [...document.querySelectorAll('.g-card')];
  const rpmEl = $('g-rpm'), vtecEl = $('g-vtec');
  const countEl = $('g-count');
  if (countEl) countEl.textContent = String(partCount);
  cards.forEach((c) => {
    const sys = SYS[Number(c.dataset.sys)];
    const list = c.querySelector('[data-parts]');
    if (sys && list) list.textContent = `${sys.parts.length} parts`;
  });
  const tags = SYS.map((s, i) => {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'g-tag'; el.tabIndex = -1;
    el.innerHTML = `<i></i><b>${String(i + 1).padStart(2, '0')}</b>${s.name}`;
    el.addEventListener('click', () => focusSys(i));
    el.addEventListener('pointerenter', () => { hoverSys = i; });
    el.addEventListener('pointerleave', () => { if (hoverSys === i) hoverSys = -1; });
    tagsEl.appendChild(el);
    return el;
  });
  const NS = 'http://www.w3.org/2000/svg';
  const leadPath = document.createElementNS(NS, 'path');
  const leadDot = document.createElementNS(NS, 'circle'); leadDot.setAttribute('r', '4');
  const leadRing = document.createElementNS(NS, 'circle'); leadRing.setAttribute('r', '10'); leadRing.setAttribute('class', 'ring');
  leader.append(leadPath, leadRing, leadDot);

  const LABELS = { shell: 'Unibody shell', hood: 'Hood', bumperF: 'Front bumper + lip', fenderR: 'Front fender', fenderL: 'Front fender', doorR: 'Door + mirror', doorL: 'Door + mirror', hatch: 'Hatch + rear glass', wing: 'GT wing', bumperR: 'Rear bumper', lampR: 'Projector headlight', lampL: 'Projector headlight', tailR: 'Taillight', tailL: 'Taillight', seatL: 'Bucket seat + harness', seatR: 'Bucket seat + harness', cage: 'Roll cage', engine: 'K20 engine', intake: 'Cold-air intake', exhaust: 'Cat-back exhaust', gearbox: '6-speed gearbox', axles: 'Driveshafts', shifter: 'Short shifter', radiator: 'Radiator + fans', oilcooler: 'Oil cooler', ecu: 'ECU', cluster: 'Gauge cluster', wheel: 'Steering wheel', subframeF: 'Front subframe', subframeR: 'Rear subframe' };
  const labelOf = (p) => LABELS[p.name] || (p.name.startsWith('wheel') ? '17" wheel + tyre' : p.name.startsWith('brake') ? 'Drilled rotor + caliper' : p.name.startsWith('coilover') ? 'Coilover' : p.name);
  const partByGrp = new Map(parts.map((p) => [p.grp, p]));
  const tip = document.createElement('div');
  tip.className = 'g-tip';
  section.querySelector('.g-stage').appendChild(tip);

  // ------------------------------------------------------------------ engine note (only after a click on Rev)
  let audio = null;
  function engineAudio() {
    if (audio) return audio;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const out = ctx.createGain(); out.gain.value = 0; out.connect(ctx.destination);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 3; lp.connect(out);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.6); }
    shaper.curve = curve; shaper.connect(lp);
    const oscs = [[1, 'sawtooth', 0.42], [2, 'square', 0.12], [0.5, 'sawtooth', 0.3], [4, 'sawtooth', 0.05]].map(([m, type, g]) => {
      const o = ctx.createOscillator(); o.type = type;
      const gn = ctx.createGain(); gn.gain.value = g;
      o.connect(gn); gn.connect(shaper); o.start();
      return { o, m };
    });
    const pop = () => {
      const len = Math.floor(ctx.sampleRate * 0.5), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() < 0.012 ? (Math.random() * 2 - 1) * (1 - i / len) : 0;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.8;
      const g = ctx.createGain(); g.gain.value = 0.55;
      src.connect(bp); bp.connect(g); g.connect(ctx.destination); src.start();
    };
    audio = { ctx, out, lp, oscs, pop, live: 0, popped: false };
    return audio;
  }

  // ------------------------------------------------------------------ state
  let W0 = 1, H0 = 1;
  let pTarget = 0, pNow = 0;
  let focus = -1, focusAmt = 0, hoverSys = -1, focusTime = 0;
  let dragYaw = 0, dragPitch = 0, dragging = false, lastInteract = 0, velYaw = 0;
  let lights = false, lightAmt = 0;
  let rpm = 850, revT = -1, lastDrawnRpm = 0, popT = -1;
  let ringT = -1, wasExploded = false;
  let visible = true, running = false;
  const paintTarget = M.paint.color.clone();
  let offX = 0, offY = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    W0 = Math.max(1, Math.round(r.width)); H0 = Math.max(1, Math.round(r.height));
    renderer.setSize(W0, H0, false);
    composer?.setSize(W0, H0);
    bloom?.resolution.set(W0 / 2, H0 / 2);
    camera.aspect = W0 / H0;
    leader.setAttribute('viewBox', `0 0 ${W0} ${H0}`);
  }
  function readScroll() {
    const r = section.getBoundingClientRect();
    const span = r.height - innerHeight;
    pTarget = span > 0 ? clamp(-r.top / span) : 0;
  }
  const scrollToP = (p) => {
    const top = section.getBoundingClientRect().top + scrollY;
    const span = section.offsetHeight - innerHeight;
    scrollTo({ top: top + span * p, behavior: reduced ? 'auto' : 'smooth' });
  };

  function focusSys(i) {
    if (i === focus || i < 0) { focus = -1; } else { focus = i; }
    focusTime = performance.now();
    if (focus >= 0 && pTarget < 0.5) scrollToP(0.56);
    lastInteract = performance.now();
    syncUI();
  }
  function syncUI() {
    sysBtns.forEach((b, i) => { b.classList.toggle('on', i === focus); b.setAttribute('aria-pressed', String(i === focus)); });
    cards.forEach((c) => c.classList.toggle('on', Number(c.dataset.sys) === focus));
    section.classList.toggle('g-focused', focus >= 0);
    requestAnimationFrame(() => measureLead());
  }
  sysBtns.forEach((b, i) => {
    b.addEventListener('click', () => focusSys(i));
    b.addEventListener('pointerenter', () => { hoverSys = i; });
    b.addEventListener('pointerleave', () => { if (hoverSys === i) hoverSys = -1; });
  });
  cards.forEach((c) => c.querySelector('.g-close')?.addEventListener('click', () => focusSys(-1)));
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && focus >= 0) focusSys(-1);
    if (!sectionInView()) return;
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && focus >= 0 && !e.target.closest?.('input, textarea')) {
      if (document.activeElement && document.activeElement.id === 'track') return;
      focusSys((focus + (e.key === 'ArrowRight' ? 1 : SYS.length - 1)) % SYS.length);
    }
  });
  const sectionInView = () => { const r = section.getBoundingClientRect(); return r.top < innerHeight * 0.5 && r.bottom > innerHeight * 0.5; };

  // paint
  document.querySelectorAll('.g-swatch').forEach((sw) => sw.addEventListener('click', () => {
    document.querySelectorAll('.g-swatch').forEach((o) => o.setAttribute('aria-pressed', String(o === sw)));
    paintTarget.set(sw.dataset.color);
    const nameEl = $('g-paint-name'); if (nameEl) nameEl.textContent = sw.dataset.name;
    const pearl = Number(sw.dataset.pearl ?? 0.35);
    paintMats.forEach((m) => { m.sheen = pearl * 3; m.sheenColor.set(sw.dataset.sheen || '#ffffff'); m.metalness = Number(sw.dataset.metal ?? 0.45); });
  }));
  $('g-lights')?.addEventListener('click', (e) => { lights = !lights; e.currentTarget.setAttribute('aria-pressed', String(lights)); });
  $('g-rev')?.addEventListener('click', () => { revT = 0; const a = engineAudio(); if (a) { a.ctx.resume(); a.live = 1; } });

  // pointer: drag to orbit, hover to highlight, click to focus
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pickables = SYS.flatMap((s) => s.solids);
  let downX = 0, downY = 0, lastX = 0, moved = 0, lastPick = 0;
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, false).find((h) => h.object.visible && SYS[h.object.userData.sys].g < 0.6);
    return hit ? hit.object.userData.sys : -1;
  }
  function pickPart(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, false).find((h) => h.object.visible && SYS[h.object.userData.sys].g < 0.6);
    if (!hit) return null;
    let o = hit.object;
    while (o && o.parent !== car) o = o.parent;
    return partByGrp.get(o) || null;
  }
  canvas.addEventListener('pointerdown', (e) => {
    tip.classList.remove('show');
    dragging = true; moved = 0; downX = lastX = e.clientX; downY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) {
      const dx = e.clientX - lastX; lastX = e.clientX;
      moved = Math.max(moved, Math.hypot(e.clientX - downX, e.clientY - downY));
      dragYaw -= dx * 0.006; velYaw = -dx * 0.006;
      if (e.pointerType === 'mouse') dragPitch = clamp(dragPitch + e.movementY * 0.003, -0.25, 0.5);
      lastInteract = performance.now();
      section.classList.add('g-touched');
    } else if (e.pointerType === 'mouse' && performance.now() - lastPick > 60) {
      lastPick = performance.now();
      const hp = pickPart(e);
      hoverSys = hp ? hp.sys : -1;
      canvas.classList.toggle('hovering', hoverSys >= 0);
      if (hp) {
        const r = canvas.getBoundingClientRect();
        tip.innerHTML = '<b>' + labelOf(hp) + '</b><span>' + SYS[hp.sys].name + '</span>';
        tip.style.transform = 'translate(' + (e.clientX - r.left + 14) + 'px, ' + (e.clientY - r.top + 16) + 'px)';
        tip.classList.add('show');
      } else tip.classList.remove('show');
    }
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false; canvas.classList.remove('dragging');
    if (moved < 6 && e.type === 'pointerup') { const s = pick(e); focusSys(s >= 0 ? (s === focus ? -1 : s) : -1); }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { tip.classList.remove('show'); if (!dragging) { hoverSys = -1; canvas.classList.remove('hovering'); } });

  // ------------------------------------------------------------------ camera
  const views = {
    hero: { yaw: 0.62, pitch: 0.1, dist: 8.6, target: V(0.0, 0.6, 0) },
    over: { yaw: 0.95, pitch: 0.36, dist: exRadius / Math.sin((camera.fov * PI) / 360) * 0.8, target: exCenter.clone().add(V(0, -0.15, 0)) },
  };
  views.end = { ...views.over, yaw: 1.65, pitch: 0.3 };
  const keys = [[0, views.hero], [0.05, views.hero], [0.55, views.over], [1, views.end]];
  const tmpT = new THREE.Vector3();
  function scrollView(p) {
    let i = 0;
    while (i < keys.length - 2 && p > keys[i + 1][0]) i++;
    const [ta, a] = keys[i], [tb, b] = keys[i + 1];
    const t = ease(clamp((p - ta) / (tb - ta)));
    return { yaw: lerp(a.yaw, b.yaw, t), pitch: lerp(a.pitch, b.pitch, t), dist: lerp(a.dist, b.dist, t), target: a.target.clone().lerp(b.target, t) };
  }
  const cam = { yaw: 0.2, pitch: 0.04, dist: 15, target: V(0, 0.6, 0) };
  const sysCentre = (i) => {
    const b = new THREE.Box3();
    framed(SYS[i]).forEach((p) => b.expandByObject(p.grp));
    return b.getCenter(tmpT.clone());
  };

  // ------------------------------------------------------------------ frame
  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3();
  const hoverTint = new THREE.Color('#9ec4ff');
  let time = 0;

  // Only re-render when something on screen actually changes; idle frames cost almost nothing.
  let renderCount = 0, viewOverride = null;
  const startedAt = performance.now();
  let lastE = -1, lastSig = '', prLevel = renderer.getPixelRatio(), slowFrames = 0, lastFrameAt = 0;
  const maxPR = prLevel, debug = /[?&]debug/.test(location.search);
  const domCache = new Map();
  const setStyle = (el, prop, val) => { const key = el; let c = domCache.get(key); if (!c) domCache.set(key, (c = {})); if (c[prop] !== val) { c[prop] = val; el.style[prop] = val; } };
  const camPrev = new THREE.Vector3(), tgtPrev = new THREE.Vector3();
  let leadGeom = null; // cached card anchor, relative to the canvas
  function measureLead() {
    const card = focus >= 0 ? cards.find((c) => Number(c.dataset.sys) === focus) : null;
    if (!card) { leadGeom = null; return; }
    const sr = canvas.getBoundingClientRect(), cont = card.parentElement.getBoundingClientRect(), h = card.offsetHeight;
    leadGeom = small()
      ? { bx: cont.left + cont.width / 2 - sr.left, by: cont.bottom - h - sr.top }
      : { bx: cont.left - sr.left, by: cont.top - h / 2 - sr.top + 34 };
  }

  function frame(now) {
    if (!visible) { running = false; return; }
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    time += dt;
    const k = (rate) => 1 - Math.exp(-rate * dt);

    readScroll();
    pNow += (pTarget - pNow) * k(reduced ? 30 : 10);
    if (Math.abs(pTarget - pNow) < 1e-5) pNow = pTarget;
    if (focus >= 0 && pTarget < 0.36 && performance.now() - focusTime > 1800) { focus = -1; syncUI(); }
    const e = ease(smooth(0.05, 0.5, pNow));
    focusAmt += ((focus >= 0 ? 1 : 0) - focusAmt) * k(5);
    if (Math.abs(focusAmt - (focus >= 0 ? 1 : 0)) < 1e-3) focusAmt = focus >= 0 ? 1 : 0;

    // rev / rpm
    let rpmGoal = 850;
    if (revT >= 0) {
      revT += dt;
      if (revT < 0.85) rpmGoal = 8400; else if (revT < 1.05) rpmGoal = 8300; else { if (popT < 0) popT = 0; revT = -1; }
    }
    rpm += (rpmGoal - rpm) * k(rpmGoal > rpm ? 4.2 : 2.2);
    if (Math.abs(rpm - 850) < 2) rpm = 850;
    if (Math.abs(rpm - lastDrawnRpm) > 25 || (rpm === 850 && lastDrawnRpm !== 850)) { drawCluster(rpm); lastDrawnRpm = rpm; }
    const rpmTxt = String(Math.round(rpm / 10) * 10);
    if (rpmEl && rpmEl.textContent !== rpmTxt) rpmEl.textContent = rpmTxt;
    vtecEl?.classList.toggle('on', rpm > 5800);
    if (audio && audio.live) {
      const t = audio.ctx.currentTime, f = (rpm / 60) * 2;
      audio.oscs.forEach(({ o, m }) => o.frequency.setTargetAtTime(f * m, t, 0.02));
      audio.lp.frequency.setTargetAtTime(380 + rpm * 0.22 + (rpm > 5800 ? 1600 : 0), t, 0.04);
      const vol = revT >= 0 || rpm > 1100 ? 0.11 : 0;
      audio.out.gain.setTargetAtTime(vol, t, vol ? 0.05 : 0.25);
      if (popT >= 0 && !audio.popped) { audio.pop(); audio.popped = true; }
      if (popT < 0) audio.popped = false;
      if (!vol && rpm < 1000) audio.live = 0;
    }
    if (flameMat) {
      if (popT >= 0) { popT += dt; flameMat.opacity = popT < 0.5 ? (Math.random() > 0.35 ? 0.9 : 0.2) * (1 - popT * 2) : 0; if (popT > 0.5) popT = -1; }
      else flameMat.opacity = rpm > 7600 ? 0.25 + Math.random() * 0.2 : 0;
    }

    // explode: only touch the parts when the explode amount moves (or the engine is shaking)
    const shaking = rpm > 1000;
    if (Math.abs(e - lastE) > 1e-6 || shaking) {
      car.position.y = LIFT * e;
      const Dmax = 0.45;
      parts.forEach((p) => {
        const local = ease(clamp((e - p.delay) / (1 - Dmax)));
        p.grp.position.copy(p.home).addScaledVector(p.offset, local);
        if (p.shake && shaking) { const a = (rpm / 9000) * 0.004; p.grp.position.x += (Math.random() - 0.5) * a; p.grp.position.y += (Math.random() - 0.5) * a; }
        p.grp.rotation.set(p.rot[0] * local, p.rot[1] * local, p.rot[2] * local);
        if (p.spin) p.spin.rotation.z = local * PI * 1.6 * (p.home.z > 0 ? -1 : 1);
        if (p.guide && Math.abs(e - lastE) > 1e-6) {
          const a = p.guide.geometry.attributes.position;
          a.setXYZ(1, p.grp.position.x, p.grp.position.y, p.grp.position.z); a.needsUpdate = true;
          p.guide.computeLineDistances();
        }
      });
      renderer.shadowMap.needsUpdate = true;
      lastE = e;
    }
    guideMat.opacity = smooth(0.15, 0.6, e) * 0.55 * (1 - focusAmt * 0.6);

    // reassembly flash
    if (wasExploded && e < 0.003) ringT = 0;
    wasExploded = e > 0.3 ? true : e < 0.003 ? false : wasExploded;
    if (ringT >= 0) {
      ringT += dt;
      const t = ringT / 1.1;
      ringFx.scale.setScalar(1 + t * 4.5);
      ringFx.material.opacity = (1 - t) * 0.7;
      if (t >= 1) { ringT = -1; ringFx.material.opacity = 0; }
    }

    // ghosting + hover: only when a system's state is moving
    let ghostSig = 0;
    SYS.forEach((sys, i) => {
      const gGoal = focus >= 0 && i !== focus ? 1 : 0, hGoal = hoverSys === i && focus !== i ? 1 : 0;
      if (Math.abs(sys.g - gGoal) < 0.002 && Math.abs(sys.hover - hGoal) < 0.002 && sys.g === gGoal && sys.hover === hGoal) { ghostSig += sys.g * (i + 1) + sys.hover * 0.1; return; }
      sys.g += (gGoal - sys.g) * k(6);
      sys.hover += (hGoal - sys.hover) * k(10);
      if (Math.abs(sys.g - gGoal) < 0.002) sys.g = gGoal;
      if (Math.abs(sys.hover - hGoal) < 0.002) sys.hover = hGoal;
      const g = sys.g;
      sys.ghostMat.uniforms.uO.value = g * 0.9 + sys.hover * g * 0.6;
      sys.ghosts.forEach((m) => { m.visible = g > 0.01; });
      sys.mats.forEach((m) => {
        const ud = m.userData;
        m.opacity = ud.baseOpacity * (1 - g);
        m.transparent = ud.baseTransparent || g > 0.002;
        m.depthWrite = ud.baseDepthWrite && g < 0.5;
        if (ud.baseEmissive && !ud.glow) m.emissive.copy(ud.baseEmissive).lerp(hoverTint, sys.hover * 0.07), m.emissiveIntensity = 1;
      });
      sys.solids.forEach((m) => { m.visible = g < 0.995; m.castShadow = g < 0.5 && !(Array.isArray(m.material) ? m.material[0] : m.material).userData.baseTransparent; });
      renderer.shadowMap.needsUpdate = true;
      ghostSig += g * (i + 1) + sys.hover * 0.1 + 1e3; // force a render while moving
    });

    // paint, lights
    paintMats.forEach((m) => { m.color.lerp(paintTarget, k(4)); if (Math.abs(m.color.r - paintTarget.r) + Math.abs(m.color.g - paintTarget.g) + Math.abs(m.color.b - paintTarget.b) < 0.002) m.color.copy(paintTarget); });
    glow.material.color.lerp(paintTarget, k(4));
    lightAmt += ((lights ? 1 : 0) - lightAmt) * k(8);
    if (Math.abs(lightAmt - (lights ? 1 : 0)) < 0.002) lightAmt = lights ? 1 : 0;
    const wall = (performance.now() - startedAt) / 1000;
    const flash = !reduced && ((wall > 0.9 && wall < 1.02) || (wall > 1.16 && wall < 1.4)) ? 1 : 0;
    const headOn = Math.max(lightAmt, flash);
    headMats.forEach((m) => { m.emissiveIntensity = 0.4 + headOn * 3; });
    tailMats.forEach((m) => { m.emissiveIntensity = 0.7 + lightAmt * 1.6; });
    gaugeMats.forEach((m) => { m.emissiveIntensity = 1.1 + lightAmt * 0.6; });
    const bodyG = SYS[S.body].g;
    headFlares.forEach((f) => { f.material.opacity = headOn * 0.95 * (1 - bodyG); f.visible = f.material.opacity > 0.01; });
    tailFlares.forEach((f) => { f.material.opacity = (0.22 + lightAmt * 0.6) * (1 - bodyG); f.visible = f.material.opacity > 0.01; });
    beams.forEach((b) => { b.intensity = lightAmt * 30 * (1 - e); });
    pool.material.opacity = lightAmt * 0.5 * (1 - e);

    // camera
    const sv = scrollView(pNow);
    if (viewOverride) Object.assign(sv, viewOverride, { target: viewOverride.target ? V(...viewOverride.target) : sv.target });
    let goal = sv;
    if (focus >= 0) {
      const sys = SYS[focus];
      const c = sysCentre(focus);
      const fv = { yaw: sys.view[0], pitch: sys.view[1], dist: Math.max(1.8, sys.radius / Math.sin((camera.fov * PI) / 360) * 1.05), target: c };
      goal = { yaw: lerp(sv.yaw, fv.yaw, focusAmt), pitch: lerp(sv.pitch, fv.pitch, focusAmt), dist: lerp(sv.dist, fv.dist, focusAmt), target: sv.target.clone().lerp(fv.target, focusAmt) };
    }
    if (!dragging) {
      dragYaw += velYaw; velYaw *= 0.92;
      if (Math.abs(velYaw) < 1e-5) velYaw = 0;
      if (performance.now() - lastInteract > 2500) { dragYaw *= 1 - k(1.2); dragPitch *= 1 - k(1.2); if (Math.abs(dragYaw) < 1e-4) dragYaw = 0; if (Math.abs(dragPitch) < 1e-4) dragPitch = 0; }
    }
    const aspectK = clamp(1.08 / camera.aspect, 1, 1.9);
    cam.yaw += (goal.yaw + dragYaw - cam.yaw) * k(6);
    cam.pitch += (clamp(goal.pitch + dragPitch, -0.05, 1.1) - cam.pitch) * k(6);
    const intro = reduced ? 1 : ease(clamp((performance.now() - startedAt) / 2400));
    cam.dist += (goal.dist * aspectK * (1 + 0.55 * (1 - intro)) - cam.dist) * k(6);
    cam.target.lerp(goal.target, k(6));
    const gy = goal.yaw + dragYaw, gp = clamp(goal.pitch + dragPitch, -0.05, 1.1), gd = goal.dist * aspectK * (1 + 0.55 * (1 - intro));
    if (Math.abs(cam.yaw - gy) < 2e-4) cam.yaw = gy;
    if (Math.abs(cam.pitch - gp) < 2e-4) cam.pitch = gp;
    if (Math.abs(cam.dist - gd) < 1e-3) cam.dist = gd;
    if (cam.target.distanceToSquared(goal.target) < 1e-7) cam.target.copy(goal.target);
    const cp = Math.cos(cam.pitch);
    camera.position.set(cam.target.x + cam.dist * cp * Math.cos(cam.yaw), cam.target.y + cam.dist * Math.sin(cam.pitch), cam.target.z + cam.dist * cp * Math.sin(cam.yaw));
    if (camera.position.y < 0.15) camera.position.y = 0.15;
    camera.lookAt(cam.target);
    scene.fog.near = cam.dist * 1.1; scene.fog.far = cam.dist * 2.6;

    // frame the car beside the copy / card
    const headVis = 1 - smooth(0.04, 0.22, pNow);
    let ox = 0, oy = 0;
    if (viewOverride) { /* centred for comparisons */ }
    else if (!small()) { ox = -W0 * 0.17 * headVis + W0 * 0.15 * focusAmt; }
    else { oy = -H0 * 0.1 * headVis + H0 * 0.17 * focusAmt + H0 * 0.04 * (1 - headVis) * (1 - focusAmt); }
    offX += (ox - offX) * k(6); offY += (oy - offY) * k(6);
    if (Math.abs(ox - offX) < 0.3) offX = ox;
    if (Math.abs(oy - offY) < 0.3) offY = oy;
    camera.setViewOffset(W0, H0, offX, offY, W0, H0);
    camera.updateProjectionMatrix();

    // Has anything visible changed since the last render?
    const moved = camera.position.distanceToSquared(camPrev) > 1e-10 || cam.target.distanceToSquared(tgtPrev) > 1e-10;
    camPrev.copy(camera.position); tgtPrev.copy(cam.target);
    const sig = [e.toFixed(5), focusAmt.toFixed(4), ghostSig.toFixed(4), lightAmt.toFixed(3), headOn, rpm.toFixed(0), paintMats[0]?.color.getHexString(), offX.toFixed(1), offY.toFixed(1), ringT >= 0 ? time : 0, popT >= 0 ? time : 0, W0, H0].join('|');
    if (!moved && sig === lastSig) return;
    if (debug) { (window.__why ||= []).push((moved ? 'MOVED ' + camera.position.toArray().map((v) => v.toFixed(5)).join(',') + ' ' : '') + sig); if (window.__why.length > 40) window.__why.shift(); }
    lastSig = sig;

    // overlays
    setStyle(head, 'opacity', String(headVis));
    setStyle(head, 'transform', `translateY(${((1 - headVis) * -24).toFixed(1)}px)`);
    setStyle(head, 'visibility', headVis < 0.01 ? 'hidden' : 'visible');
    setStyle(cue, 'opacity', String(1 - smooth(0.01, 0.08, pNow)));
    const navVis = smooth(0.42, 0.55, pNow);
    section.style.setProperty('--nav-vis', navVis.toFixed(3));
    sysNav.classList.toggle('show', navVis > 0.05);
    next.classList.toggle('show', pNow > 0.92 && focus < 0);
    const tagVis = smooth(0.48, 0.58, pNow) * (1 - smooth(0, 0.6, focusAmt));
    SYS.forEach((sys, i) => {
      byName[sys.anchor].grp.getWorldPosition(tmp).project(camera);
      const el = tags[i];
      const x = Math.min((tmp.x * 0.5 + 0.5) * W0, W0 - (el._w || 140) - 24), y = (-tmp.y * 0.5 + 0.5) * H0;
      sys.vis = tagVis * (tmp.z < 1 ? 1 : 0);
      sys.screen = [x, y];
      sys.tagY = y;
    });
    if (tagVis > 0.001) {
      const order = SYS.map((s, i) => i).sort((a, b) => SYS[a].screen[1] - SYS[b].screen[1]);
      for (let a = 0; a < order.length; a++) for (let b = 0; b < a; b++) {
        const A = SYS[order[a]], B = SYS[order[b]];
        if (Math.abs(A.screen[0] - B.screen[0]) < 170 && A.tagY - B.tagY < 26) A.tagY = B.tagY + 26;
      }
    }
    SYS.forEach((sys, i) => {
      const el = tags[i];
      setStyle(el, 'opacity', (sys.vis * (hoverSys >= 0 && hoverSys !== i ? 0.45 : 1)).toFixed(3));
      if (sys.vis > 0.001) setStyle(el, 'transform', `translate(${sys.screen[0].toFixed(0)}px, ${sys.tagY.toFixed(0)}px)`);
      setStyle(el, 'pointerEvents', sys.vis > 0.5 ? 'auto' : 'none');
      el.classList.toggle('hot', hoverSys === i);
    });
    // leader to the open card
    if (focus >= 0 && focusAmt > 0.6 && leadGeom) {
      const [ax, ay] = SYS[focus].screen, { bx, by } = leadGeom;
      const mx = small() ? ax : bx - 40, my = small() ? by - 24 : by;
      leadPath.setAttribute('d', `M${ax.toFixed(1)},${ay.toFixed(1)} L${mx.toFixed(1)},${my.toFixed(1)} L${bx.toFixed(1)},${by.toFixed(1)}`);
      leadDot.setAttribute('cx', ax.toFixed(1)); leadDot.setAttribute('cy', ay.toFixed(1));
      leadRing.setAttribute('cx', ax.toFixed(1)); leadRing.setAttribute('cy', ay.toFixed(1));
      setStyle(leader, 'opacity', String(smooth(0.6, 1, focusAmt)));
    } else setStyle(leader, 'opacity', '0');

    renderer.render(scene, camera);
    renderCount++;

    // Adaptive resolution: if frames keep running slow, render fewer pixels.
    if (!debug && lastFrameAt) {
      const interval = now - lastFrameAt;
      if (interval > 0 && interval < 200) {
        slowFrames = interval > 28 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
        if (slowFrames > 24 && prLevel > 0.75) { prLevel = Math.max(0.75, prLevel - 0.25); renderer.setPixelRatio(prLevel); resize(); slowFrames = 0; }
      }
    }
    lastFrameAt = now;
  }

  // ------------------------------------------------------------------ run only while on screen
  resize();
  readScroll();
  pNow = pTarget;
  let resizeQueued = false;
  const queueResize = () => { if (resizeQueued) return; resizeQueued = true; requestAnimationFrame(() => { resizeQueued = false; resize(); measureLead(); }); };
  new ResizeObserver(queueResize).observe(canvas);
  document.fonts?.ready.then(() => tags.forEach((el) => { el._w = el.offsetWidth; }));
  tags.forEach((el) => { el._w = el.offsetWidth || 140; });
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !running) { running = true; clock.getDelta(); lastFrameAt = 0; requestAnimationFrame(frame); }
  }, { rootMargin: '100px' }).observe(section);
  window.__garageReady = true;
  section.classList.add('g-ready');
  // Debug: orthographic elevation at blueprint scale (1 px = 2.57/158.25 m, times k), nose on the left.
  const ortho = (view = 'side', k = 4) => {
    const m = 2.57 / 158.25 / k, W = view === 'side' ? 4.9 : 2.2, H = 1.7;
    const w = Math.round(W / m), h = Math.round(H / m);
    const cam = new THREE.OrthographicCamera(-W / 2, W / 2, 0.85, -0.85, 0.1, 50);
    if (view === 'side') { cam.position.set(0, 0.75, -20); cam.lookAt(0, 0.75, 0); }
    else if (view === 'front') { cam.position.set(20, 0.75, 0); cam.lookAt(0, 0.75, 0); }
    else { cam.position.set(-20, 0.75, 0); cam.lookAt(0, 0.75, 0); }
    const prev = [renderer.getSize(new THREE.Vector2()), renderer.getPixelRatio(), scene.fog, scene.background];
    renderer.setPixelRatio(1); renderer.setSize(w, h, false); scene.fog = null; scene.background = new THREE.Color('#ffffff');
    floor.visible = false; glow.visible = false;
    renderer.render(scene, cam);
    const url = renderer.domElement.toDataURL('image/png');
    floor.visible = true; glow.visible = true; scene.fog = prev[2]; scene.background = prev[3];
    renderer.setPixelRatio(prev[1]); renderer.setSize(prev[0].x, prev[0].y, false);
    return url;
  };
  window.__garage = { scene, byName, M, SYS, ortho, renders: () => renderCount, view: (v) => { viewOverride = v; }, setP: (p) => { pTarget = pNow = p; }, focus: focusSys, rev: () => { revT = 0; }, lights: (v) => { lights = v; } };
}
