// Page behaviour: power-on self test, keyboard channel shortcuts, active-section
// highlighting, the logic-analyzer timeline, reveal-on-scroll and the copy button.
(function () {
  document.documentElement.classList.add('js');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- power-on self test (once per visit) ----------
  const overlay = document.getElementById('selftest');
  const lines = document.getElementById('selftest-lines');
  let seen = false;
  try { seen = sessionStorage.getItem('at-selftest') === '1'; } catch (_) { /* storage blocked */ }

  function finishSelfTest() {
    if (!overlay || overlay.classList.contains('done')) return;
    overlay.classList.add('done');
    setTimeout(() => { overlay.hidden = true; }, 500);
    try { sessionStorage.setItem('at-selftest', '1'); } catch (_) { /* ignore */ }
    window.removeEventListener('keydown', finishSelfTest);
    overlay.removeEventListener('click', finishSelfTest);
  }

  if (!overlay || seen || reduced) {
    if (overlay) overlay.hidden = true;
  } else {
    const steps = [
      ['POWER RAIL 3V3', 'OK'],
      ['ADC CALIBRATION', 'OK'],
      ['CH1  JAVA / REACT', 'OK'],
      ['CH2  DEVOPS / CI', 'OK'],
      ['CH3  DATA / AI', 'OK'],
      ['CH4  FPGA / HW', 'OK'],
      ['TRIGGER ARMED', 'READY'],
    ];
    steps.forEach(([label, result], i) => {
      setTimeout(() => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${label}</span><span>${result}</span>`;
        lines.appendChild(li);
      }, 140 + i * 150);
    });
    setTimeout(finishSelfTest, 140 + steps.length * 150 + 450);
    window.addEventListener('keydown', finishSelfTest);
    overlay.addEventListener('click', finishSelfTest);
  }

  // ---------- keyboard shortcuts 1-5 ----------
  const navLinks = [...document.querySelectorAll('.channels a')];
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const link = navLinks.find((a) => a.dataset.key === e.key);
    const selfTestShowing = overlay && !overlay.hidden && !overlay.classList.contains('done');
    if (link && !selfTestShowing) {
      document.querySelector(link.getAttribute('href')).scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    }
  });

  // ---------- active channel in the top bar ----------
  const sections = navLinks.map((a) => document.querySelector(a.getAttribute('href')));
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${entry.target.id}`));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((s) => s && spy.observe(s));

  // ---------- logic analyzer timeline ----------
  // Months since Jan 2021. "end: null" means ongoing.
  const START = { y: 2021, m: 7 };   // Aug 2021, just before university starts
  const END = { y: 2027, m: 0 };
  const m = (y, mo) => (y - START.y) * 12 + (mo - START.m);
  const total = m(END.y, END.m);
  const lanes = [
    { name: 'U of Guelph · B.Eng', color: 'var(--ch4)', spans: [[m(2021, 8), m(2026, 11)]] },
    { name: 'ATS · IT intern', color: 'var(--ch2)', spans: [[m(2024, 4), m(2024, 7)]] },
    { name: 'Mississauga · IT', color: 'var(--ch2)', spans: [[m(2025, 3), m(2025, 11)]] },
    { name: 'Magna · DevOps', color: 'var(--ch1)', spans: [[m(2026, 3), m(2026, 8)]] },
    { name: 'Magna · SWE', color: 'var(--ch1)', spans: [[m(2026, 8), m(2026, 11)]], ongoing: true },
  ];
  const logic = document.getElementById('logic');
  if (logic) {
    const W = 1000, H = 30, HI = 4, LO = 26;
    const x = (v) => (v / total) * W;
    logic.innerHTML = lanes.map((lane) => {
      let d = `M0 ${LO}`;
      let fill = '';
      lane.spans.forEach(([a, b]) => {
        d += ` L${x(a)} ${LO} L${x(a)} ${HI} L${x(b)} ${HI}` + (lane.ongoing ? '' : ` L${x(b)} ${LO}`);
        fill += `M${x(a)} ${LO} L${x(a)} ${HI} L${x(b)} ${HI} L${x(b)} ${LO} Z `;
      });
      if (!lane.ongoing) d += ` L${W} ${LO}`;
      // The ongoing role stays high and ends in an arrow at the right edge.
      const tail = lane.ongoing
        ? `<path d="M${x(lane.spans[0][1])} ${HI} L${W} ${HI}" style="stroke:${lane.color}" stroke-dasharray="6 6" vector-effect="non-scaling-stroke"/>`
        : '';
      return `<div class="lane"><span class="lane-name">${lane.name}</span>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          <path class="fill" d="${fill}" style="fill:${lane.color}"/>
          <path d="${d}" style="stroke:${lane.color}" vector-effect="non-scaling-stroke"/>
          ${tail}
        </svg></div>`;
    }).join('') + `<div class="axis"><span></span><div class="axis-ticks">${
      [2022, 2023, 2024, 2025, 2026].map((y) => `<span style="left:${(m(y, 0) / total) * 100}%">${y}</span>`).join('')
    }</div></div>`;
  }

  // ---------- reveal on scroll ----------
  const revealables = document.querySelectorAll('.channel > h2, .about-grid, .logic, .role, .project, .datasheet, .contact');
  if ('IntersectionObserver' in window && !reduced) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.remove('pending');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    revealables.forEach((el) => {
      el.classList.add('reveal');
      // Only hide things that start below the fold, so the first screen is complete at rest.
      if (el.getBoundingClientRect().top > window.innerHeight) {
        el.classList.add('pending');
        io.observe(el);
      }
    });
  }

  // ---------- copy email ----------
  const copyBtn = document.getElementById('copy-email');
  const email = document.getElementById('email');
  if (copyBtn && email) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(email.textContent.trim());
        copyBtn.textContent = 'Copied';
      } catch (_) {
        const range = document.createRange();
        range.selectNodeContents(email);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        copyBtn.textContent = 'Selected';
      }
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1800);
    });
  }

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
