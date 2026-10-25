/**
 * Role hierarchy (higher index = more access)
 * reporter < staff < supervisor < operations_manager < hospital_admin < platform_admin
 */
const ROLES = ['reporter', 'staff', 'supervisor', 'operations_manager', 'hospital_admin', 'platform_admin'];

exports.ROLES = ROLES;

exports.requireRole = (...allowedRoles) => (req, res, next) => {
  if (!req.session.user) {
    req.session.flash = { error: 'Please log in to continue.' };
    return res.redirect('/auth/login');
  }
  const userRole = req.session.user.role;
  if (!allowedRoles.includes(userRole)) {
    req.session.flash = { error: 'You do not have permission to perform this action.' };
    return res.status(403).render('errors/403', { title: 'Access Denied' });
  }
  next();
};

exports.requireMinRole = (minRole) => (req, res, next) => {
  if (!req.session.user) {
    req.session.flash = { error: 'Please log in to continue.' };
    return res.redirect('/auth/login');
  }
  const userRoleIndex = ROLES.indexOf(req.session.user.role);
  const minRoleIndex = ROLES.indexOf(minRole);
  if (userRoleIndex < minRoleIndex) {
    req.session.flash = { error: 'Insufficient permissions.' };
    return res.status(403).render('errors/403', { title: 'Access Denied' });
  }
  next();
};
