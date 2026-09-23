const express = require('express');
const db = require('../db');
const { round } = require('../lib/billing');

const router = express.Router();

router.get('/overview', (req, res) => {
  const one = (sql, ...a) => db.prepare(sql).get(...a);

  const clients = one('SELECT COUNT(*) c FROM clients').c;
  const projects = one('SELECT COUNT(*) c FROM projects').c;
  const issued = db.prepare(
    `SELECT COALESCE(SUM(amount_billed),0) billed, COALESCE(SUM(client_retained),0) retained,
            COALESCE(SUM(energy_savings_kwh),0) kwh, COUNT(*) n
     FROM bills WHERE status IN ('final','issued')`).get();
  const collected = one(`SELECT COALESCE(SUM(p.amount),0) s FROM payments p
     JOIN bills b ON b.id = p.bill_id WHERE b.status IN ('final','issued')`).s;
  const outstanding = round(issued.billed - collected, 2);

  const byStatus = db.prepare('SELECT status, COUNT(*) n FROM bills GROUP BY status').all();
  const byMethod = db.prepare(
    `SELECT baseline_method, COUNT(*) n FROM bills WHERE status != 'void' GROUP BY baseline_method`).all();

  const pending = db.prepare(`
    SELECT b.id, b.statement_no, b.status, b.period_start, b.period_end, b.amount_billed,
           c.name AS client_name, p.name AS project_name
    FROM bills b JOIN clients c ON c.id = b.client_id JOIN projects p ON p.id = b.project_id
    WHERE b.status IN ('draft','for_review','approved')
    ORDER BY b.period_end DESC LIMIT 12`).all();

  const overdue = db.prepare(`
    SELECT b.id, b.statement_no, b.due_date, b.total_due, c.name AS client_name
    FROM bills b JOIN clients c ON c.id = b.client_id
    WHERE b.status = 'issued' AND b.total_due > 0 AND b.due_date < date('now')
    ORDER BY b.due_date LIMIT 12`).all();

  const monthly = db.prepare(`
    SELECT substr(period_end,1,7) AS month,
           COALESCE(SUM(energy_savings_kwh),0) kwh,
           COALESCE(SUM(gross_savings),0) gross,
           COALESCE(SUM(amount_billed),0) billed
    FROM bills WHERE status IN ('final','issued')
    GROUP BY month ORDER BY month DESC LIMIT 12`).all();

  res.json({
    clients, projects,
    statements: issued.n,
    total_billed: round(issued.billed, 2),
    total_retained: round(issued.retained, 2),
    total_kwh_saved: round(issued.kwh, 3),
    total_collected: round(collected, 2),
    outstanding,
    by_status: byStatus,
    by_method: byMethod,
    pending, overdue,
    monthly: monthly.reverse()
  });
});

router.get('/audit', (req, res) => {
  const { entity, q } = req.query;
  let sql = 'SELECT * FROM audit_log WHERE 1=1';
  const args = [];
  if (entity) { sql += ' AND entity = ?'; args.push(entity); }
  if (q) { sql += ' AND (detail LIKE ? OR username LIKE ? OR action LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY id DESC LIMIT 300';
  res.json(db.prepare(sql).all(...args));
});

module.exports = router;
