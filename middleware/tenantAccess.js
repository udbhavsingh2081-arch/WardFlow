/**
 * Enforces that the logged-in user belongs to the hospital owning the resource.
 * Never trust hospitalId from query params — always use the session.
 */
module.exports = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // Attach hospitalId from session to request for downstream use
  req.hospitalId = req.session.user.hospitalId;
  next();
};
