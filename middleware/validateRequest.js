const { validationResult } = require('express-validator');

module.exports = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(422).json({ errors: errors.array() });
    }
    req.session.flash = { error: errors.array().map(e => e.msg).join(', '), validationErrors: errors.array() };
    return res.redirect('back');
  }
  next();
};
