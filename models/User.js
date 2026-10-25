const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = ['reporter', 'staff', 'supervisor', 'operations_manager', 'hospital_admin', 'platform_admin'];

const userSchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: function() { return this.role !== 'platform_admin'; } },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ROLES, required: true, default: 'reporter' },
  departmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  phone: { type: String, trim: true },
  isActive: { type: Boolean, default: true },
  lastLoginAt: Date,
  passwordChangedAt: Date,
}, { timestamps: true });

userSchema.index({ hospitalId: 1, email: 1 });
userSchema.index({ hospitalId: 1, role: 1 });

userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

userSchema.statics.hashPassword = async (password) => {
  return bcrypt.hash(password, 12);
};

userSchema.virtual('displayRole').get(function() {
  const labels = {
    reporter: 'Reporter',
    staff: 'Support Staff',
    supervisor: 'Department Supervisor',
    operations_manager: 'Operations Manager',
    hospital_admin: 'Hospital Administrator',
    platform_admin: 'Platform Admin',
  };
  return labels[this.role] || this.role;
});

module.exports = mongoose.model('User', userSchema);
