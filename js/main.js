// Page behaviour outside the circuit: active section in the nav, reveal on scroll,
// copy-email button and the footer year.
(function () {
  document.documentElement.classList.add('js');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Highlight the nav link for the section in view.
  const links = [...document.querySelectorAll('.nav a')];
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${entry.target.id}`));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  links.forEach((a) => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) spy.observe(target);
  });

  // When the car enters a sector, flash that sector's nav link.
  document.addEventListener('sector', (e) => {
    const link = links.find((a) => a.dataset.sector === String(e.detail.sector));
    if (!link) return;
    link.classList.remove('flash');
    void link.offsetWidth; // restart the animation
    link.classList.add('flash');
  });

  // Reveal sections as they scroll in. Anything already on screen stays visible.
  const revealables = document.querySelectorAll('.sec-head, .about, .timing, .stint, .build, .setup, .radio-log');
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
      if (el.getBoundingClientRect().top > window.innerHeight) {
        el.classList.add('pending');
        io.observe(el);
      }
    });
  }

  const copyBtn = document.getElementById('copy-email');
  const email = document.getElementById('email');
  copyBtn?.addEventListener('click', async () => {
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
    setTimeout(() => { copyBtn.textContent = 'Copy email'; }, 1800);
  });

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
