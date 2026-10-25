const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const User = require('../models/User');
const Hospital = require('../models/Hospital');
const Department = require('../models/Department');
const Ticket = require('../models/Ticket');
const SLAPolicy = require('../models/SLAPolicy');

let hospital, department, adminUser, agent;

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/wardflow_test');
  }
  await Promise.all([Hospital.deleteMany({}), User.deleteMany({}), Department.deleteMany({}), Ticket.deleteMany({}), SLAPolicy.deleteMany({})]);

  hospital = await Hospital.create({ name: 'Ticket Test Hospital', slug: 'ticket-test', timezone: 'Asia/Kolkata' });
  department = await Department.create({ hospitalId: hospital._id, name: 'Test Department', code: 'TEST' });
  adminUser = await User.create({
    hospitalId: hospital._id, name: 'Admin', email: 'ticketadmin@test.com',
    passwordHash: await User.hashPassword('Admin@1234'), role: 'hospital_admin', isActive: true,
    departmentIds: [department._id],
  });
  await SLAPolicy.create({ hospitalId: hospital._id, priority: 'medium', acknowledgementHours: 4, responseHours: 8, resolutionHours: 24 });

  // Create authenticated session
  agent = request.agent(app);
  await agent.post('/auth/login').send({ email: 'ticketadmin@test.com', password: 'Admin@1234' });
});

afterAll(async () => {
  await Promise.all([Hospital.deleteMany({}), User.deleteMany({}), Department.deleteMany({}), Ticket.deleteMany({}), SLAPolicy.deleteMany({})]);
  await mongoose.disconnect();
});

describe('Ticket CRUD', () => {
  let ticketId;

  test('GET /tickets/new returns create form', async () => {
    const res = await agent.get('/tickets/new');
    expect(res.statusCode).toBe(200);
  });

  test('POST /tickets creates a ticket with valid data', async () => {
    const res = await agent
      .post('/tickets')
      .send({
        departmentId: department._id.toString(),
        category: 'plumbing',
        title: 'Test water leak',
        description: 'Water leaking from second floor pipe',
        priority: 'medium',
      })
      .redirects(0);
    expect(res.statusCode).toBe(302);
    const ticket = await Ticket.findOne({ title: 'Test water leak' });
    expect(ticket).not.toBeNull();
    expect(ticket.ticketNumber).toMatch(/^WF-\d{4}-\d{5}$/);
    expect(ticket.status).toBe('open');
    ticketId = ticket._id.toString();
  });

  test('GET /tickets/:id returns ticket detail', async () => {
    const res = await agent.get(`/tickets/${ticketId}`);
    expect(res.statusCode).toBe(200);
  });

  test('POST /tickets/:id/status updates status to in_progress', async () => {
    await Ticket.findByIdAndUpdate(ticketId, { status: 'assigned', assignedTo: adminUser._id }, { returnDocument: 'after' });
    const res = await agent.post(`/tickets/${ticketId}/status`).send({ status: 'in_progress' }).redirects(0);
    expect(res.statusCode).toBe(302);
    const updated = await Ticket.findById(ticketId);
    expect(updated.status).toBe('in_progress');
  });

  test('POST /tickets/:id/resolve marks ticket resolved', async () => {
    const res = await agent.post(`/tickets/${ticketId}/resolve`).send({ resolutionSummary: 'Fixed the pipe' }).redirects(0);
    expect(res.statusCode).toBe(302);
    const updated = await Ticket.findById(ticketId);
    expect(updated.status).toBe('resolved');
    expect(updated.resolutionSummary).toBe('Fixed the pipe');
  });

  test('POST /tickets/:id/verify closes the ticket', async () => {
    const res = await agent.post(`/tickets/${ticketId}/verify`).redirects(0);
    expect(res.statusCode).toBe(302);
    const updated = await Ticket.findById(ticketId);
    expect(updated.status).toBe('closed');
    expect(updated.verifiedAt).toBeTruthy();
  });
});
