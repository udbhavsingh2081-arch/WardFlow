const User = require('../models/User');
const Hospital = require('../models/Hospital');

exports.showLogin = (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('auth/login', { title: 'Sign In', layout: false });
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    req.session.flash = { error: 'Email and password are required.' };
    return res.redirect('/auth/login');
  }
  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() }).lean(false);
    if (!user || !user.isActive) {
      req.session.flash = { error: 'Invalid email or password.' };
      return res.redirect('/auth/login');
    }
    const match = await user.comparePassword(password);
    if (!match) {
      req.session.flash = { error: 'Invalid email or password.' };
      return res.redirect('/auth/login');
    }
    await User.findByIdAndUpdate(user._id, { lastLoginAt: new Date() });
    req.session.user = {
      _id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      hospitalId: user.hospitalId ? user.hospitalId.toString() : null,
      departmentIds: (user.departmentIds || []).map(d => d.toString()),
    };
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    req.session.flash = { error: 'Login failed. Please try again.' };
    res.redirect('/auth/login');
  }
};

exports.logout = (req, res) => {
  req.session.destroy(() => res.redirect('/auth/login'));
};

exports.showProfile = async (req, res) => {
  try {
    if (!req.session.user || !req.session.user._id) {
      return res.redirect('/auth/login');
    }
    const user = await User.findById(req.session.user._id).lean();
    if (!user) {
      req.session.destroy(() => res.redirect('/auth/login'));
      return;
    }
    res.render('auth/profile', { title: 'My Profile', activePage: 'profile', user });
  } catch (err) {
    req.session.flash = { error: 'Failed to load profile.' };
    res.redirect('/dashboard');
  }
};

exports.updateProfile = async (req, res) => {
  const { name, phone, currentPassword, newPassword } = req.body;
  try {
    const user = await User.findById(req.session.user._id);
    if (!user) return res.redirect('/auth/logout');
    user.name = name || user.name;
    user.phone = phone || user.phone;
    if (currentPassword && newPassword) {
      const match = await user.comparePassword(currentPassword);
      if (!match) {
        req.session.flash = { error: 'Current password is incorrect.' };
        return res.redirect('/auth/profile');
      }
      if (newPassword.length < 8) {
        req.session.flash = { error: 'New password must be at least 8 characters.' };
        return res.redirect('/auth/profile');
      }
      user.passwordHash = await User.hashPassword(newPassword);
      user.passwordChangedAt = new Date();
    }
    await user.save();
    req.session.user.name = user.name;
    req.session.flash = { success: 'Profile updated successfully.' };
    res.redirect('/auth/profile');
  } catch (err) {
    req.session.flash = { error: 'Failed to update profile.' };
    res.redirect('/auth/profile');
  }
};
