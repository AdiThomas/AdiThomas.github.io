// The hero: a top-down circuit you can drive. Four sectors, one per part of the page.
// Physics are arcade-simple; everything is in "world units" (the circuit is 1000 x 560),
// so behaviour is identical on any screen size.
(function () {
  const canvas = document.getElementById('track');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const traceCanvas = document.getElementById('trace');
  const tctx = traceCanvas ? traceCanvas.getContext('2d') : null;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const css = getComputedStyle(document.documentElement);
  const token = (n, d) => css.getPropertyValue(n).trim() || d;
  const C = {
    bg: token('--bg', '#0b0d10'),
    grass: token('--infield', '#10161a'),
    asphalt: token('--asphalt', '#2a2f35'),
    line: token('--paint', '#e9ecef'),
    kerbA: token('--kerb-red', '#e5383b'),
    kerbB: '#f1f1f1',
    car: token('--accent', '#ff5a36'),
    purple: token('--purple', '#b46cff'),
    green: token('--green', '#3ddc84'),
    yellow: token('--yellow', '#ffd23f'),
    dim: token('--dim', '#8b95a1'),
  };

  const WORLD_W = 1000;
  const WORLD_H = 560;
  const HALF_WIDTH = 23;
  const SECTOR_NAMES = ['About', 'Experience', 'Projects', 'Skills'];
  const SECTOR_TARGETS = ['#about', '#experience', '#projects', '#skills'];

  // An original layout: main straight, a tight infield loop, fast top section, esses down the left.
  const CONTROL = [
    [0.16, 0.83], [0.45, 0.83], [0.70, 0.83], [0.86, 0.78], [0.92, 0.65], [0.87, 0.53],
    [0.76, 0.50], [0.67, 0.42], [0.71, 0.30], [0.84, 0.24], [0.89, 0.13], [0.77, 0.08],
    [0.58, 0.11], [0.49, 0.21], [0.40, 0.18], [0.30, 0.10], [0.16, 0.12], [0.08, 0.24],
    [0.12, 0.36], [0.23, 0.44], [0.21, 0.56], [0.09, 0.62], [0.07, 0.74],
  ].map(([x, y]) => [x * WORLD_W, y * WORLD_H]);

  // ---------- build the centreline ----------
  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return [0, 1].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t +
      (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
  }
  const raw = [];
  const n = CONTROL.length;
  for (let i = 0; i < n; i++) {
    const p0 = CONTROL[(i - 1 + n) % n], p1 = CONTROL[i], p2 = CONTROL[(i + 1) % n], p3 = CONTROL[(i + 2) % n];
    for (let s = 0; s < 60; s++) raw.push(catmull(p0, p1, p2, p3, s / 60));
  }
  // Resample to evenly spaced points so "index" is proportional to distance.
  const SPACING = 3;
  const pts = [];
  let carry = 0;
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i], b = raw[(i + 1) % raw.length];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = carry;
    while (d < seg) {
      const t = d / seg;
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      d += SPACING;
    }
    carry = d - seg;
  }
  const N = pts.length;
  const LAP_LENGTH = N * SPACING;
  const tangent = pts.map((p, i) => {
    const a = pts[(i - 2 + N) % N], b = pts[(i + 2) % N];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  });
  const angleDiff = (a, b) => {
    let d = a - b;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  };
  // Curvature: heading change over the next ~24 units.
  const curv = pts.map((_, i) => Math.abs(angleDiff(tangent[(i + 8) % N], tangent[i])));

  // ---------- car physics ----------
  const MAX_SPEED = 470;     // world units per second, shown as ~330 km/h
  const ACCEL = 300;
  const BRAKE = 820;
  const DRAG = 90;
  const GRASS_MAX = 120;
  const TURN_RATE = 4.6;     // rad/s at full grip
  const grip = (v) => Math.min(1, v / 70) * (1 - 0.3 * (v / MAX_SPEED));

  // Ideal speed per point for the autopilot: corner limit, then braking zones worked backwards.
  const ideal = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let c = 0;
    for (let k = 0; k < 10; k++) c = Math.max(c, curv[(i + k) % N]);
    const radius = c > 0.001 ? 24 / c : 1e9;
    let v = MAX_SPEED;
    while (v > 90 && v > TURN_RATE * grip(v) * radius * 0.85) v -= 4;
    ideal[i] = v;
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const next = ideal[(i + 1) % N];
      ideal[i] = Math.min(ideal[i], Math.sqrt(next * next + 2 * BRAKE * 0.55 * SPACING));
    }
  }

  const car = { x: 0, y: 0, heading: 0, speed: 0, idx: 0 };
  const input = { up: false, down: false, left: false, right: false };
  let autopilot = true;
  const skids = [];

  function resetCar() {
    car.idx = 4;
    car.x = pts[4][0];
    car.y = pts[4][1];
    car.heading = tangent[4];
    car.speed = 0;
    lap.start = performance.now();
    lap.sector = 0;
    lap.sectorStart = lap.start;
    lap.valid = true;
    lap.trace.fill(0);
    lap.sectorsDone = 0;
  }

  function nearest(x, y, around) {
    let best = around, bestD = Infinity;
    const scan = (from, to) => {
      for (let k = from; k <= to; k++) {
        const i = (k + N) % N;
        const d = (pts[i][0] - x) ** 2 + (pts[i][1] - y) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
    };
    scan(around - 40, around + 40);
    if (bestD > 60 * 60) scan(0, N - 1); // lost: search everywhere
    return { idx: best, dist: Math.sqrt(bestD) };
  }

  // ---------- timing ----------
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* storage blocked */ } },
  };
  const lap = {
    start: 0, sector: 0, sectorStart: 0, valid: true, sectorsDone: 0,
    last: null,
    best: store.get('at-best-lap'),
    bestSectors: store.get('at-best-sectors') || [null, null, null, null],
    trace: new Float32Array(N),
    ref: null,          // the autopilot's lap time, to race against
    refTrace: null,
    bestTrace: (store.get('at-best-trace') && Float32Array.from(store.get('at-best-trace'))) || null,
  };

  const el = (id) => document.getElementById(id);
  const ui = {
    speed: el('hud-speed'), gear: el('hud-gear'), lapTime: el('hud-lap'), last: el('hud-last'), best: el('hud-best'),
    throttle: el('hud-throttle'), brake: el('hud-brake'), mode: el('hud-mode'), status: el('hud-status'),
    sectors: [0, 1, 2, 3].map((i) => el(`sector-${i}`)),
    toast: el('track-toast'),
  };

  const fmt = (ms) => {
    if (ms == null || !Number.isFinite(ms)) return '–:––.–––';
    const m = Math.floor(ms / 60000);
    const s = (ms % 60000) / 1000;
    return `${m}:${s.toFixed(3).padStart(6, '0')}`;
  };

  let toastTimer = 0;
  function toast(html, tone) {
    if (!ui.toast) return;
    ui.toast.innerHTML = html;
    ui.toast.dataset.tone = tone || '';
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2200);
  }

  function crossSector(newSector, now) {
    const done = lap.sector;
    const time = now - lap.sectorStart;
    const prevBest = lap.bestSectors[done];
    const isBest = !autopilot && lap.valid && (prevBest == null || time < prevBest);
    if (isBest) { lap.bestSectors[done] = time; store.set('at-best-sectors', lap.bestSectors); }
    const box = ui.sectors[done];
    if (box) {
      box.dataset.state = autopilot ? 'auto' : !lap.valid ? 'invalid' : isBest ? 'best' : 'slower';
      box.querySelector('.sector-time').textContent = (time / 1000).toFixed(3);
    }
    lap.sectorsDone += 1;
    lap.sector = newSector;
    lap.sectorStart = now;
    const entering = ui.sectors[newSector];
    ui.sectors.forEach((s, i) => s && s.classList.toggle('live', i === newSector));
    if (entering) entering.dataset.state = 'live';
    document.dispatchEvent(new CustomEvent('sector', { detail: { sector: newSector } }));

    if (newSector === 0) finishLap(now);
    else if (!autopilot) toast(`Sector ${done + 1} · <b>${(time / 1000).toFixed(3)}</b> → entering <b>${SECTOR_NAMES[newSector]}</b>`, isBest ? 'best' : '');
  }

  function finishLap(now) {
    const time = now - lap.start;
    const complete = lap.sectorsDone >= 4 && lap.valid;
    if (complete && autopilot) {
      lap.ref = time;
      lap.last = time;
      lap.refTrace = Float32Array.from(lap.trace);
    } else if (complete) {
      lap.last = time;
      const isBest = lap.best == null || time < lap.best;
      if (isBest) {
        lap.best = time;
        lap.bestTrace = Float32Array.from(lap.trace);
        store.set('at-best-lap', time);
        store.set('at-best-trace', Array.from(lap.bestTrace, (v) => Math.round(v)));
      }
      const vs = lap.ref ? ` · ${Math.abs((time - lap.ref) / 1000).toFixed(3)}s ${time < lap.ref ? 'faster' : 'slower'} than autopilot` : '';
      toast(`${isBest ? 'Personal best · ' : 'Lap '}<b>${fmt(time)}</b>${vs}`, isBest ? 'best' : '');
    } else if (!autopilot) {
      toast('Lap not counted · track limits', 'invalid');
    }
    lap.start = now;
    lap.valid = true;
    lap.sectorsDone = 0;
    lap.trace.fill(0);
  }

  // ---------- update ----------
  let steerSmooth = 0;
  function update(dt, now) {
    let throttle = 0, brake = 0, steer = 0;
    if (autopilot) {
      const look = Math.round(10 + car.speed * 0.045);
      const target = pts[(car.idx + look) % N];
      const want = Math.atan2(target[1] - car.y, target[0] - car.x);
      steer = Math.max(-1, Math.min(1, angleDiff(want, car.heading) * 2.4));
      const goal = ideal[(car.idx + 6) % N] * 0.97;
      if (car.speed < goal - 6) throttle = 1;
      else if (car.speed > goal + 10) brake = Math.min(1, (car.speed - goal) / 60);
    } else {
      throttle = input.up ? 1 : 0;
      brake = input.down ? 1 : 0;
      const raw = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      steerSmooth += (raw - steerSmooth) * Math.min(1, dt * 10);
      steer = steerSmooth;
    }

    const near = nearest(car.x, car.y, car.idx);
    const offTrack = near.dist > HALF_WIDTH + 3;
    const limit = offTrack ? GRASS_MAX : MAX_SPEED;

    if (throttle) car.speed += ACCEL * throttle * (1 - car.speed / (limit * 1.05)) * dt;
    if (brake) car.speed -= BRAKE * brake * dt;
    car.speed -= (DRAG + (offTrack ? 420 : 0) * (car.speed > GRASS_MAX ? 1 : 0.15)) * dt * (throttle ? 0.25 : 1);
    car.speed = Math.max(0, Math.min(MAX_SPEED, car.speed));

    // Steering bites less at very low and very high speed (simple understeer model).
    car.heading += steer * TURN_RATE * grip(car.speed) * dt;
    car.x += Math.cos(car.heading) * car.speed * dt;
    car.y += Math.sin(car.heading) * car.speed * dt;

    // Barriers: far off the circuit, push back towards it.
    const after = nearest(car.x, car.y, near.idx);
    if (after.dist > HALF_WIDTH * 3.2) {
      const p = pts[after.idx];
      const k = (after.dist - HALF_WIDTH * 3.2) / after.dist;
      car.x -= (car.x - p[0]) * k;
      car.y -= (car.y - p[1]) * k;
      car.speed = Math.min(car.speed, 60);
    }
    if (offTrack && !autopilot && car.speed > 60) lap.valid = false;

    // Progress and sectors (forward only; reversing never counts).
    const prev = car.idx;
    car.idx = after.idx;
    let delta = car.idx - prev;
    if (delta < -N / 2) delta += N;
    if (delta > N / 2) delta -= N;
    if (delta > 0) {
      for (let k = 1; k <= delta; k++) lap.trace[(prev + k) % N] = car.speed;
      const sector = Math.floor((car.idx / N) * 4) % 4;
      if (sector === (lap.sector + 1) % 4) crossSector(sector, now);
    }

    // Skid marks under hard cornering.
    if (Math.abs(steer) > 0.75 && car.speed > 200 && !reduced) {
      skids.push([car.x, car.y, car.heading]);
      if (skids.length > 500) skids.shift();
    }

    return { throttle, brake };
  }

  // ---------- render ----------
  let scale = 1, dpr = 1;
  let staticLayer = null;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return; // not laid out yet; the ResizeObserver calls again
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    scale = rect.width / WORLD_W;
    staticLayer = drawStatic();
    if (traceCanvas) {
      const r = traceCanvas.getBoundingClientRect();
      traceCanvas.width = Math.round(r.width * dpr);
      traceCanvas.height = Math.round(r.height * dpr);
    }
  }

  function path(c, offset) {
    // Offset path along the normal: +HALF_WIDTH is one edge, -HALF_WIDTH the other.
    c.beginPath();
    for (let i = 0; i <= N; i++) {
      const k = i % N;
      const nx = -Math.sin(tangent[k]), ny = Math.cos(tangent[k]);
      const x = pts[k][0] + nx * offset, y = pts[k][1] + ny * offset;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
  }

  function drawStatic() {
    const layer = document.createElement('canvas');
    layer.width = canvas.width;
    layer.height = canvas.height;
    const c = layer.getContext('2d');
    c.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    c.fillStyle = C.grass;
    c.fillRect(0, 0, WORLD_W, WORLD_H);

    // Faint survey grid: the circuit as an engineering drawing.
    c.strokeStyle = 'rgba(255,255,255,0.035)';
    c.lineWidth = 1;
    for (let x = 0; x <= WORLD_W; x += 40) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, WORLD_H); c.stroke(); }
    for (let y = 0; y <= WORLD_H; y += 40) { c.beginPath(); c.moveTo(0, y); c.lineTo(WORLD_W, y); c.stroke(); }

    // Run-off, asphalt, edge lines.
    c.lineJoin = 'round';
    c.lineCap = 'round';
    path(c, 0);
    c.strokeStyle = 'rgba(255,255,255,0.04)';
    c.lineWidth = HALF_WIDTH * 2 + 26;
    c.stroke();
    c.strokeStyle = C.asphalt;
    c.lineWidth = HALF_WIDTH * 2;
    c.stroke();
    for (const side of [HALF_WIDTH - 1.5, -(HALF_WIDTH - 1.5)]) {
      path(c, side);
      c.strokeStyle = 'rgba(233,236,239,0.75)';
      c.lineWidth = 1.4;
      c.stroke();
    }

    // Kerbs on the outside and inside of tight corners: red/white blocks.
    for (let i = 0; i < N; i += 2) {
      if (curv[i] < 0.2) continue;
      const turn = angleDiff(tangent[(i + 8) % N], tangent[i]);
      const side = turn > 0 ? -1 : 1; // outside of the corner
      for (const s of [side, -side]) {
        const nx = -Math.sin(tangent[i]), ny = Math.cos(tangent[i]);
        const off = s * (HALF_WIDTH + 2.5);
        c.fillStyle = Math.floor(i / 4) % 2 ? C.kerbA : C.kerbB;
        c.save();
        c.translate(pts[i][0] + nx * off, pts[i][1] + ny * off);
        c.rotate(tangent[i]);
        c.fillRect(-3.2, -2.5, 6.4, 5);
        c.restore();
      }
    }

    // Sector gates with labels.
    c.font = '600 13px "Chakra Petch", system-ui, sans-serif';
    c.textAlign = 'center';
    for (let s = 0; s < 4; s++) {
      const i = Math.floor((s / 4) * N);
      const nx = -Math.sin(tangent[i]), ny = Math.cos(tangent[i]);
      if (s === 0) {
        // Chequered start/finish line.
        for (let r = 0; r < 2; r++) {
          for (let q = -HALF_WIDTH; q < HALF_WIDTH; q += 4) {
            c.fillStyle = (Math.floor(q / 4) + r) % 2 ? '#fff' : '#111';
            c.save();
            c.translate(pts[i][0] + nx * q, pts[i][1] + ny * q);
            c.rotate(tangent[i]);
            c.fillRect(r * 4 - 4, 0, 4, 4);
            c.restore();
          }
        }
      } else {
        c.strokeStyle = 'rgba(255, 210, 63, 0.75)';
        c.setLineDash([4, 4]);
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(pts[i][0] + nx * HALF_WIDTH, pts[i][1] + ny * HALF_WIDTH);
        c.lineTo(pts[i][0] - nx * HALF_WIDTH, pts[i][1] - ny * HALF_WIDTH);
        c.stroke();
        c.setLineDash([]);
      }
      // Label on the infield side, a little beyond the run-off.
      const lx = pts[i][0] - nx * (HALF_WIDTH + 30);
      const ly = pts[i][1] - ny * (HALF_WIDTH + 30);
      c.fillStyle = 'rgba(11,13,16,0.85)';
      const label = `S${s + 1} ${SECTOR_NAMES[s].toUpperCase()}`;
      const w = c.measureText(label).width + 14;
      c.fillRect(lx - w / 2, ly - 11, w, 20);
      c.fillStyle = s === 0 ? C.line : C.yellow;
      c.fillText(label, lx, ly + 4);
    }

    // Circuit name, like the corner of a track map.
    c.textAlign = 'left';
    c.fillStyle = C.dim;
    c.font = '600 12px "JetBrains Mono", ui-monospace, monospace';
    c.fillText(`CIRCUIT AT-26 · ${(LAP_LENGTH * 1.9 / 1000).toFixed(3)} KM · CLOCKWISE`, 16, WORLD_H - 14);
    return layer;
  }

  function drawCar(c) {
    c.save();
    c.translate(car.x, car.y);
    c.rotate(car.heading);
    // A generic open-wheel car, seen from above. Nose points along +x.
    c.fillStyle = '#111';
    for (const [x, y] of [[-8, -6.5], [-8, 6.5], [7, -6], [7, 6]]) c.fillRect(x - 3, y - 2, 6, 4);
    c.fillStyle = C.car;
    c.fillRect(-11, -6, 3, 12);            // rear wing
    c.beginPath();                         // body and nose
    c.moveTo(-9, -3.2); c.lineTo(4, -2.6); c.lineTo(12, -1); c.lineTo(12, 1); c.lineTo(4, 2.6); c.lineTo(-9, 3.2);
    c.closePath();
    c.fill();
    c.fillRect(10, -6, 2.4, 12);           // front wing
    c.fillStyle = '#0b0d10';
    c.beginPath(); c.arc(-1.5, 0, 1.8, 0, Math.PI * 2); c.fill(); // cockpit
    c.restore();
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!staticLayer) return;
    ctx.drawImage(staticLayer, 0, 0);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);

    // Racing line from the autopilot's speed map: brighter where it's flat out.
    if (autopilot) {
      ctx.lineWidth = 1.2;
      for (let i = 0; i < N; i += 3) {
        const a = pts[i], b = pts[(i + 3) % N];
        ctx.strokeStyle = `rgba(255,255,255,${0.04 + 0.12 * (ideal[i] / MAX_SPEED)})`;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
    }

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (const [x, y, h] of skids) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(h);
      ctx.fillRect(-9, -7.5, 3, 2); ctx.fillRect(-9, 5.5, 3, 2);
      ctx.restore();
    }
    drawCar(ctx);
  }

  function renderTrace() {
    if (!tctx) return;
    const W = traceCanvas.width, H = traceCanvas.height;
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, W, H);
    const pad = 6 * dpr;
    const y = (v) => H - pad - (v / MAX_SPEED) * (H - pad * 2);
    // Sector dividers.
    tctx.strokeStyle = 'rgba(255,255,255,0.08)';
    tctx.lineWidth = dpr;
    for (let s = 1; s < 4; s++) {
      const x = Math.round((s / 4) * W) + 0.5;
      tctx.beginPath(); tctx.moveTo(x, 0); tctx.lineTo(x, H); tctx.stroke();
    }
    const line = (data, color, width) => {
      tctx.strokeStyle = color;
      tctx.lineWidth = width * dpr;
      tctx.beginPath();
      let started = false;
      for (let i = 0; i < N; i += 2) {
        const v = data[i];
        if (!v) { started = false; continue; }
        const x = (i / N) * W;
        started ? tctx.lineTo(x, y(v)) : tctx.moveTo(x, y(v));
        started = true;
      }
      tctx.stroke();
    };
    const ref = lap.bestTrace || lap.refTrace;
    if (ref) line(ref, 'rgba(180,108,255,0.7)', 1.2);
    line(lap.trace, C.car, 1.6);
    // Playhead.
    const px = (car.idx / N) * W;
    tctx.fillStyle = C.car;
    tctx.fillRect(px - dpr, 0, 2 * dpr, H);
  }

  let lastHud = 0;
  function hud(now, ctrl) {
    if (now - lastHud < 66) return;
    lastHud = now;
    const kmh = Math.round((car.speed / MAX_SPEED) * 332);
    const gear = car.speed < 8 ? 'N' : String(Math.min(8, 1 + Math.floor(kmh / 42)));
    ui.speed.textContent = String(kmh);
    ui.gear.textContent = gear;
    ui.lapTime.textContent = fmt(now - lap.start);
    ui.last.textContent = fmt(lap.last);
    ui.best.textContent = fmt(lap.best);
    ui.throttle.style.transform = `scaleY(${ctrl.throttle})`;
    ui.brake.style.transform = `scaleY(${ctrl.brake})`;
    ui.mode.textContent = autopilot ? 'Autopilot' : 'You';
    ui.mode.dataset.mode = autopilot ? 'auto' : 'manual';
    ui.status.dataset.valid = String(lap.valid);
    ui.status.textContent = lap.valid ? 'Lap valid' : 'Track limits';
    renderTrace();
  }

  // ---------- input ----------
  const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  const stage = document.getElementById('stage');
  let driving = false; // keyboard drives the car only after "Take the wheel" (or focusing the track)

  function takeControl() {
    if (autopilot) {
      autopilot = false;
      document.body.classList.add('driving');
      resetCar();
      skids.length = 0;
      ui.sectors.forEach((s, i) => { if (s) { s.dataset.state = 'idle'; s.querySelector('.sector-time').textContent = '––.–––'; s.classList.toggle('live', i === 0); } });
      toast(lap.ref ? `Lights out · beat the autopilot's <b>${fmt(lap.ref)}</b>` : 'Lights out · <b>↑</b> throttle <b>↓</b> brake <b>← →</b> steer', '');
    }
  }
  function giveBack() {
    autopilot = true;
    driving = false;
    Object.keys(input).forEach((k) => (input[k] = false));
    document.body.classList.remove('driving');
  }

  window.addEventListener('keydown', (e) => {
    const key = KEYMAP[e.code];
    if (!driving || !key) {
      if (driving && e.code === 'Escape') giveBack();
      if (driving && e.code === 'KeyR') resetCar();
      return;
    }
    e.preventDefault();
    takeControl();
    input[key] = true;
  });
  window.addEventListener('keyup', (e) => {
    const key = KEYMAP[e.code];
    if (key) input[key] = false;
  });

  const wheelBtn = document.getElementById('take-wheel');
  const autoBtn = document.getElementById('autopilot');
  const resetBtn = document.getElementById('reset-car');
  wheelBtn?.addEventListener('click', () => {
    driving = true;
    takeControl();
    canvas.focus({ preventScroll: true });
  });
  autoBtn?.addEventListener('click', giveBack);
  resetBtn?.addEventListener('click', resetCar);
  canvas.addEventListener('focus', () => { driving = true; });
  canvas.addEventListener('blur', () => { if (!document.body.classList.contains('driving')) driving = false; });

  // Touch pedals and steering.
  document.querySelectorAll('[data-pad]').forEach((btn) => {
    const key = btn.dataset.pad;
    const on = (e) => { e.preventDefault(); driving = true; takeControl(); input[key] = true; btn.classList.add('down'); };
    const off = () => { input[key] = false; btn.classList.remove('down'); };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointerleave', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  // Clicking a sector box scrolls to that part of the page.
  ui.sectors.forEach((box, i) => box?.addEventListener('click', () => {
    document.querySelector(SECTOR_TARGETS[i])?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  }));

  // ---------- loop ----------
  let last = performance.now();
  let raf = 0;
  let visible = true;
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // Two physics steps per frame keep fast cornering stable.
    let ctrl = { throttle: 0, brake: 0 };
    for (let s = 0; s < 2; s++) ctrl = update(dt / 2, now);
    render();
    hud(now, ctrl);
    raf = requestAnimationFrame(tick);
  }
  function start() {
    if (raf || !visible || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? start() : stop(); }).observe(stage || canvas);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  new ResizeObserver(() => { resize(); render(); }).observe(canvas);

  resize();
  resetCar();
  ui.sectors.forEach((s, i) => s && s.classList.toggle('live', i === 0));
  if (reduced) {
    // No animation: park the car on the grid and draw one frame.
    render();
    hud(performance.now(), { throttle: 0, brake: 0 });
  } else {
    // Rolling start so the first frame already shows a car at speed.
    car.speed = 220;
    start();
  }

  // Exposed for the automated tests only.
  window.__track = { car, lap, get autopilot() { return autopilot; }, N };
})();
