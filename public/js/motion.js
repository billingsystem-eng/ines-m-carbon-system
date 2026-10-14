/* M-Carbon Billing System — motion helpers (loaded in <head> on every page).
   - html.mo-on is switched on at page load and for a short while after a click / change / submit,
     so entrances play when the person does something but never on a background refresh.
   - Panels fade up as they scroll into view.
   - Summary figures count up. Buttons get a small ripple.
   Everything here is optional: if this file fails to load the site works exactly as before. */
(() => {
  'use strict';
  const root = document.documentElement;
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;

  /* ---- Animation window ---- */
  let timer;
  const open = (ms) => {
    root.classList.add('mo-on');
    clearTimeout(timer);
    timer = setTimeout(() => root.classList.remove('mo-on'), ms);
  };
  open(3200);
  ['click', 'change', 'submit'].forEach((ev) => addEventListener(ev, () => open(2600), true));
  addEventListener('keydown', (e) => { if (e.key === 'Enter') open(2600); }, true);
  addEventListener('pageshow', (e) => { if (e.persisted) open(1500); });

  /* Left rail slides in once per browser session, not on every page. */
  try {
    if (!sessionStorage.getItem('mo-rail')) {
      sessionStorage.setItem('mo-rail', '1');
      root.classList.add('mo-first');
      setTimeout(() => root.classList.remove('mo-first'), 2600);
    }
  } catch (_) { /* storage blocked: skip it */ }

  /* ---- Panels: reveal on scroll ---- */
  const SKIP = '.ww, dialog, .statement, #toast, [data-no-motion]';
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) { en.target.classList.add('mo-shown'); io.unobserve(en.target); }
        });
      }, { threshold: 0.05, rootMargin: '0px 0px -3% 0px' })
    : null;

  function prepPanel(p) {
    if (p.dataset.mo) return;
    p.dataset.mo = '1';
    if (!io || !root.classList.contains('mo-on') || p.closest(SKIP)) return;
    const sibs = Array.prototype.filter.call(p.parentNode.children, (c) => c.classList && c.classList.contains('panel'));
    p.style.setProperty('--mo-i', Math.min(sibs.indexOf(p), 5));
    p.classList.add('mo-hold');
    io.observe(p);
    setTimeout(() => p.classList.add('mo-shown'), 5000);   // safety net: never leave a panel hidden
  }

  /* ---- Count-up for summary figures ---- */
  const COUNT_SEL = '.stat b, [data-count]';
  function countUp(el) {
    if (el.dataset.moc || el.children.length || el.closest(SKIP)) return;
    const text = el.textContent.trim();
    const m = text.match(/^([^\d-]*)(-?[\d,]*\.?\d+)(\D*)$/);
    if (!m) return;
    const target = parseFloat(m[2].replace(/,/g, ''));
    if (!isFinite(target) || target === 0 || Math.abs(target) > 1e12) return;
    el.dataset.moc = '1';
    if (!root.classList.contains('mo-on')) return;
    const decimals = (m[2].split('.')[1] || '').length;
    const grouped = m[2].indexOf(',') !== -1;
    const fmt = (v) => v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped });
    const dur = 900, delay = 150, t0 = performance.now() + delay;
    el.style.minWidth = el.offsetWidth + 'px';
    const tick = (now) => {
      const k = Math.min(1, Math.max(0, (now - t0) / dur));
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = m[1] + fmt(target * eased) + m[3];
      if (k < 1) requestAnimationFrame(tick);
      else { el.textContent = text; el.style.minWidth = ''; }
    };
    el.textContent = m[1] + fmt(0) + m[3];
    requestAnimationFrame(tick);
  }

  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.matches('.panel')) prepPanel(node);
    if (node.matches(COUNT_SEL)) countUp(node);
    node.querySelectorAll('.panel').forEach(prepPanel);
    node.querySelectorAll(COUNT_SEL).forEach(countUp);
  }

  new MutationObserver((muts) => muts.forEach((mu) => mu.addedNodes.forEach(scan)))
    .observe(root, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => scan(document.body));

  /* ---- Button ripple ---- */
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('button.primary, .btn.primary');
    if (!b || b.disabled) return;
    const r = b.getBoundingClientRect();
    const size = Math.max(r.width, r.height);
    const dot = document.createElement('span');
    dot.className = 'mo-ripple';
    dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    b.appendChild(dot);
    setTimeout(() => dot.remove(), 650);
  });
})();
