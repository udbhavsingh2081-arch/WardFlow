const User = require('../models/User');
const Hospital = require('../models/Hospital');
const Department = require('../models/Department');

exports.showLogin = (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('auth/login', { title: 'Sign In', layout: false });
};

exports.showRegister = async (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  try {
    const hospital = await Hospital.findOne({ isActive: true }).lean();
    const departments = hospital
      ? await Department.find({ hospitalId: hospital._id, isActive: true }).sort({ name: 1 }).lean()
      : [];

    res.render('auth/register', {
      title: 'Create Account',
      layout: false,
      departments,
      formData: {},
    });
  } catch (err) {
    console.error('showRegister error:', err);
    res.redirect('/auth/login');
  }
};

exports.register = async (req, res) => {
  const { name, email, password, confirmPassword, departmentId, phone } = req.body;
  try {
    const hospital = await Hospital.findOne({ isActive: true }).lean();
    if (!hospital) {
      req.session.flash = { error: 'Hospital organization is not configured.' };
      return res.redirect('/auth/register');
    }

    if (!name || !email || !password) {
      req.session.flash = { error: 'Name, email, and password are required.' };
      return res.redirect('/auth/register');
    }

    if (password.length < 8) {
      req.session.flash = { error: 'Password must be at least 8 characters long.' };
      return res.redirect('/auth/register');
    }

    if (confirmPassword && password !== confirmPassword) {
      req.session.flash = { error: 'Passwords do not match.' };
      return res.redirect('/auth/register');
    }

    const cleanEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      req.session.flash = { error: 'An account with this email address already exists. Please sign in.' };
      return res.redirect('/auth/login');
    }

    const passwordHash = await User.hashPassword(password);
    const newUser = await User.create({
      hospitalId: hospital._id,
      name: name.trim(),
      email: cleanEmail,
      passwordHash,
      role: 'reporter',
      departmentIds: departmentId ? [departmentId] : [],
      phone: phone ? phone.trim() : undefined,
      isActive: true,
      lastLoginAt: new Date(),
    });

    req.session.user = {
      _id: newUser._id.toString(),
      name: newUser.name,
      email: newUser.email,
      role: 'reporter',
      hospitalId: hospital._id.toString(),
      departmentIds: (newUser.departmentIds || []).map(d => d.toString()),
    };

    req.session.flash = { success: `Welcome to WardFlow, ${newUser.name}! Your reporter account is ready.` };
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Registration error:', err);
    req.session.flash = { error: 'Registration failed. Please try again.' };
    res.redirect('/auth/register');
  }
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
