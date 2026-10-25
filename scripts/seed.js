require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const connectDB = require('../config/database');
const Hospital = require('../models/Hospital');
const User = require('../models/User');
const Department = require('../models/Department');
const SLAPolicy = require('../models/SLAPolicy');
const Ticket = require('../models/Ticket');
const TicketActivity = require('../models/TicketActivity');
const Counter = require('../models/Counter');
const QRAsset = require('../models/QRAsset');

const seed = async () => {
  await connectDB();
  console.log('🌱 Seeding WardFlow Hospital Operations Database...');
  await Promise.all([
    Hospital.deleteMany({}),
    User.deleteMany({}),
    Department.deleteMany({}),
    SLAPolicy.deleteMany({}),
    Ticket.deleteMany({}),
    TicketActivity.deleteMany({}),
    Counter.deleteMany({}),
    QRAsset.deleteMany({}),
  ]);
  console.log('✓ Cleared previous database collections');
  const hospital = await Hospital.create({
    name: 'City Care Hospital',
    slug: 'city-care',
    address: '14, Medical Colony, Pune, Maharashtra 411001',
    phone: '+91-20-12345678',
    timezone: 'Asia/Kolkata',
    businessHours: { start: '08:00', end: '20:00', workDays: [1, 2, 3, 4, 5, 6] },
    settings: { requireVerification: true, allowReporterView: true },
  });
  console.log(`✓ Hospital Tenant: ${hospital.name}`);
  const deptData = [
    { name: 'General Ward', code: 'GW01' },
    { name: 'ICU (Intensive Care Unit)', code: 'ICU01' },
    { name: 'Maintenance & Facilities', code: 'MAINT' },
    { name: 'Housekeeping & Sanitation', code: 'HK01' },
    { name: 'Central Pharmacy', code: 'PHARM' },
    { name: 'Radiology & Imaging', code: 'RAD01' },
    { name: 'Operation Theatre (OT)', code: 'OT01' },
  ];
  const departments = await Department.insertMany(
    deptData.map(d => ({
      hospitalId: hospital._id,
      name: d.name,
      code: d.code,
      isActive: true,
    }))
  );
  console.log(`✓ Departments: ${departments.map(d => d.name).join(', ')}`);
  const hash = (pw) => bcrypt.hash(pw, 12);
  const users = await User.create([
    {
      hospitalId: hospital._id,
      name: 'Admin User',
      email: 'admin@citycare.in',
      passwordHash: await hash('Admin@1234'),
      role: 'hospital_admin',
      departmentIds: departments.map(d => d._id),
      phone: '+91 98230 11111',
      isActive: true,
    },
    {
      hospitalId: hospital._id,
      name: 'Dr. Ramesh Ops',
      email: 'ops@citycare.in',
      passwordHash: await hash('Ops@1234'),
      role: 'operations_manager',
      departmentIds: departments.map(d => d._id),
      phone: '+91 98230 22222',
      isActive: true,
    },
    {
      hospitalId: hospital._id,
      name: 'Sunita Sharma',
      email: 'supervisor@citycare.in',
      passwordHash: await hash('Super@1234'),
      role: 'supervisor',
      departmentIds: [departments[0]._id, departments[1]._id],
      phone: '+91 98230 33333',
      isActive: true,
    },
    {
      hospitalId: hospital._id,
      name: 'Rajan Maintenance',
      email: 'maintenance@citycare.in',
      passwordHash: await hash('Staff@1234'),
      role: 'staff',
      departmentIds: [departments[2]._id],
      phone: '+91 98230 44444',
      isActive: true,
    },
    {
      hospitalId: hospital._id,
      name: 'Priya Reporter',
      email: 'reporter@citycare.in',
      passwordHash: await hash('Report@1234'),
      role: 'reporter',
      departmentIds: [departments[0]._id],
      phone: '+91 98230 55555',
      isActive: true,
    },
  ]);
  console.log(`✓ Users created: ${users.map(u => u.email).join(', ')}`);
  await Department.findByIdAndUpdate(departments[0]._id, { supervisorId: users[2]._id });
  await Department.findByIdAndUpdate(departments[1]._id, { supervisorId: users[2]._id });
  await SLAPolicy.create([
    { hospitalId: hospital._id, priority: 'critical', acknowledgementHours: 0.5, responseHours: 1, resolutionHours: 2, useBusinessHours: false },
    { hospitalId: hospital._id, priority: 'high', acknowledgementHours: 1, responseHours: 2, resolutionHours: 4, useBusinessHours: true },
    { hospitalId: hospital._id, priority: 'medium', acknowledgementHours: 4, responseHours: 8, resolutionHours: 24, useBusinessHours: true },
    { hospitalId: hospital._id, priority: 'low', acknowledgementHours: 8, responseHours: 24, resolutionHours: 72, useBusinessHours: true },
  ]);
  console.log('✓ SLA Policies created for low, medium, high, and critical priorities');
  const now = new Date();
  const sampleTickets = [
    {
      ticketNumber: 'WF-2026-00001',
      hospitalId: hospital._id,
      reportingDepartmentId: departments[0]._id,
      assignedDepartmentId: departments[2]._id,
      category: 'plumbing',
      title: 'Water leakage near second-floor washroom',
      description: 'Water is leaking from a pipe fitting near the corridor washroom on the second floor. Corridor floor is slippery and requires immediate containment.',
      priority: 'high',
      status: 'in_progress',
      reportedBy: users[4]._id,
      assignedTo: users[3]._id,
      assignedTeam: 'Plumbing & Facilities',
      dueAt: new Date(now.getTime() + 4 * 3600000),
      acknowledgedAt: new Date(now.getTime() - 30 * 60000),
      workStartedAt: new Date(now.getTime() - 15 * 60000),
    },
    {
      ticketNumber: 'WF-2026-00002',
      hospitalId: hospital._id,
      reportingDepartmentId: departments[1]._id,
      category: 'equipment',
      title: 'Faulty suction pump in ICU Room 3',
      description: 'The suction pump in ICU Room 3 is making high-pitch screeching noise and intermittently failing. Replaced with standby unit for now.',
      priority: 'critical',
      status: 'assigned',
      reportedBy: users[2]._id,
      assignedTo: users[3]._id,
      assignedTeam: 'Biomedical Engineering',
      dueAt: new Date(now.getTime() - 2 * 3600000), // OVERDUE for dashboard demo
      acknowledgedAt: new Date(now.getTime() - 3600000),
      escalationLevel: 1,
      lastEscalatedAt: new Date(now.getTime() - 60000),
    },
    {
      ticketNumber: 'WF-2026-00003',
      hospitalId: hospital._id,
      reportingDepartmentId: departments[3]._id,
      category: 'housekeeping',
      title: 'Corridor spillage cleanup required — Ward B',
      description: 'Ward B corridor has spillage near the central nurse station that needs deep sanitization and mop cleanup.',
      priority: 'medium',
      status: 'open',
      reportedBy: users[4]._id,
      dueAt: new Date(now.getTime() + 20 * 3600000),
    },
    {
      ticketNumber: 'WF-2026-00004',
      hospitalId: hospital._id,
      reportingDepartmentId: departments[0]._id,
      category: 'electrical',
      title: 'Flickering LED panel in General Ward Room 5',
      description: 'Overhead light fixture in Room 5 of General Ward is flickering continuously, causing patient discomfort.',
      priority: 'low',
      status: 'closed',
      reportedBy: users[4]._id,
      assignedTo: users[3]._id,
      dueAt: new Date(now.getTime() - 48 * 3600000),
      resolvedAt: new Date(now.getTime() - 24 * 3600000),
      verifiedAt: new Date(now.getTime() - 20 * 3600000),
      closedAt: new Date(now.getTime() - 20 * 3600000),
      resolutionSummary: 'Replaced ballast and tube panel with 36W LED luminaire. Verified functional.',
      verifiedBy: users[2]._id,
    },
    {
      ticketNumber: 'WF-2026-00005',
      hospitalId: hospital._id,
      reportingDepartmentId: departments[4]._id,
      category: 'supplies',
      title: 'Low stock notification — IV Normal Saline 500ml',
      description: 'Central Pharmacy reports IV Normal Saline 500ml reserves have fallen below 3-day buffer threshold. Emergency restock required.',
      priority: 'high',
      status: 'open',
      reportedBy: users[1]._id,
      dueAt: new Date(now.getTime() + 6 * 3600000),
    },
  ];

  const createdTickets = await Ticket.insertMany(sampleTickets);
  const token1 = QRAsset.generateToken();
  const token2 = QRAsset.generateToken();
  await QRAsset.create([
    {
      hospitalId: hospital._id,
      departmentId: departments[1]._id, // ICU
      name: 'ICU Critical Care Ventilator #04',
      assetCode: 'VENT-ICU-04',
      assetType: 'equipment',
      location: 'Building A, 2nd Floor, ICU Bed 4',
      description: 'Philips Respironics V60 Plus dedicated for intensive care.',
      reportingToken: token1.rawToken,
      tokenHash: token1.tokenHash,
      createdBy: users[0]._id,
      isActive: true,
    },
    {
      hospitalId: hospital._id,
      departmentId: departments[2]._id, // Maintenance
      name: 'Generator Room Backup DG-1',
      assetCode: 'GEN-MNT-01',
      assetType: 'facility',
      location: 'Basement 1, Utility Corridor North',
      description: '500 kVA Cummins diesel generator set.',
      reportingToken: token2.rawToken,
      tokenHash: token2.tokenHash,
      createdBy: users[1]._id,
      isActive: true,
    },
  ]);
  console.log('✓ Sample QR Assets seeded (ICU Ventilator #04, Backup DG-1)');
  await TicketActivity.insertMany([
    { ticketId: createdTickets[0]._id, hospitalId: hospital._id, actorId: users[4]._id, actorName: users[4].name, type: 'created', description: "Ticket created with priority 'high' in category 'plumbing'" },
    { ticketId: createdTickets[0]._id, hospitalId: hospital._id, actorId: users[1]._id, actorName: users[1].name, type: 'assigned', description: `Assigned to ${users[3].name}` },
    { ticketId: createdTickets[0]._id, hospitalId: hospital._id, actorId: users[3]._id, actorName: users[3].name, type: 'status_changed', description: "Status changed from 'assigned' to 'in_progress'", previousValue: 'assigned', newValue: 'in_progress' },
    { ticketId: createdTickets[1]._id, hospitalId: hospital._id, actorId: users[2]._id, actorName: users[2].name, type: 'created', description: "Ticket created with priority 'critical' in category 'equipment'" },
    { ticketId: createdTickets[1]._id, hospitalId: hospital._id, actorId: users[1]._id, actorName: users[1].name, type: 'escalated', description: 'Auto-escalated (overdue) to operations_manager' },
    { ticketId: createdTickets[3]._id, hospitalId: hospital._id, actorId: users[4]._id, actorName: users[4].name, type: 'created', description: "Ticket created with priority 'low' in category 'electrical'" },
    { ticketId: createdTickets[3]._id, hospitalId: hospital._id, actorId: users[3]._id, actorName: users[3].name, type: 'resolved', description: 'Marked as resolved. Replaced ballast and tube panel.' },
    { ticketId: createdTickets[3]._id, hospitalId: hospital._id, actorId: users[2]._id, actorName: users[2].name, type: 'verified', description: `Verified and closed by ${users[2].name}` },
  ]);
  await Counter.create({ key: `ticket_${hospital._id}_2026`, seq: 5 });

  console.log(`✓ Sample tickets seeded: ${createdTickets.map(t => t.ticketNumber).join(', ')}`);
  console.log('\n======================================================');
  console.log('🎉 WardFlow MVP Database Seeding Successfully Completed!');
  console.log('======================================================\n');
  console.log('Login credentials:');
  console.log('  Hospital Admin:      admin@citycare.in       / Admin@1234');
  console.log('  Operations Manager:  ops@citycare.in         / Ops@1234');
  console.log('  Dept Supervisor:     supervisor@citycare.in  / Super@1234');
  console.log('  Support Staff:       maintenance@citycare.in / Staff@1234');
  console.log('  Issue Reporter:      reporter@citycare.in    / Report@1234\n');

  await mongoose.disconnect();
  process.exit(0);
};

seed().catch(err => {
  console.error('Seed execution error:', err);
  process.exit(1);
});
