/* M-Carbon Billing System — phone helpers (loaded on every page).
   Adds the top bar + slide-in menu around the existing left rail, and wraps wide tables in a
   horizontal scroller. If this file fails to load the desktop layout is unaffected. */
(() => {
  'use strict';
  const mq = window.matchMedia('(max-width: 900px)');
  const body = () => document.body;

  /* ---- Menu ---- */
  function setup() {
    const shell = document.querySelector('.shell');
    const rail = shell && shell.querySelector(':scope > .rail');
    if (!rail || document.querySelector('.m-bar')) return;

    const bar = document.createElement('header');
    bar.className = 'm-bar no-print';
    bar.innerHTML =
      '<button type="button" class="m-menu" aria-label="Open menu" aria-expanded="false" aria-controls="m-rail">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h16"/><path d="M4 12h16"/><path d="M4 17.5h16"/></svg>' +
        '<i class="m-dot"></i></button>' +
      '<div class="m-title"><b>M-Carbon System</b><span>INES Solutions</span></div>';
    shell.insertBefore(bar, shell.firstChild);

    const back = document.createElement('div');
    back.className = 'm-backdrop no-print';
    shell.appendChild(back);
    rail.id = rail.id || 'm-rail';

    const btn = bar.querySelector('.m-menu');
    const title = bar.querySelector('.m-title b');
    const sub = bar.querySelector('.m-title span');

    const set = (open) => {
      body().classList.toggle('nav-open', open);
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      if (open) { const first = rail.querySelector('nav a.on, nav a'); if (first) first.focus({ preventScroll: true }); }
      else if (document.activeElement && rail.contains(document.activeElement)) btn.focus({ preventScroll: true });
    };
    btn.addEventListener('click', () => set(!body().classList.contains('nav-open')));
    back.addEventListener('click', () => set(false));
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && body().classList.contains('nav-open')) set(false); });
    mq.addEventListener('change', (e) => { if (!e.matches) set(false); });
    rail.addEventListener('click', (e) => { if (e.target.closest('nav a')) set(false); });

    /* Show the current page name and an unread dot, once app.js has built the rail. */
    const sync = () => {
      const on = rail.querySelector('nav a.on span:not(.nav-badge)');
      if (on) { title.textContent = on.textContent.trim(); sub.textContent = 'M-Carbon System'; }
      bar.classList.toggle('has-badge', !!rail.querySelector('.nav-badge'));
    };
    sync();
    new MutationObserver(sync).observe(rail, { childList: true, subtree: true });
    /* Closed drawer must not be reachable by keyboard */
    rail.setAttribute('aria-label', 'Main menu');
  }

  /* ---- Wide tables scroll sideways inside their own box ---- */
  const NO_WRAP = '.table-wrap, .m-wrapped, .statement, .si, .qt, .bs';
  function wrapTable(t) {
    if (t.dataset.mw) return;
    t.dataset.mw = '1';
    const cols = t.rows && t.rows[0] ? t.rows[0].cells.length : 0;
    if (cols >= 5) t.dataset.cols = 'many'; else if (cols === 4) t.dataset.cols = 'some';
    if (t.closest(NO_WRAP)) return;
    const w = document.createElement('div');
    w.className = 'm-wrapped';
    t.parentNode.insertBefore(w, t);
    w.appendChild(t);
  }
  /* The column count is only known once rows exist, so look again when a table's head or body fills. */
  function wrapPaper(el) {
    if (el.parentNode && el.parentNode.classList.contains('m-paper')) return;
    const w = document.createElement('div');
    w.className = 'm-paper';
    el.parentNode.insertBefore(w, el);
    w.appendChild(el);
  }
  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches && root.matches('.si, .qt')) wrapPaper(root);
    root.querySelectorAll && root.querySelectorAll('.si, .qt').forEach(wrapPaper);
    if (root.tagName === 'TABLE') wrapTable(root);
    root.querySelectorAll && root.querySelectorAll('table').forEach(wrapTable);
  }

  document.addEventListener('DOMContentLoaded', () => {
    setup();
    scan(document.body);
    new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach(scan)))
      .observe(document.body, { childList: true, subtree: true });
  });
})();
