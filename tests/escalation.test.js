const mongoose = require('mongoose');
const Hospital = require('../models/Hospital');
const User = require('../models/User');
const Department = require('../models/Department');
const Ticket = require('../models/Ticket');
const SLAPolicy = require('../models/SLAPolicy');
const TicketActivity = require('../models/TicketActivity');
const Notification = require('../models/Notification');
const escalationService = require('../services/escalationService');

let hospital, dept, manager, ticket;

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/wardflow_test');
  }
  await Promise.all([Hospital.deleteMany({}), User.deleteMany({}), Department.deleteMany({}), Ticket.deleteMany({}), SLAPolicy.deleteMany({}), Notification.deleteMany({}), TicketActivity.deleteMany({})]);

  hospital = await Hospital.create({ name: 'Escalation Test Hospital', slug: 'esc-test', timezone: 'Asia/Kolkata' });
  dept = await Department.create({ hospitalId: hospital._id, name: 'Maintenance', code: 'MAINT' });
  manager = await User.create({
    hospitalId: hospital._id,
    name: 'Manager',
    email: 'mgr@test.com',
    passwordHash: 'dummy_hash',
    role: 'operations_manager',
    isActive: true,
    departmentIds: [dept._id],
  });

  await SLAPolicy.create({ hospitalId: hospital._id, priority: 'high', acknowledgementHours: 1, responseHours: 2, resolutionHours: 4, isActive: true });

  // Create an overdue ticket
  ticket = await Ticket.create({
    ticketNumber: 'WF-ESC-00001',
    hospitalId: hospital._id,
    reportingDepartmentId: dept._id,
    category: 'equipment',
    title: 'Overdue equipment fault',
    description: 'This ticket is overdue for testing.',
    priority: 'high',
    status: 'assigned',
    reportedBy: manager._id,
    assignedTo: manager._id,
    dueAt: new Date(Date.now() - 5 * 3600000), // 5 hours overdue
  });
});

afterAll(async () => {
  await Promise.all([Hospital.deleteMany({}), User.deleteMany({}), Department.deleteMany({}), Ticket.deleteMany({}), SLAPolicy.deleteMany({}), Notification.deleteMany({}), TicketActivity.deleteMany({})]);
  await mongoose.disconnect();
});

describe('Escalation Engine', () => {
  test('escalation check executes without throwing', async () => {
    await expect(escalationService.runEscalationCheck()).resolves.not.toThrow();
  });

  test('overdue ticket gets escalated and escalationLevel incremented', async () => {
    await escalationService.runEscalationCheck();
    const updated = await Ticket.findById(ticket._id);
    expect(updated.escalationLevel).toBeGreaterThan(0);
    expect(updated.lastEscalatedAt).toBeTruthy();
  });

  test('escalation creates notification for manager', async () => {
    const notifications = await Notification.find({ ticketId: ticket._id, type: 'escalation' });
    expect(notifications.length).toBeGreaterThan(0);
  });

  test('escalation creates activity log entry', async () => {
    const activities = await TicketActivity.find({ ticketId: ticket._id, type: 'escalated' });
    expect(activities.length).toBeGreaterThan(0);
  });
});
