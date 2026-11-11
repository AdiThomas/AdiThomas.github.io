// The hero oscilloscope: a live two-channel trace with phosphor persistence.
// Pointer X sets the frequency and pointer Y the amplitude. CH2 is CH1 run through a
// comparator (a square wave), a nod to the FPGA synthesizer project.
(function () {
  const canvas = document.getElementById('scope-canvas');
  if (!canvas) return;
  const screen = canvas.parentElement;
  const ctx = canvas.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();
  const CH1 = color('--ch1') || '#f2c94c';
  const CH2 = color('--ch2') || '#4fd1e0';
  const SCREEN = color('--screen') || '#071012';

  const DIV_X = 10;
  const DIV_Y = 6;
  const TIME_PER_DIV_MS = 1;   // 1 ms/div, so the screen spans 10 ms
  const VOLTS_PER_DIV = 0.5;

  const state = {
    wave: 'sine',
    mode: 'yt',
    running: true,
    cycles: 3,          // cycles visible across the screen
    amp: 0.6,           // fraction of half the screen height
    targetCycles: 3,
    targetAmp: 0.6,
    phase: 0,
    pointer: false,
  };

  let w = 0, h = 0, dpr = 1;
  let grid = null;

  function resize() {
    const rect = screen.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, Math.round(rect.width));
    h = Math.max(1, Math.round(rect.height));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    grid = drawGraticule();
    ctx.fillStyle = SCREEN;
    ctx.fillRect(0, 0, w, h);
  }

  function drawGraticule() {
    const g = document.createElement('canvas');
    g.width = w * dpr;
    g.height = h * dpr;
    const c = g.getContext('2d');
    c.scale(dpr, dpr);
    c.strokeStyle = 'rgba(160, 200, 210, 0.12)';
    c.lineWidth = 1;
    for (let i = 1; i < DIV_X; i++) {
      const x = Math.round((i * w) / DIV_X) + 0.5;
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
    }
    for (let j = 1; j < DIV_Y; j++) {
      const y = Math.round((j * h) / DIV_Y) + 0.5;
      c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
    }
    // Centre axes with minor ticks, like a real graticule.
    c.strokeStyle = 'rgba(160, 200, 210, 0.28)';
    const cx = Math.round(w / 2) + 0.5;
    const cy = Math.round(h / 2) + 0.5;
    c.beginPath(); c.moveTo(cx, 0); c.lineTo(cx, h); c.moveTo(0, cy); c.lineTo(w, cy); c.stroke();
    const minorX = w / DIV_X / 5;
    const minorY = h / DIV_Y / 5;
    c.beginPath();
    for (let x = 0; x <= w; x += minorX) { c.moveTo(x, cy - 3); c.lineTo(x, cy + 3); }
    for (let y = 0; y <= h; y += minorY) { c.moveTo(cx - 3, y); c.lineTo(cx + 3, y); }
    c.stroke();
    return g;
  }

  // One period of each waveform, t in [0, 1) -> [-1, 1].
  const shapes = {
    sine: (t) => Math.sin(2 * Math.PI * t),
    square: (t) => (t % 1 < 0.5 ? 1 : -1),
    saw: (t) => 2 * (t % 1) - 1,
    tri: (t) => 1 - 4 * Math.abs((t % 1) - 0.5),
  };

  function trace(points, stroke) {
    // Glow pass, then a crisp core.
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = stroke;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 7;
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.restore();
  }

  function frame() {
    // Ease towards the pointer-driven targets so the trace never jumps.
    state.cycles += (state.targetCycles - state.cycles) * 0.08;
    state.amp += (state.targetAmp - state.amp) * 0.08;
    if (state.running) state.phase += 0.006 + state.cycles * 0.0012;

    // Phosphor persistence: fade the previous frame instead of clearing it.
    ctx.globalAlpha = reduced ? 1 : 0.28;
    ctx.fillStyle = SCREEN;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.drawImage(grid, 0, 0, w, h);

    const f = shapes[state.wave];
    const mid = h / 2;
    const halfH = h / 2;
    const steps = Math.max(240, Math.round(w * 1.2));

    if (state.mode === 'yt') {
      const ch1 = [];
      const ch2 = [];
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * w;
        const t = (i / steps) * state.cycles + state.phase;
        const v = f(t);
        ch1.push([x, mid - v * state.amp * halfH * 0.92]);
        // CH2: comparator output of CH1, offset into the lower third.
        const d = Math.sin(2 * Math.PI * t) >= 0 ? 1 : -1;
        ch2.push([x, mid + halfH * 0.62 - d * halfH * 0.14]);
      }
      trace(ch2, CH2);
      trace(ch1, CH1);
    } else {
      // X-Y mode: Lissajous figure. The frequency ratio follows the pointer.
      const a = Math.max(1, Math.round(state.cycles / 1.5));
      const b = a + 1;
      const pts = [];
      const n = 900;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = w / 2 + Math.sin(2 * Math.PI * a * t + state.phase * 6) * (w * 0.36) * (0.4 + state.amp * 0.6);
        const y = mid + f(b * t) * halfH * 0.82 * state.amp;
        pts.push([x, y]);
      }
      trace(pts, CH1);
    }

    updateReadouts();
  }

  const el = (id) => document.getElementById(id);
  const ro = { freq: el('ro-freq'), vpp: el('ro-vpp'), mode: el('ro-mode'), wave: el('ro-wave') };
  let lastReadout = 0;
  function updateReadouts() {
    const now = performance.now();
    if (now - lastReadout < 120) return;
    lastReadout = now;
    const screenMs = DIV_X * TIME_PER_DIV_MS;
    const hz = (state.cycles / screenMs) * 1000;
    const vpp = 2 * state.amp * 0.92 * (DIV_Y / 2) * VOLTS_PER_DIV;
    ro.freq.textContent = hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz.toFixed(0)} Hz`;
    ro.vpp.textContent = `${vpp.toFixed(2)} V`;
    ro.mode.textContent = state.running ? 'RUN' : 'STOP';
    ro.wave.textContent = state.mode === 'xy' ? 'X–Y' : state.wave.toUpperCase();
  }

  // ---- interaction ----
  function onPointer(e) {
    const rect = screen.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const py = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    state.targetCycles = 1 + px * 9;            // 100 Hz .. 1 kHz
    state.targetAmp = 0.15 + (1 - py) * 0.8;
  }
  screen.addEventListener('pointermove', onPointer);
  screen.addEventListener('pointerdown', onPointer);
  screen.addEventListener('pointerleave', () => { state.targetCycles = 3; state.targetAmp = 0.6; });

  function bindGroup(groupId, attr, key) {
    const group = el(groupId);
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      state[key] = btn.dataset[attr];
      group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      if (reduced) frame();
    });
  }
  bindGroup('wave-buttons', 'wave', 'wave');
  bindGroup('mode-buttons', 'mode', 'mode');
  const runStop = el('run-stop');
  runStop.addEventListener('click', () => {
    state.running = !state.running;
    runStop.setAttribute('aria-pressed', String(!state.running));
  });

  // ---- loop: only animate while visible ----
  let visible = true;
  let raf = 0;
  function loop() {
    frame();
    raf = requestAnimationFrame(loop);
  }
  function start() { if (!raf && visible && !document.hidden && !reduced) raf = requestAnimationFrame(loop); }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    visible ? start() : stop();
  }).observe(screen);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  new ResizeObserver(() => { resize(); frame(); }).observe(screen);

  resize();
  frame();
  start();
  if (reduced) screen.addEventListener('pointermove', () => frame());
})();
