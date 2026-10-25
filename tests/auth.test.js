const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const User = require('../models/User');
const Hospital = require('../models/Hospital');

let hospital;
let adminUser;

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/wardflow_test');
  }
  await Hospital.deleteMany({});
  await User.deleteMany({});

  hospital = await Hospital.create({
    name: 'Test Hospital',
    slug: 'test-hospital',
    timezone: 'Asia/Kolkata',
  });

  adminUser = await User.create({
    hospitalId: hospital._id,
    name: 'Test Admin',
    email: 'testadmin@test.com',
    passwordHash: await User.hashPassword('TestPass@1234'),
    role: 'hospital_admin',
    isActive: true,
  });
});

afterAll(async () => {
  await Hospital.deleteMany({});
  await User.deleteMany({});
  await mongoose.disconnect();
});

describe('Authentication', () => {
  test('GET /auth/login returns login page', async () => {
    const res = await request(app).get('/auth/login');
    expect(res.statusCode).toBe(200);
  });

  test('POST /auth/login with valid credentials redirects to dashboard', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'testadmin@test.com', password: 'TestPass@1234' })
      .redirects(0);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/dashboard');
  });

  test('POST /auth/login with invalid credentials redirects back to login', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'testadmin@test.com', password: 'wrongpassword' })
      .redirects(0);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/auth/login');
  });

  test('POST /auth/login with inactive user is rejected', async () => {
    await User.findByIdAndUpdate(adminUser._id, { isActive: false });
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'testadmin@test.com', password: 'TestPass@1234' })
      .redirects(0);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/auth/login');
    await User.findByIdAndUpdate(adminUser._id, { isActive: true });
  });

  test('GET /tickets without session redirects to login', async () => {
    const res = await request(app).get('/tickets').redirects(0);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('/auth/login');
  });

  test('GET /auth/register returns registration page for normal users', async () => {
    const res = await request(app).get('/auth/register');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('Reporter Registration');
  });

  test('POST /auth/register creates new reporter account and logs them in', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({
        name: 'Normal Person',
        email: 'normal.person@test.com',
        password: 'Password@123',
        confirmPassword: 'Password@123',
      })
      .redirects(0);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/dashboard');

    const created = await User.findOne({ email: 'normal.person@test.com' });
    expect(created).not.toBeNull();
    expect(created.role).toBe('reporter');
  });
});
