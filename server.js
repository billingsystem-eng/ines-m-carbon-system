require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');

const { requireAuth } = require('./middleware/auth');
const authRouter = require('./routes/auth');
const clientsRouter = require('./routes/clients');
const projectsRouter = require('./routes/projects');
const billsRouter = require('./routes/bills');
const reportsRouter = require('./routes/reports');
const monitorRouter = require('./routes/monitor');

require('./db'); // opens the database and creates tables on first run

const app = express();
const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

app.use(session({
  // In production, set SESSION_SECRET in your environment instead of using this default.
  secret: process.env.SESSION_SECRET || 'm-carbon-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: PROD,
    maxAge: 8 * 60 * 60 * 1000 // 8 hours
  }
}));

app.use('/api/auth', authRouter);
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/', (req, res) => {
  res.redirect(req.session?.userId ? '/dashboard.html' : '/login.html');
});

// Everything below requires a logged-in session
app.use('/api/clients', requireAuth, clientsRouter);
app.use('/api/projects', requireAuth, projectsRouter);
app.use('/api/bills', requireAuth, billsRouter);
app.use('/api/reports', requireAuth, reportsRouter);
app.use('/api/monitor', requireAuth, monitorRouter); // live M-Carbon monitor (map, sites, meters)

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'The server could not complete that request.' });
});

app.listen(PORT, () => {
  console.log(`M-Carbon Billing System running on http://localhost:${PORT}`);
});
