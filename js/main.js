// Page behaviour: active section in the nav, reveal on scroll, copy-email button
// and the footer year.
(function () {
  document.documentElement.classList.add('js');
  // The hero sits under the sticky top bar, so it needs the bar's height.
  const bar = document.querySelector('.topbar');
  const setBar = () => bar && document.documentElement.style.setProperty('--topbar-h', bar.offsetHeight + 'px');
  setBar();
  addEventListener('resize', setBar);
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

  // Reveal blocks as they scroll in. Anything already on screen stays visible.
  const revealables = document.querySelectorAll('.sec-head, .about, .stint, .build, .spec-row-l, .contact-wrap');
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
