const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const User = require('../models/User');
const Hospital = require('../models/Hospital');
const Ticket = require('../models/Ticket');
const Department = require('../models/Department');

let hospitalA, hospitalB, deptA, deptB, adminA, adminB, ticketA;
let agentA, agentB;

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/wardflow_test');
  }
  await Promise.all([Hospital.deleteMany({}), User.deleteMany({}), Department.deleteMany({}), Ticket.deleteMany({})]);

  hospitalA = await Hospital.create({ name: 'Hospital A', slug: 'hospital-a', timezone: 'Asia/Kolkata' });
  hospitalB = await Hospital.create({ name: 'Hospital B', slug: 'hospital-b', timezone: 'Asia/Kolkata' });
  deptA = await Department.create({ hospitalId: hospitalA._id, name: 'Dept A', code: 'DA' });
  deptB = await Department.create({ hospitalId: hospitalB._id, name: 'Dept B', code: 'DB' });

  adminA = await User.create({ hospitalId: hospitalA._id, name: 'Admin A', email: 'admina@test.com', passwordHash: await User.hashPassword('Pass@1234'), role: 'hospital_admin', isActive: true, departmentIds: [deptA._id] });
  adminB = await User.create({ hospitalId: hospitalB._id, name: 'Admin B', email: 'adminb@test.com', passwordHash: await User.hashPassword('Pass@1234'), role: 'hospital_admin', isActive: true, departmentIds: [deptB._id] });

  ticketA = await Ticket.create({
    ticketNumber: 'WF-2026-99001',
    hospitalId: hospitalA._id,
    reportingDepartmentId: deptA._id,
    category: 'electrical',
    title: 'Hospital A private ticket',
    description: 'This belongs to Hospital A only.',
    priority: 'low',
    reportedBy: adminA._id,
    status: 'open',
  });

  agentA = request.agent(app);
  agentB = request.agent(app);
  await agentA.post('/auth/login').send({ email: 'admina@test.com', password: 'Pass@1234' });
  await agentB.post('/auth/login').send({ email: 'adminb@test.com', password: 'Pass@1234' });
});

afterAll(async () => {
  await Promise.all([Hospital.deleteMany({}), User.deleteMany({}), Department.deleteMany({}), Ticket.deleteMany({})]);
  await mongoose.disconnect();
});

describe('Tenant Isolation & RBAC', () => {
  test('Hospital A admin can view Hospital A ticket', async () => {
    const res = await agentA.get(`/tickets/${ticketA._id}`);
    expect(res.statusCode).toBe(200);
  });

  test('Hospital B admin CANNOT view Hospital A ticket', async () => {
    const res = await agentB.get(`/tickets/${ticketA._id}`).redirects(0);
    // Should redirect with flash error, not show ticket
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/tickets');
  });

  test('Hospital B admin ticket list does not contain Hospital A ticket', async () => {
    const res = await agentB.get('/tickets');
    expect(res.statusCode).toBe(200);
    expect(res.text).not.toContain('WF-2026-99001');
  });

  test('Unauthenticated user cannot access admin panel', async () => {
    const res = await request(app).get('/admin/users').redirects(0);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('/auth/login');
  });

  test('Reporter role cannot access admin panel', async () => {
    const reporter = await User.create({
      hospitalId: hospitalA._id,
      name: 'Test Reporter',
      email: 'reporter_rbac@test.com',
      passwordHash: await User.hashPassword('Pass@1234'),
      role: 'reporter',
      isActive: true,
    });
    const agentReporter = request.agent(app);
    await agentReporter.post('/auth/login').send({ email: 'reporter_rbac@test.com', password: 'Pass@1234' });
    const res = await agentReporter.get('/admin/users').redirects(0);
    expect([302, 403]).toContain(res.statusCode);
  });
});
