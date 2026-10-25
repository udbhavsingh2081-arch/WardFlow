const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const User = require('../models/User');
const Hospital = require('../models/Hospital');
const Department = require('../models/Department');
const Ticket = require('../models/Ticket');
const SLAPolicy = require('../models/SLAPolicy');

let hospital, dept;
let reporter1, reporter2, worker1, worker2, supervisorUser;
let agentReporter1, agentReporter2, agentWorker1, agentWorker2, agentSupervisor;
let ticketReporter1, ticketWorker1;

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/wardflow_test');
  }
  await Promise.all([
    Hospital.deleteMany({}),
    User.deleteMany({}),
    Department.deleteMany({}),
    Ticket.deleteMany({}),
    SLAPolicy.deleteMany({}),
  ]);

  hospital = await Hospital.create({
    name: 'Panels Test Hospital',
    slug: 'panels-test',
    timezone: 'Asia/Kolkata',
  });

  dept = await Department.create({
    hospitalId: hospital._id,
    name: 'Biomedical Engineering',
    code: 'BME',
  });

  const pwd = await User.hashPassword('Password@123');

  reporter1 = await User.create({
    hospitalId: hospital._id,
    name: 'Reporter One',
    email: 'rep1@test.com',
    passwordHash: pwd,
    role: 'reporter',
    isActive: true,
  });

  reporter2 = await User.create({
    hospitalId: hospital._id,
    name: 'Reporter Two',
    email: 'rep2@test.com',
    passwordHash: pwd,
    role: 'reporter',
    isActive: true,
  });

  worker1 = await User.create({
    hospitalId: hospital._id,
    name: 'Worker Technician 1',
    email: 'worker1@test.com',
    passwordHash: pwd,
    role: 'staff',
    isActive: true,
    departmentIds: [dept._id],
  });

  worker2 = await User.create({
    hospitalId: hospital._id,
    name: 'Worker Technician 2',
    email: 'worker2@test.com',
    passwordHash: pwd,
    role: 'staff',
    isActive: true,
    departmentIds: [dept._id],
  });

  supervisorUser = await User.create({
    hospitalId: hospital._id,
    name: 'Dept Supervisor',
    email: 'sup@test.com',
    passwordHash: pwd,
    role: 'supervisor',
    isActive: true,
    departmentIds: [dept._id],
  });

  ticketReporter1 = await Ticket.create({
    ticketNumber: 'WF-2026-88001',
    hospitalId: hospital._id,
    reportingDepartmentId: dept._id,
    category: 'equipment',
    title: 'Syringe pump alarm malfunctioning',
    description: 'Constant warning chime in room 204.',
    priority: 'high',
    reportedBy: reporter1._id,
    assignedTo: worker1._id,
    status: 'assigned',
  });

  ticketWorker1 = await Ticket.create({
    ticketNumber: 'WF-2026-88002',
    hospitalId: hospital._id,
    reportingDepartmentId: dept._id,
    category: 'facilities',
    title: 'Ceiling drip in corridor',
    description: 'Water dripping near radiology.',
    priority: 'medium',
    reportedBy: reporter2._id,
    assignedTo: worker2._id,
    status: 'assigned',
  });

  agentReporter1 = request.agent(app);
  agentReporter2 = request.agent(app);
  agentWorker1 = request.agent(app);
  agentWorker2 = request.agent(app);
  agentSupervisor = request.agent(app);

  await agentReporter1.post('/auth/login').send({ email: 'rep1@test.com', password: 'Password@123' });
  await agentReporter2.post('/auth/login').send({ email: 'rep2@test.com', password: 'Password@123' });
  await agentWorker1.post('/auth/login').send({ email: 'worker1@test.com', password: 'Password@123' });
  await agentWorker2.post('/auth/login').send({ email: 'worker2@test.com', password: 'Password@123' });
  await agentSupervisor.post('/auth/login').send({ email: 'sup@test.com', password: 'Password@123' });
});

afterAll(async () => {
  await Promise.all([
    Hospital.deleteMany({}),
    User.deleteMany({}),
    Department.deleteMany({}),
    Ticket.deleteMany({}),
    SLAPolicy.deleteMany({}),
  ]);
  await mongoose.disconnect();
});

describe('Role Panels & Strict Authorization', () => {
  describe('Normal User (Reporter) Panel', () => {
    test('GET /dashboard renders Normal User Service Portal', async () => {
      const res = await agentReporter1.get('/dashboard');
      expect(res.statusCode).toBe(200);
      expect(res.text).toContain('Service Portal');
      expect(res.text).toContain('My Submitted Requests');
    });

    test('Reporter can view their own reported ticket', async () => {
      const res = await agentReporter1.get(`/tickets/${ticketReporter1._id}`);
      expect(res.statusCode).toBe(200);
      expect(res.text).toContain('WF-2026-88001');
    });

    test('Reporter CANNOT view another users ticket (403 Forbidden)', async () => {
      const res = await agentReporter1.get(`/tickets/${ticketWorker1._id}`);
      expect(res.statusCode).toBe(403);
    });

    test('Reporter CANNOT update ticket status (403 Forbidden)', async () => {
      const res = await agentReporter1.post(`/tickets/${ticketReporter1._id}/status`).send({ status: 'in_progress' });
      expect(res.statusCode).toBe(403);
    });

    test('Reporter ticket list only contains their own requests', async () => {
      const res = await agentReporter1.get('/tickets');
      expect(res.statusCode).toBe(200);
      expect(res.text).toContain('WF-2026-88001');
      expect(res.text).not.toContain('WF-2026-88002');
    });
  });

  describe('Worker (Staff) Panel', () => {
    test('GET /dashboard renders Worker Task Queue', async () => {
      const res = await agentWorker1.get('/dashboard');
      expect(res.statusCode).toBe(200);
      expect(res.text).toContain('Worker Task Queue');
      expect(res.text).toContain('Immediate Assigned Tasks');
    });

    test('Worker CANNOT update status on ticket assigned to another worker (403 Forbidden)', async () => {
      const res = await agentWorker1.post(`/tickets/${ticketWorker1._id}/status`).send({ status: 'in_progress' });
      expect(res.statusCode).toBe(403);
    });

    test('Worker can update status on their assigned ticket to in_progress', async () => {
      const res = await agentWorker1.post(`/tickets/${ticketReporter1._id}/status`).send({ status: 'in_progress' }).redirects(0);
      expect(res.statusCode).toBe(302);
      const updated = await Ticket.findById(ticketReporter1._id);
      expect(updated.status).toBe('in_progress');
    });

    test('Worker CANNOT transition directly to closed (must be verified by supervisor)', async () => {
      const res = await agentWorker1.post(`/tickets/${ticketReporter1._id}/status`).send({ status: 'closed' }).redirects(0);
      expect(res.statusCode).toBe(302);
      const ticket = await Ticket.findById(ticketReporter1._id);
      expect(ticket.status).toBe('in_progress'); // status remained in_progress
    });

    test('Worker can resolve their assigned ticket', async () => {
      const res = await agentWorker1.post(`/tickets/${ticketReporter1._id}/resolve`).send({
        resolutionSummary: 'Calibrated pump flow rate and verified alarms.',
      }).redirects(0);
      expect(res.statusCode).toBe(302);
      const ticket = await Ticket.findById(ticketReporter1._id);
      expect(ticket.status).toBe('resolved');
      expect(ticket.resolutionSummary).toContain('Calibrated pump');
    });

    test('Worker can access Staff QR Portal', async () => {
      const res = await agentWorker1.get('/qr/staff');
      expect(res.statusCode).toBe(200);
      expect(res.text).toContain('Staff QR Scanner');
    });
  });

  describe('Admin / Supervisor Panel & Gemini AI Analytics', () => {
    test('GET /dashboard renders Command Center for Supervisor', async () => {
      const res = await agentSupervisor.get('/dashboard');
      expect(res.statusCode).toBe(200);
      expect(res.text).toContain('Operations Command Center');
      expect(res.text).toContain('Active Requests');
    });

    test('Supervisor can access GET /analytics/ai and see aggregates and insights', async () => {
      const res = await agentSupervisor.get('/analytics/ai');
      expect(res.statusCode).toBe(200);
      expect(res.text).toContain('Gemini AI Operational Analytics');
      expect(res.text).toContain('Department Bottleneck Aggregation');
    });

    test('Reporter CANNOT access /analytics/ai (403 Forbidden)', async () => {
      const res = await agentReporter1.get('/analytics/ai').redirects(0);
      expect([302, 403]).toContain(res.statusCode);
    });
  });
});
