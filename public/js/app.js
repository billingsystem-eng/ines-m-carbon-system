/* Shared front-end helpers. */

const PESO = '\u20B1';

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (res.status === 401 && !location.pathname.endsWith('login.html')) {
    location.href = '/login.html';
    throw new Error('Not signed in');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}

function toast(message, bad = false) {
  let box = document.getElementById('toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast';
    document.body.appendChild(box);
  }
  const note = document.createElement('div');
  if (bad) note.className = 'bad';
  note.textContent = message;
  box.appendChild(note);
  setTimeout(() => note.remove(), 4200);
}

const money = (n) =>
  PESO + Number(n || 0).toLocaleString(LOCALE(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kwh = (n, dp = 3) =>
  Number(n || 0).toLocaleString(LOCALE(), { minimumFractionDigits: 0, maximumFractionDigits: dp }) + ' kWh';
const dec = (n, dp = 2) =>
  Number(n || 0).toLocaleString(LOCALE(), { minimumFractionDigits: dp, maximumFractionDigits: dp });
const dateText = (d) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Line icons for the left rail (inline SVG, drawn in the link's text colour). */
const NAV_ICONS = {
  overview: '<rect x="3" y="3" width="7.5" height="9" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5"/><rect x="13.5" y="12" width="7.5" height="9" rx="1.5"/><rect x="3" y="15.5" width="7.5" height="5.5" rx="1.5"/>',
  clients: '<path d="M4 21V5.5A1.5 1.5 0 0 1 5.5 4h8A1.5 1.5 0 0 1 15 5.5V21"/><path d="M15 10h3.5A1.5 1.5 0 0 1 20 11.5V21"/><path d="M2.5 21h19M8 8h3M8 12h3M8 16h3"/>',
  billing: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9.5 8h5M9.5 12h5"/>',
  quotations: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h4"/>',
  monitor: '<path d="M2.5 12h4l2.5-7 5 14 2.5-7h5"/>',
  activity: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5M12 7.5V12l3 2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.7-3.6 3.2-5.5 6.5-5.5s5.8 1.9 6.5 5.5"/><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>',
  payment: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/><path d="M16 13h2"/>',
  signout: '<path d="M9 21H5.5A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3H9"/><path d="M16 17l5-5-5-5M21 12H9"/>'
};
const navIcon = (k) => `<svg class="nav-ico" viewBox="0 0 24 24" aria-hidden="true">${NAV_ICONS[k]}</svg>`;

const NAV = [
  { href: '/dashboard.html', label: 'Overview', icon: 'overview' },
  { href: '/clients.html', label: 'Clients & projects', icon: 'clients' },
  { href: '/bills.html', label: 'Billing', icon: 'billing' },
  { href: '/quotations.html', label: 'Quotations', icon: 'quotations', also: ['/quotation.html', '/quotation-print.html'] },
  { href: '/monitor.html', label: 'Live monitor', icon: 'monitor' },
  { href: '/audit.html', label: 'Activity log', icon: 'activity' },
  { href: '/users.html', label: 'Users', icon: 'users', adminOnly: true },
  { href: '/payment-methods.html', label: 'Payment method', icon: 'payment' }
];

/** Pages a viewer (client login) may open, all read-only: billing, quotations, live monitor, payment methods. */
const VIEWER_PAGES = ['/bills.html', '/bill.html', '/statement.html', '/payment-methods.html',
  '/quotations.html', '/quotation-print.html', '/monitor.html'];

/** Renders the left rail and returns the signed-in user. */
async function shell() {
  const me = await api('/api/auth/me');
  if (me.role === 'viewer' && !VIEWER_PAGES.includes(location.pathname)) {
    location.href = '/bills.html';
    return me;
  }
  const rail = document.querySelector('.rail');
  if (!rail) return me;
  const here = location.pathname;
  const roleText = { admin: 'Administrator', billing_officer: 'Billing officer', viewer: 'Viewer' }[me.role] || me.role;
  rail.innerHTML = `
    <div class="mark"><b>M-Carbon System</b><span>INES Solutions</span></div>
    <nav>${NAV.filter((n) => (!n.adminOnly || me.role === 'admin') && (me.role !== 'viewer' || VIEWER_PAGES.includes(n.href)))
      .map((n) => `<a href="${n.href}" class="${here === n.href || (n.also || []).includes(here) ? 'on' : ''}">${navIcon(n.icon)}<span>${n.label}</span></a>`)
      .join('')}</nav>
    <div class="who"><b>${esc(me.full_name)}</b>${roleText}<br><button id="chpw" type="button">Change password</button> <button id="signout">${navIcon('signout')}Sign out</button></div>`;
  rail.querySelector('#chpw').onclick = openPasswordDialog;
  rail.querySelector('#signout').onclick = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.href = '/login.html';
  };
  document.body.dataset.role = me.role;
  return me;
}

/** Lets any signed-in user change their own password (needs the current one). */
function openPasswordDialog() {
  if (document.getElementById('pw-dialog')) return;
  const dlg = document.createElement('dialog');
  dlg.id = 'pw-dialog';
  dlg.innerHTML = `
    <form method="dialog" id="pw-form" autocomplete="off">
      <h2>Change password</h2>
      <div class="field"><label for="pw-cur">Current password</label><input id="pw-cur" type="password" autocomplete="current-password" required></div>
      <div class="field"><label for="pw-new">New password (at least 8 characters)</label><input id="pw-new" type="password" autocomplete="new-password" minlength="8" required></div>
      <div class="field"><label for="pw-rep">Repeat new password</label><input id="pw-rep" type="password" autocomplete="new-password" minlength="8" required></div>
      <p id="pw-err" class="pw-err" role="alert" hidden></p>
      <div class="pw-actions"><button type="button" id="pw-cancel">Cancel</button><button type="submit" class="primary">Change password</button></div>
    </form>`;
  document.body.appendChild(dlg);
  const g = (id) => dlg.querySelector('#' + id);
  const close = () => { dlg.close(); dlg.remove(); };
  g('pw-cancel').onclick = close;
  dlg.addEventListener('cancel', () => dlg.remove());
  g('pw-form').onsubmit = async (e) => {
    e.preventDefault();
    const err = g('pw-err');
    err.hidden = true;
    if (g('pw-new').value !== g('pw-rep').value) { err.textContent = 'The new passwords do not match.'; err.hidden = false; return; }
    try {
      await api('/api/auth/password', { method: 'POST', body: { current_password: g('pw-cur').value, new_password: g('pw-new').value } });
      close();
      toast('Password changed');
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  };
  dlg.showModal();
  g('pw-cur').focus();
}

/** Viewers can read everything but change nothing. */
const readOnly = (me) => me.role === 'viewer';
/* Clients & projects can only be changed by administrators. */
const readOnlySetup = (me) => me.role !== 'admin';

function disableEditing() {
  document.querySelectorAll('[data-edit]').forEach((el) => {
    el.disabled = true;
    el.title = 'Your role is read-only.';
  });
}