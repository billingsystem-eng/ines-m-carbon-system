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
  PESO + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kwh = (n, dp = 3) =>
  Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: dp }) + ' kWh';
const dec = (n, dp = 2) =>
  Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const dateText = (d) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const NAV = [
  { href: '/dashboard.html', label: 'Overview' },
  { href: '/clients.html', label: 'Clients & projects' },
  { href: '/bills.html', label: 'Billing' },
  { href: '/monitor.html', label: 'Live monitor' },
  { href: '/audit.html', label: 'Activity log' },
  { href: '/users.html', label: 'Users', adminOnly: true },
  { href: '/payment-methods.html', label: 'Payment method' }
];

/** Renders the left rail and returns the signed-in user. */
async function shell() {
  const me = await api('/api/auth/me');
  const rail = document.querySelector('.rail');
  if (!rail) return me;
  const here = location.pathname;
  const roleText = { admin: 'Administrator', billing_officer: 'Billing officer', viewer: 'Viewer' }[me.role] || me.role;
  rail.innerHTML = `
    <div class="mark"><b>M-Carbon System</b><span>INES Solutions</span></div>
    <nav>${NAV.filter((n) => !n.adminOnly || me.role === 'admin')
      .map((n) => `<a href="${n.href}" class="${here === n.href ? 'on' : ''}">${n.label}</a>`)
      .join('')}</nav>
    <div class="who"><b>${esc(me.full_name)}</b>${roleText}<br><button id="signout">Sign out</button></div>`;
  rail.querySelector('#signout').onclick = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.href = '/login.html';
  };
  document.body.dataset.role = me.role;
  return me;
}

/** Viewers can read everything but change nothing. */
const readOnly = (me) => me.role === 'viewer';

function disableEditing() {
  document.querySelectorAll('[data-edit]').forEach((el) => {
    el.disabled = true;
    el.title = 'Your role is read-only.';
  });
}
