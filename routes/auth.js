const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const audit = require('../lib/audit');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Enter your username and password.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(String(username).trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'That username and password do not match.' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.fullName = user.full_name;
  req.session.role = user.role;
  audit.log(req, 'user', user.id, 'login', 'Signed in');
  res.json({ username: user.username, full_name: user.full_name, role: user.role });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not signed in.' });
  res.json({
    id: req.session.userId,
    username: req.session.username,
    full_name: req.session.fullName,
    role: req.session.role
  });
});

router.post('/password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'Use a new password of at least 8 characters.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(current_password || '', user.password_hash)) {
    return res.status(400).json({ error: 'Your current password is incorrect.' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), user.id);
  audit.log(req, 'user', user.id, 'password_change', 'Changed own password');
  res.json({ ok: true });
});

// --- User management (administrators only) ---

router.get('/users', requireRole('admin'), (req, res) => {
  res.json(db.prepare('SELECT id, username, full_name, role, active, created_at FROM users ORDER BY username').all());
});

router.post('/users', requireRole('admin'), (req, res) => {
  const { username, full_name, role, password } = req.body || {};
  if (!username || !full_name || !password) {
    return res.status(400).json({ error: 'Username, full name and password are required.' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
  if (!['admin', 'billing_officer', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Pick a valid role.' });
  }
  try {
    const info = db
      .prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)')
      .run(username.trim(), bcrypt.hashSync(password, 10), full_name.trim(), role);
    audit.log(req, 'user', info.lastInsertRowid, 'create', `Created user ${username} (${role})`);
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'That username is already taken.' });
  }
});

router.patch('/users/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const { full_name, role, active, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (id === req.session.userId && active === 0) {
    return res.status(400).json({ error: 'You cannot deactivate your own account.' });
  }
  db.prepare('UPDATE users SET full_name = ?, role = ?, active = ? WHERE id = ?').run(
    full_name ?? user.full_name,
    role ?? user.role,
    active === undefined ? user.active : active ? 1 : 0,
    id
  );
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), id);
  }
  audit.log(req, 'user', id, 'update', `Updated user ${user.username}`);
  res.json({ ok: true });
});

module.exports = router;
