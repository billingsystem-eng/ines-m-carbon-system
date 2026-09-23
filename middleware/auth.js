function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Sign in to continue.' });
}

/** requireRole('admin') or requireRole('admin', 'billing_officer') */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Sign in to continue.' });
    }
    if (!roles.includes(req.session.role)) {
      return res.status(403).json({ error: 'Your role does not allow this action.' });
    }
    next();
  };
}

/** Anyone who may change billing data. Viewers are read-only. */
const canEdit = requireRole('admin', 'billing_officer');

module.exports = { requireAuth, requireRole, canEdit };
