const express = require('express');
const db = require('../db');
const { canEdit, requireRole } = require('../middleware/auth');
const audit = require('../lib/audit');

const router = express.Router();
const STATUSES = ['draft', 'sent', 'accepted', 'declined'];

const DEFAULT_TERMS = [
  '1) Order Confirmation: Upon the Client\u2019s acceptance of this quotation.',
  '2) Payment Terms: Due within 30 days from the date of invoice.',
  '3) Delivery: Within 3\u20135 business days from order confirmation, subject to product availability.',
  '4) Quotation Validity: This quotation is valid until the Valid Until date stated above.',
  '5) Warranty: LED lighting products are covered by a 5-year warranty against manufacturing defects and technical malfunction. Warranty coverage is limited to product replacement. Maintenance services are not included.',
  '6) Shipping: Shipping and delivery charges will be calculated based on the delivery location and will be quoted separately, unless otherwise stated in the quotation.'
].join('\n');

const text = (v, max) => String(v ?? '').trim().slice(0, max);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

function totals(subtotal, vatRate) {
  const sub = r2(subtotal), vat = r2(sub * (vatRate / 100));
  return { subtotal: sub, vat, total: r2(sub + vat) };
}

function load(id) {
  const q = db.prepare('SELECT * FROM quotations WHERE id = ?').get(id);
  if (!q) return null;
  const items = db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY position, id').all(id)
    .map((i) => ({ ...i, line_total: r2(i.quantity * i.unit_price) }));
  const sub = items.reduce((a, i) => a + i.quantity * i.unit_price, 0);
  return { ...q, items, ...totals(sub, q.vat_rate) };
}

function nextNo(dateStr) {
  const prefix = `MC${dateStr.slice(0, 4)}-`;
  const last = db.prepare("SELECT quote_no FROM quotations WHERE quote_no LIKE ? ORDER BY quote_no DESC LIMIT 1").get(prefix + '%');
  const n = last ? parseInt(last.quote_no.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(n).padStart(3, '0');
}

/** Validates the body; returns { error } or { data, items }. */
function parse(b) {
  const data = {
    quote_date: text(b.quote_date, 10), valid_until: text(b.valid_until, 10),
    client_id: b.client_id ? Number(b.client_id) : null,
    customer_name: text(b.customer_name, 200), client_ref_id: text(b.client_ref_id, 80),
    submitted_by: text(b.submitted_by, 120), contact_no: text(b.contact_no, 60),
    vat_rate: num(b.vat_rate ?? 12), terms: text(b.terms, 4000),
    prepared_by_name: text(b.prepared_by_name, 120), prepared_by_title: text(b.prepared_by_title, 120),
    approved_by_name: text(b.approved_by_name, 120), approved_by_title: text(b.approved_by_title, 120),
    contact_name: text(b.contact_name, 120), contact_phone: text(b.contact_phone, 60), contact_email: text(b.contact_email, 120)
  };
  if (!data.customer_name) return { error: 'A customer name is required.' };
  if (!isDate(data.quote_date) || !isDate(data.valid_until)) return { error: 'A quotation date and a valid-until date are required.' };
  if (data.valid_until < data.quote_date) return { error: 'The valid-until date must not be before the quotation date.' };
  if (!(data.vat_rate >= 0 && data.vat_rate <= 100)) return { error: 'The VAT rate must be between 0 and 100.' };
  if (data.client_id && !db.prepare('SELECT 1 FROM clients WHERE id = ?').get(data.client_id)) data.client_id = null;
  const items = (Array.isArray(b.items) ? b.items : []).map((i) => ({
    description: text(i.description, 1500), quantity: num(i.quantity), unit: text(i.unit, 30) || 'pieces', unit_price: num(i.unit_price)
  })).filter((i) => i.description);
  if (!items.length) return { error: 'Add at least one item with a description.' };
  if (items.some((i) => !(i.quantity > 0) || !(i.unit_price >= 0))) return { error: 'Each item needs a quantity above zero and a valid unit price.' };
  return { data, items };
}

function saveItems(id, items) {
  db.prepare('DELETE FROM quotation_items WHERE quotation_id = ?').run(id);
  const ins = db.prepare('INSERT INTO quotation_items (quotation_id, position, description, quantity, unit, unit_price) VALUES (?,?,?,?,?,?)');
  items.forEach((i, n) => ins.run(id, n, i.description, i.quantity, i.unit, i.unit_price));
}

router.get('/defaults', (req, res) => res.json({ terms: DEFAULT_TERMS, statuses: STATUSES }));

router.get('/', (req, res) => {
  const q = text(req.query.q, 100), status = text(req.query.status, 20);
  let sql = `SELECT q.*, COALESCE((SELECT SUM(quantity * unit_price) FROM quotation_items WHERE quotation_id = q.id), 0) AS sub
             FROM quotations q WHERE 1=1`;
  const args = [];
  if (q) { sql += ' AND (q.quote_no LIKE ? OR q.customer_name LIKE ? OR q.client_ref_id LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (status) { sql += ' AND q.status = ?'; args.push(status); }
  sql += ' ORDER BY q.quote_date DESC, q.id DESC';
  const rows = db.prepare(sql).all(...args).map(({ sub, ...r }) => ({ ...r, ...totals(sub, r.vat_rate) }));
  res.json({ statuses: STATUSES, quotations: rows });
});

router.get('/:id', (req, res) => {
  const q = load(Number(req.params.id));
  if (!q) return res.status(404).json({ error: 'Quotation not found.' });
  res.json(q);
});

router.post('/', canEdit, (req, res) => {
  const { error, data, items } = parse(req.body || {});
  if (error) return res.status(400).json({ error });
  const id = db.transaction(() => {
    const info = db.prepare(`INSERT INTO quotations (quote_no, quote_date, valid_until, client_id, customer_name, client_ref_id,
        submitted_by, contact_no, vat_rate, terms, prepared_by_name, prepared_by_title, approved_by_name, approved_by_title,
        contact_name, contact_phone, contact_email, created_by)
      VALUES (@quote_no, @quote_date, @valid_until, @client_id, @customer_name, @client_ref_id, @submitted_by, @contact_no,
        @vat_rate, @terms, @prepared_by_name, @prepared_by_title, @approved_by_name, @approved_by_title,
        @contact_name, @contact_phone, @contact_email, @created_by)`)
      .run({ ...data, quote_no: nextNo(data.quote_date), created_by: req.session.username || null });
    saveItems(info.lastInsertRowid, items);
    return info.lastInsertRowid;
  })();
  const q = load(id);
  audit.log(req, 'quotation', id, 'create', `Created quotation ${q.quote_no} for ${q.customer_name}`);
  res.status(201).json(q);
});

router.put('/:id', canEdit, (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM quotations WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'Quotation not found.' });
  const { error, data, items } = parse(req.body || {});
  if (error) return res.status(400).json({ error });
  db.transaction(() => {
    db.prepare(`UPDATE quotations SET quote_date=@quote_date, valid_until=@valid_until, client_id=@client_id,
        customer_name=@customer_name, client_ref_id=@client_ref_id, submitted_by=@submitted_by, contact_no=@contact_no,
        vat_rate=@vat_rate, terms=@terms, prepared_by_name=@prepared_by_name, prepared_by_title=@prepared_by_title,
        approved_by_name=@approved_by_name, approved_by_title=@approved_by_title, contact_name=@contact_name,
        contact_phone=@contact_phone, contact_email=@contact_email, updated_at=datetime('now') WHERE id=@id`).run({ ...data, id });
    saveItems(id, items);
  })();
  const q = load(id);
  audit.log(req, 'quotation', id, 'update', `Updated quotation ${q.quote_no} (total ${q.total})`);
  res.json(q);
});

router.patch('/:id/status', canEdit, (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM quotations WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'Quotation not found.' });
  const status = text(req.body?.status, 20);
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Pick a valid quotation status.' });
  db.prepare("UPDATE quotations SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  audit.log(req, 'quotation', id, 'status', `Quotation ${cur.quote_no}: ${cur.status} \u2192 ${status}`);
  res.json(load(id));
});

router.delete('/:id', canEdit, (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM quotations WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'Quotation not found.' });
  if (cur.status !== 'draft' && req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Only an administrator can delete a quotation that has been sent.' });
  }
  db.transaction(() => {
    db.prepare('DELETE FROM quotation_items WHERE quotation_id = ?').run(id);
    db.prepare('DELETE FROM quotations WHERE id = ?').run(id);
  })();
  audit.log(req, 'quotation', id, 'delete', `Deleted quotation ${cur.quote_no}`);
  res.json({ ok: true });
});

module.exports = router;
