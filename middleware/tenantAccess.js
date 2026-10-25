module.exports = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.hospitalId = req.session.user.hospitalId;
  next();
};
