module.exports = (req, res, next) => {
  if (!req.session.user) {
    req.session.flash = { error: 'Please log in to continue.' };
    return res.redirect('/auth/login');
  }
  next();
};
