const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const Hospital = require('../models/Hospital');
const User = require('../models/User');
const Department = require('../models/Department');
const Ticket = require('../models/Ticket');
const Counter = require('../models/Counter');
const { addHours, subHours } = require('date-fns');

let hospitalA;
let hospitalB;
let adminA;
let supervisorA;
let staffA;
let deptA1;
let deptA2;
let deptB1;
let agentAdminA;
let agentSupervisorA;
let agentStaffA;

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/wardflow_test');
  }

  await Hospital.deleteMany({});
  await User.deleteMany({});
  await Department.deleteMany({});
  await Ticket.deleteMany({});
  await Counter.deleteMany({});
  hospitalA = await Hospital.create({
    name: 'Analytics Hospital A',
    slug: 'analytics-hosp-a',
    timezone: 'Asia/Kolkata',
  });

  deptA1 = await Department.create({
    hospitalId: hospitalA._id,
    name: 'Maintenance & Facilities',
    code: 'MNT',
    isActive: true,
  });

  deptA2 = await Department.create({
    hospitalId: hospitalA._id,
    name: 'Electrical Engineering',
    code: 'EE',
    isActive: true,
  });

  adminA = await User.create({
    hospitalId: hospitalA._id,
    name: 'Admin A',
    email: 'adminA@analytics.com',
    passwordHash: await User.hashPassword('Pass@1234'),
    role: 'hospital_admin',
    isActive: true,
  });

  supervisorA = await User.create({
    hospitalId: hospitalA._id,
    name: 'Supervisor A',
    email: 'supervisorA@analytics.com',
    passwordHash: await User.hashPassword('Pass@1234'),
    role: 'supervisor',
    departmentIds: [deptA1._id],
    isActive: true,
  });

  staffA = await User.create({
    hospitalId: hospitalA._id,
    name: 'Staff A',
    email: 'staffA@analytics.com',
    passwordHash: await User.hashPassword('Pass@1234'),
    role: 'staff',
    departmentIds: [deptA1._id],
    isActive: true,
  });
  hospitalB = await Hospital.create({
    name: 'Analytics Hospital B',
    slug: 'analytics-hosp-b',
    timezone: 'Asia/Kolkata',
  });

  deptB1 = await Department.create({
    hospitalId: hospitalB._id,
    name: 'Hospital B Dept',
    code: 'HBD',
    isActive: true,
  });
  const now = new Date();
  await Ticket.create({
    ticketNumber: 'WF-2026-00001',
    hospitalId: hospitalA._id,
    reportingDepartmentId: deptA1._id,
    category: 'facilities',
    title: 'Broken chair',
    description: 'Chair leg is broken',
    priority: 'low',
    status: 'resolved',
    reportedBy: adminA._id,
    assignedTo: staffA._id,
    acknowledgedAt: subHours(now, 10),
    dueAt: addHours(now, 20),
    resolvedAt: subHours(now, 2),
    createdAt: subHours(now, 12),
  });
  await Ticket.create({
    ticketNumber: 'WF-2026-00002',
    hospitalId: hospitalA._id,
    reportingDepartmentId: deptA2._id,
    category: 'electrical',
    title: 'Generator trip',
    description: 'Generator tripped after load test',
    priority: 'critical',
    status: 'open',
    reportedBy: adminA._id,
    assignedTo: null,
    dueAt: subHours(now, 4), // Overdue by 4 hours
    escalationLevel: 2,
    createdAt: subHours(now, 8),
  });
  await Ticket.create({
    ticketNumber: 'WF-2026-99999',
    hospitalId: hospitalB._id,
    reportingDepartmentId: deptB1._id,
    category: 'equipment',
    title: 'Hospital B Scanner issue',
    description: 'Hospital B secret scanner issue',
    priority: 'high',
    status: 'open',
    reportedBy: adminA._id,
    createdAt: now,
  });
  agentAdminA = request.agent(app);
  await agentAdminA.post('/auth/login').send({ email: 'adminA@analytics.com', password: 'Pass@1234' });

  agentSupervisorA = request.agent(app);
  await agentSupervisorA.post('/auth/login').send({ email: 'supervisorA@analytics.com', password: 'Pass@1234' });

  agentStaffA = request.agent(app);
  await agentStaffA.post('/auth/login').send({ email: 'staffA@analytics.com', password: 'Pass@1234' });
});

afterAll(async () => {
  await Hospital.deleteMany({});
  await User.deleteMany({});
  await Department.deleteMany({});
  await Ticket.deleteMany({});
  await Counter.deleteMany({});
  await mongoose.disconnect();
});

describe('Escalation & Bottleneck Analytics', () => {
  test('Unauthenticated user cannot access /analytics', async () => {
    const res = await request(app).get('/analytics');
    expect(res.status).toBe(302);
    expect(res.header.location).toBe('/auth/login');
  });

  test('Staff role is denied access (403)', async () => {
    const res = await agentStaffA.get('/analytics');
    expect(res.status).toBe(403);
  });

  test('Supervisor role can access analytics (200)', async () => {
    const res = await agentSupervisorA.get('/analytics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Escalation &amp; Bottleneck Analytics');
  });

  test('Hospital Admin can view analytics with KPI metrics and department breakdown', async () => {
    const res = await agentAdminA.get('/analytics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Total Reported');
    expect(res.text).toContain('Currently Overdue');
    expect(res.text).toContain('SLA Breach Rate');
    expect(res.text).toContain('Maintenance &amp; Facilities');
    expect(res.text).toContain('Electrical Engineering');
    expect(res.text).not.toContain('Hospital B Scanner issue');
  });

  test('Can filter analytics by department', async () => {
    const res = await agentAdminA.get(`/analytics?departmentId=${deptA2._id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Generator trip');
  });

  test('Can filter analytics by category', async () => {
    const res = await agentAdminA.get('/analytics?category=electrical');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Generator trip');
    expect(res.text).not.toContain('Broken chair');
  });

  test('Shows active overdue ticket in the Escalation Monitoring table', async () => {
    const res = await agentAdminA.get('/analytics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Active Escalation Monitoring');
    expect(res.text).toContain('WF-2026-00002');
    expect(res.text).toContain('Level 2');
  });
});
