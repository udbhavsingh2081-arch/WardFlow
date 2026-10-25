const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const Hospital = require('../models/Hospital');
const User = require('../models/User');
const Department = require('../models/Department');
const QRAsset = require('../models/QRAsset');
const Ticket = require('../models/Ticket');
const Counter = require('../models/Counter');

let hospital;
let adminUser;
let managerUser;
let staffUser;
let department;
let agentAdmin;
let agentManager;
let agentStaff;

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/wardflow_test');
  }

  await Hospital.deleteMany({});
  await User.deleteMany({});
  await Department.deleteMany({});
  await QRAsset.deleteMany({});
  await Ticket.deleteMany({});
  await Counter.deleteMany({});

  hospital = await Hospital.create({
    name: 'QR Test Hospital',
    slug: 'qr-test-hospital',
    timezone: 'Asia/Kolkata',
  });

  department = await Department.create({
    hospitalId: hospital._id,
    name: 'Biomedical Engineering',
    code: 'BME',
    isActive: true,
  });

  adminUser = await User.create({
    hospitalId: hospital._id,
    name: 'QR Admin',
    email: 'qradmin@test.com',
    passwordHash: await User.hashPassword('Pass@12345'),
    role: 'hospital_admin',
    isActive: true,
  });

  managerUser = await User.create({
    hospitalId: hospital._id,
    name: 'QR Manager',
    email: 'qrmanager@test.com',
    passwordHash: await User.hashPassword('Pass@12345'),
    role: 'operations_manager',
    isActive: true,
  });

  staffUser = await User.create({
    hospitalId: hospital._id,
    name: 'QR Staff',
    email: 'qrstaff@test.com',
    passwordHash: await User.hashPassword('Pass@12345'),
    role: 'staff',
    isActive: true,
  });

  // Login agents
  agentAdmin = request.agent(app);
  await agentAdmin.post('/auth/login').send({ email: 'qradmin@test.com', password: 'Pass@12345' });

  agentManager = request.agent(app);
  await agentManager.post('/auth/login').send({ email: 'qrmanager@test.com', password: 'Pass@12345' });

  agentStaff = request.agent(app);
  await agentStaff.post('/auth/login').send({ email: 'qrstaff@test.com', password: 'Pass@12345' });
});

afterAll(async () => {
  await Hospital.deleteMany({});
  await User.deleteMany({});
  await Department.deleteMany({});
  await QRAsset.deleteMany({});
  await Ticket.deleteMany({});
  await Counter.deleteMany({});
  await mongoose.disconnect();
});

describe('QR Asset Management & Security', () => {
  test('Unauthenticated user cannot access /qr/assets', async () => {
    const res = await request(app).get('/qr/assets');
    expect(res.status).toBe(302);
    expect(res.header.location).toBe('/auth/login');
  });

  test('Staff role cannot access /qr/assets (RBAC check)', async () => {
    const res = await agentStaff.get('/qr/assets');
    expect(res.status).toBe(403);
  });

  test('Operations Manager can access /qr/assets', async () => {
    const res = await agentManager.get('/qr/assets');
    expect(res.status).toBe(200);
    expect(res.text).toContain('QR Asset & Location Register');
  });

  test('Operations Manager can create a new QR asset', async () => {
    const res = await agentManager.post('/qr/assets').send({
      name: 'Ventilator B-101',
      assetCode: 'VENT-101',
      assetType: 'equipment',
      departmentId: department._id.toString(),
      location: 'Floor 2, ICU Bed 4',
      description: 'Critical care ventilator',
    });

    expect(res.status).toBe(302);

    const asset = await QRAsset.findOne({ name: 'Ventilator B-101' });
    expect(asset).not.toBeNull();
    expect(asset.reportingToken).toBeDefined();
    expect(asset.reportingToken.length).toBe(64);
    expect(asset.tokenHash).toBeDefined();
    expect(asset.isActive).toBe(true);
  });

  test('Can preview QR code and printable label for the created asset', async () => {
    const asset = await QRAsset.findOne({ name: 'Ventilator B-101' });
    const res = await agentManager.get(`/qr/assets/${asset._id}/qr`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Ventilator B-101');
    expect(res.text).toContain('printable-qr-label');
    expect(res.text).toContain('data:image/png;base64');
  });

  test('Can regenerate QR token, which rotates the token', async () => {
    const asset = await QRAsset.findOne({ name: 'Ventilator B-101' });
    const oldToken = asset.reportingToken;

    const res = await agentManager.post(`/qr/assets/${asset._id}/regenerate`);
    expect(res.status).toBe(302);

    const updated = await QRAsset.findById(asset._id);
    expect(updated.reportingToken).not.toBe(oldToken);

    // Old token should no longer work
    const oldLookup = await QRAsset.findByRawToken(oldToken);
    expect(oldLookup).toBeNull();
  });

  test('Can retire and reactivate a QR asset', async () => {
    const asset = await QRAsset.findOne({ name: 'Ventilator B-101' });

    // Retire
    await agentManager.post(`/qr/assets/${asset._id}/retire`);
    let updated = await QRAsset.findById(asset._id);
    expect(updated.isActive).toBe(false);

    // Retired token lookup returns null
    const lookup = await QRAsset.findByRawToken(updated.reportingToken);
    expect(lookup).toBeNull();

    // Reactivate
    await agentManager.post(`/qr/assets/${asset._id}/reactivate`);
    updated = await QRAsset.findById(asset._id);
    expect(updated.isActive).toBe(true);
  });
});

describe('Public QR Issue Reporting Flow', () => {
  let activeAsset;

  beforeAll(async () => {
    activeAsset = await QRAsset.findOne({ name: 'Ventilator B-101' });
  });

  test('GET /qr/report/:invalidToken returns 404 with friendly message', async () => {
    const res = await request(app).get('/qr/report/nonexistent-token-12345');
    expect(res.status).toBe(404);
    expect(res.text).toContain('Invalid QR Code');
  });

  test('GET /qr/report/:validToken returns 200 with prefilled form', async () => {
    const res = await request(app).get(`/qr/report/${activeAsset.reportingToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Ventilator B-101');
    expect(res.text).toContain('Biomedical Engineering');
    expect(res.text).toContain('Issue Details');
  });

  test('POST /qr/report/:validToken validates required fields (422 on empty)', async () => {
    const res = await request(app)
      .post(`/qr/report/${activeAsset.reportingToken}`)
      .send({
        reporterName: '',
        title: '',
        description: '',
        category: '',
      });

    expect(res.status).toBe(422);
    expect(res.text).toContain('Your name is required');
  });

  test('POST /qr/report/:validToken creates a real ticket with prefilled asset info', async () => {
    const res = await request(app)
      .post(`/qr/report/${activeAsset.reportingToken}`)
      .send({
        reporterName: 'Nurse Anita',
        category: 'equipment',
        priority: 'high',
        title: 'Ventilator alarm ringing constantly',
        description: 'Pressure sensor showing error code E04 and continuous beep.',
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Issue Reported!');
    expect(res.text).toContain('WF-');

    // Verify ticket in DB
    const ticket = await Ticket.findOne({ category: 'equipment' }).sort({ createdAt: -1 });
    expect(ticket).not.toBeNull();
    expect(ticket.title).toContain('[QR]');
    expect(ticket.title).toContain('Ventilator alarm ringing constantly');
    expect(ticket.description).toContain('Nurse Anita');
    expect(ticket.description).toContain('Ventilator B-101');
    expect(ticket.reportingDepartmentId.toString()).toBe(department._id.toString());
    expect(ticket.priority).toBe('high');
    expect(ticket.status).toBe('open');
  });

  test('Retired asset QR code cannot submit reports (returns 404)', async () => {
    // Retire the asset
    await QRAsset.findByIdAndUpdate(activeAsset._id, { isActive: false });

    const res = await request(app)
      .post(`/qr/report/${activeAsset.reportingToken}`)
      .send({
        reporterName: 'Nurse Anita',
        category: 'equipment',
        priority: 'high',
        title: 'Test after retirement',
        description: 'Should fail',
      });

    expect(res.status).toBe(404);
    expect(res.text).toContain('Invalid QR Code');
  });
});
