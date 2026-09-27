const express = require('express');
const db = require('../db');
const { canEdit } = require('../middleware/auth');
const audit = require('../lib/audit');

const router = express.Router();

// Anyone signed in can read (the statement page needs them); admins and billing
// officers can change them, same as the rest of the billing data.

const text = (v, max) => String(v ?? '').trim().slice(0, max);

router.get('/', (req, res) => {
  const where = req.query.active === '1' ? 'WHERE active = 1' : '';
  res.json(db.prepare(`SELECT id, name, details, active FROM payment_methods ${where} ORDER BY id`).all());
});

router.post('/', canEdit, (req, res) => {
  const name = text(req.body?.name, 120);
  if (!name) return res.status(400).json({ error: 'A payment method name is required.' });
  const details = text(req.body?.details, 600);
  const info = db.prepare('INSERT INTO payment_methods (name, details) VALUES (?, ?)').run(name, details || null);
  audit.log(req, 'payment_method', info.lastInsertRowid, 'create', `Added payment method "${name}"`);
  res.status(201).json(db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', canEdit, (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'Payment method not found.' });

  const b = req.body || {};
  const name = b.name !== undefined ? text(b.name, 120) : cur.name;
  if (!name) return res.status(400).json({ error: 'A payment method name is required.' });
  const details = b.details !== undefined ? text(b.details, 600) : cur.details;
  const active = b.active !== undefined ? (b.active ? 1 : 0) : cur.active;

  db.prepare('UPDATE payment_methods SET name = ?, details = ?, active = ? WHERE id = ?')
    .run(name, details || null, active, id);
  const what = b.active !== undefined && b.active !== !!cur.active
    ? (active ? 'reactivate' : 'deactivate') : 'update';
  audit.log(req, 'payment_method', id, what, `${what === 'update' ? 'Updated' : what === 'deactivate' ? 'Deactivated' : 'Reactivated'} payment method "${name}"`);
  res.json(db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(id));
});

router.delete('/:id', canEdit, (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'Payment method not found.' });
  db.prepare('DELETE FROM payment_methods WHERE id = ?').run(id);
  audit.log(req, 'payment_method', id, 'delete', `Deleted payment method "${cur.name}"`);
  res.json({ ok: true });
});

module.exports = router;