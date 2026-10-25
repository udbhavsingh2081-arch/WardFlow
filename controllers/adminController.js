const Department = require('../models/Department');
const User = require('../models/User');
const Hospital = require('../models/Hospital');
const SLAPolicy = require('../models/SLAPolicy');

// --- Departments ---
exports.listDepartments = async (req, res) => {
  const departments = await Department.find({ hospitalId: req.hospitalId }).populate('supervisorId', 'name').lean();
  res.render('admin/departments', { title: 'Departments', activePage: 'admin', departments });
};

exports.showNewDepartment = async (req, res) => {
  const supervisors = await User.find({ hospitalId: req.hospitalId, isActive: true, role: { $in: ['supervisor', 'hospital_admin'] } }).lean();
  res.render('admin/department-form', { title: 'New Department', department: {}, supervisors });
};

exports.createDepartment = async (req, res) => {
  const { name, code, supervisorId, defaultAssignedTeam } = req.body;
  try {
    await Department.create({ hospitalId: req.hospitalId, name, code, supervisorId: supervisorId || null, defaultAssignedTeam });
    req.session.flash = { success: 'Department created.' };
    res.redirect('/admin/departments');
  } catch (err) {
    req.session.flash = { error: err.code === 11000 ? 'Department name already exists.' : 'Failed to create department.' };
    res.redirect('/admin/departments/new');
  }
};

exports.showEditDepartment = async (req, res) => {
  const [department, supervisors] = await Promise.all([
    Department.findOne({ _id: req.params.id, hospitalId: req.hospitalId }).lean(),
    User.find({ hospitalId: req.hospitalId, isActive: true, role: { $in: ['supervisor', 'hospital_admin'] } }).lean(),
  ]);
  if (!department) { req.session.flash = { error: 'Department not found.' }; return res.redirect('/admin/departments'); }
  res.render('admin/department-form', { title: 'Edit Department', department, supervisors });
};

exports.updateDepartment = async (req, res) => {
  const { name, code, supervisorId, defaultAssignedTeam, isActive } = req.body;
  try {
    await Department.findOneAndUpdate({ _id: req.params.id, hospitalId: req.hospitalId }, { name, code, supervisorId: supervisorId || null, defaultAssignedTeam, isActive: isActive === 'on' });
    req.session.flash = { success: 'Department updated.' };
    res.redirect('/admin/departments');
  } catch (err) {
    req.session.flash = { error: 'Failed to update department.' };
    res.redirect('/admin/departments');
  }
};

// --- Users ---
exports.listUsers = async (req, res) => {
  const users = await User.find({ hospitalId: req.hospitalId }).lean();
  res.render('admin/users', { title: 'Users', activePage: 'admin', users });
};

exports.showNewUser = async (req, res) => {
  const departments = await Department.find({ hospitalId: req.hospitalId, isActive: true }).lean();
  res.render('admin/user-form', { title: 'New User', editUser: {}, departments });
};

exports.createUser = async (req, res) => {
  const { name, email, password, role, departmentIds, phone } = req.body;
  try {
    if (!password || password.length < 8) {
      req.session.flash = { error: 'Password must be at least 8 characters.' };
      return res.redirect('/admin/users/new');
    }
    const passwordHash = await User.hashPassword(password);
    await User.create({
      hospitalId: req.hospitalId,
      name, email, passwordHash, role, phone,
      departmentIds: departmentIds ? [].concat(departmentIds) : [],
    });
    req.session.flash = { success: 'User created.' };
    res.redirect('/admin/users');
  } catch (err) {
    req.session.flash = { error: err.code === 11000 ? 'Email already exists.' : 'Failed to create user.' };
    res.redirect('/admin/users/new');
  }
};

exports.showEditUser = async (req, res) => {
  const [editUser, departments] = await Promise.all([
    User.findOne({ _id: req.params.id, hospitalId: req.hospitalId }).lean(),
    Department.find({ hospitalId: req.hospitalId, isActive: true }).lean(),
  ]);
  if (!editUser) { req.session.flash = { error: 'User not found.' }; return res.redirect('/admin/users'); }
  res.render('admin/user-form', { title: 'Edit User', editUser, departments });
};

exports.updateUser = async (req, res) => {
  const { name, email, role, departmentIds, phone, password } = req.body;
  try {
    const update = { name, email, role, phone, departmentIds: departmentIds ? [].concat(departmentIds) : [] };
    if (password && password.length >= 8) {
      update.passwordHash = await User.hashPassword(password);
      update.passwordChangedAt = new Date();
    }
    await User.findOneAndUpdate({ _id: req.params.id, hospitalId: req.hospitalId }, update);
    req.session.flash = { success: 'User updated.' };
    res.redirect('/admin/users');
  } catch (err) {
    req.session.flash = { error: 'Failed to update user.' };
    res.redirect('/admin/users');
  }
};

exports.toggleUserStatus = async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, hospitalId: req.hospitalId });
  if (user) {
    user.isActive = !user.isActive;
    await user.save();
    req.session.flash = { success: `User ${user.isActive ? 'activated' : 'deactivated'}.` };
  }
  res.redirect('/admin/users');
};

// --- SLA Policies ---
exports.listSLAPolicies = async (req, res) => {
  const policies = await SLAPolicy.find({ hospitalId: req.hospitalId }).lean();
  res.render('admin/sla', { title: 'SLA Policies', activePage: 'admin', policies });
};

exports.saveSLAPolicy = async (req, res) => {
  const { priority, acknowledgementHours, responseHours, resolutionHours, useBusinessHours } = req.body;
  try {
    await SLAPolicy.findOneAndUpdate(
      { hospitalId: req.hospitalId, priority },
      { acknowledgementHours: +acknowledgementHours, responseHours: +responseHours, resolutionHours: +resolutionHours, useBusinessHours: useBusinessHours === 'on' },
      { upsert: true }
    );
    req.session.flash = { success: 'SLA policy saved.' };
    res.redirect('/admin/sla');
  } catch (err) {
    req.session.flash = { error: 'Failed to save SLA policy.' };
    res.redirect('/admin/sla');
  }
};

// --- Hospital Settings ---
exports.showSettings = async (req, res) => {
  const hospital = await Hospital.findById(req.hospitalId).lean();
  res.render('admin/settings', { title: 'Hospital Settings', activePage: 'admin', hospital });
};

exports.updateSettings = async (req, res) => {
  const { name, address, phone, timezone, requireVerification } = req.body;
  try {
    await Hospital.findByIdAndUpdate(req.hospitalId, {
      name, address, phone, timezone,
      'settings.requireVerification': requireVerification === 'on',
    });
    req.session.flash = { success: 'Settings updated.' };
    res.redirect('/admin/settings');
  } catch (err) {
    req.session.flash = { error: 'Failed to update settings.' };
    res.redirect('/admin/settings');
  }
};
