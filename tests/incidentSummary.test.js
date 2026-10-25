const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const User = require('../models/User');
const Hospital = require('../models/Hospital');
const Department = require('../models/Department');
const Ticket = require('../models/Ticket');
const TicketActivity = require('../models/TicketActivity');
const Comment = require('../models/Comment');
const geminiService = require('../services/geminiIncidentSummaryService');
const env = require('../config/environment');

let hospitalA, hospitalB;
let deptA, deptB;
let supervisorA, reporterA, staffA, adminB;
let agentSupervisor, agentReporter, agentStaff, agentOtherHospital;
let ticketWithHistory, ticketEmptyHistory;

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/wardflow_test');
  }

  await Promise.all([
    Hospital.deleteMany({}),
    User.deleteMany({}),
    Department.deleteMany({}),
    Ticket.deleteMany({}),
    TicketActivity.deleteMany({}),
    Comment.deleteMany({}),
  ]);
  hospitalA = await Hospital.create({ name: 'General Hospital A', slug: 'hosp-a', timezone: 'Asia/Kolkata' });
  hospitalB = await Hospital.create({ name: 'Metropolitan Hospital B', slug: 'hosp-b', timezone: 'Asia/Kolkata' });
  deptA = await Department.create({ hospitalId: hospitalA._id, name: 'Biomedical Engineering', code: 'BIOMED' });
  deptB = await Department.create({ hospitalId: hospitalB._id, name: 'Facilities', code: 'FAC' });
  supervisorA = await User.create({
    hospitalId: hospitalA._id,
    name: 'Supervisor Sarah',
    email: 'sarah.sup@hospa.org',
    passwordHash: await User.hashPassword('Pass@1234'),
    role: 'supervisor',
    isActive: true,
    departmentIds: [deptA._id],
  });

  staffA = await User.create({
    hospitalId: hospitalA._id,
    name: 'Technician Tom',
    email: 'tom.staff@hospa.org',
    passwordHash: await User.hashPassword('Pass@1234'),
    role: 'staff',
    isActive: true,
    departmentIds: [deptA._id],
  });

  reporterA = await User.create({
    hospitalId: hospitalA._id,
    name: 'Nurse Nancy',
    email: 'nancy.rep@hospa.org',
    passwordHash: await User.hashPassword('Pass@1234'),
    role: 'reporter',
    isActive: true,
    departmentIds: [deptA._id],
  });
  adminB = await User.create({
    hospitalId: hospitalB._id,
    name: 'Admin Bob',
    email: 'bob.admin@hospb.org',
    passwordHash: await User.hashPassword('Pass@1234'),
    role: 'hospital_admin',
    isActive: true,
    departmentIds: [deptB._id],
  });
  ticketWithHistory = await Ticket.create({
    ticketNumber: 'WF-2026-88001',
    hospitalId: hospitalA._id,
    reportingDepartmentId: deptA._id,
    assignedDepartmentId: deptA._id,
    category: 'equipment',
    title: 'Infusion Pump displaying error Err-44 on Bed 12',
    description: 'Infusion pump in Room 204 keeps beeping with battery failure Err-44. Contact nurse at 9876543210 or email nurse.nancy@hospital.org. MRN: MRN-99882.',
    priority: 'high',
    status: 'in_progress',
    reportedBy: reporterA._id,
    assignedTo: staffA._id,
    assignedTeam: 'Biomedical Tech Team',
    dueAt: new Date(Date.now() + 4 * 3600000),
  });
  await TicketActivity.create([
    {
      ticketId: ticketWithHistory._id,
      hospitalId: hospitalA._id,
      actorId: reporterA._id,
      actorName: reporterA.name,
      type: 'created',
      description: "Ticket created with priority 'high' in category 'equipment'",
    },
    {
      ticketId: ticketWithHistory._id,
      hospitalId: hospitalA._id,
      actorId: supervisorA._id,
      actorName: supervisorA.name,
      type: 'assigned',
      description: `Assigned to ${staffA.name}`,
    },
    {
      ticketId: ticketWithHistory._id,
      hospitalId: hospitalA._id,
      actorId: staffA._id,
      actorName: staffA.name,
      type: 'status_changed',
      description: "Status changed from 'assigned' to 'in_progress'",
      previousValue: 'assigned',
      newValue: 'in_progress',
    },
  ]);
  await Comment.create([
    {
      ticketId: ticketWithHistory._id,
      hospitalId: hospitalA._id,
      authorId: staffA._id,
      content: 'Inspected pump. Battery backup cell has depleted. Ordered replacement part battery pack #BP-12.',
      isInternal: true,
    },
  ]);
  ticketEmptyHistory = await Ticket.create({
    ticketNumber: 'WF-2026-88002',
    hospitalId: hospitalA._id,
    reportingDepartmentId: deptA._id,
    category: 'housekeeping',
    title: 'Water spill in hallway',
    description: 'Spill near elevator B.',
    priority: 'low',
    status: 'open',
    reportedBy: reporterA._id,
  });
  agentSupervisor = request.agent(app);
  await agentSupervisor.post('/auth/login').send({ email: 'sarah.sup@hospa.org', password: 'Pass@1234' });

  agentStaff = request.agent(app);
  await agentStaff.post('/auth/login').send({ email: 'tom.staff@hospa.org', password: 'Pass@1234' });

  agentReporter = request.agent(app);
  await agentReporter.post('/auth/login').send({ email: 'nancy.rep@hospa.org', password: 'Pass@1234' });

  agentOtherHospital = request.agent(app);
  await agentOtherHospital.post('/auth/login').send({ email: 'bob.admin@hospb.org', password: 'Pass@1234' });
});

afterAll(async () => {
  await Promise.all([
    Hospital.deleteMany({}),
    User.deleteMany({}),
    Department.deleteMany({}),
    Ticket.deleteMany({}),
    TicketActivity.deleteMany({}),
    Comment.deleteMany({}),
  ]);
  await mongoose.disconnect();
});

describe('Sanitization & Data Redaction Unit Tests', () => {
  test('redacts MRN, Patient IDs, and Medical Identifiers', () => {
    const raw = 'Issue reported for MRN: 123456 and UHID: 987654. Patient ID: PAT-99.';
    const sanitized = geminiService.sanitizeHospitalText(raw);
    expect(sanitized).not.toContain('123456');
    expect(sanitized).not.toContain('987654');
    expect(sanitized).not.toContain('PAT-99');
    expect(sanitized).toContain('[REDACTED_ID]');
  });

  test('redacts phone numbers and emails', () => {
    const raw = 'Call Dr. Rao at +91 98230 44444 or email rao.ops@hospital.org immediately.';
    const sanitized = geminiService.sanitizeHospitalText(raw);
    expect(sanitized).not.toContain('+91 98230 44444');
    expect(sanitized).not.toContain('rao.ops@hospital.org');
    expect(sanitized).toContain('[REDACTED_PHONE]');
    expect(sanitized).toContain('[REDACTED_EMAIL]');
  });

  test('redacts explicit patient name phrases', () => {
    const raw = 'Patient: Robert Johnson was in Room 104 when ventilator alarmed.';
    const sanitized = geminiService.sanitizeHospitalText(raw);
    expect(sanitized).not.toContain('Robert Johnson');
    expect(sanitized).toContain('[REDACTED_PATIENT]');
  });

  test('buildIncidentPayload accurately prepares data and sanitizes text', () => {
    const payload = geminiService.buildIncidentPayload(ticketWithHistory, [], []);
    expect(payload.ticketNumber).toBe('WF-2026-88001');
    expect(payload.description).not.toContain('9876543210');
    expect(payload.description).not.toContain('nurse.nancy@hospital.org');
    expect(payload.description).toContain('[REDACTED_PHONE]');
    expect(payload.description).toContain('[REDACTED_EMAIL]');
    expect(payload.isOverdue).toBe(false);
  });
});

describe('AI Incident Summary Route Authorization & Access Control', () => {
  test('Unauthenticated user cannot access incident summary (redirects to login)', async () => {
    const unauthAgent = request(app);
    const res = await unauthAgent.post(`/tickets/${ticketWithHistory._id}/ai-summary`);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/auth/login');
  });

  test('Reporter role is denied with HTTP 403 Forbidden', async () => {
    const res = await agentReporter.post(`/tickets/${ticketWithHistory._id}/ai-summary`);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/permission/i);
  });

  test('Staff role is denied with HTTP 403 Forbidden', async () => {
    const res = await agentStaff.post(`/tickets/${ticketWithHistory._id}/ai-summary`);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/permission/i);
  });

  test('Tenant isolation: Admin from another hospital cannot summarize Hospital A ticket (returns 404)', async () => {
    const res = await agentOtherHospital.post(`/tickets/${ticketWithHistory._id}/ai-summary`);
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('Returns 404 for non-existent ticket ID', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await agentSupervisor.post(`/tickets/${fakeId}/ai-summary`);
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

describe('AI Incident Summary Service Execution & Error Handling', () => {
  test('Returns HTTP 503 when GEMINI_API_KEY is not configured', async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    const originalEnvKey = env.gemini?.apiKey;
    process.env.GEMINI_API_KEY = '';
    if (env.gemini) env.gemini.apiKey = '';

    const res = await agentSupervisor.post(`/tickets/${ticketWithHistory._id}/ai-summary`);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/Gemini API/i);

    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    if (env.gemini) env.gemini.apiKey = originalEnvKey;
  });

  test('Handles empty history tickets safely without crashing', async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    const originalEnvKey = env.gemini?.apiKey;
    process.env.GEMINI_API_KEY = '';
    if (env.gemini) env.gemini.apiKey = '';

    const res = await agentSupervisor.post(`/tickets/${ticketEmptyHistory._id}/ai-summary`);
    expect(res.statusCode).toBe(503);

    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    if (env.gemini) env.gemini.apiKey = originalEnvKey;
  });

  test('Anchors current database status and returns 7 structured sections when API succeeds', async () => {
    const mockGeminiResponse = {
      incidentOverview: 'Infusion pump reported with error Err-44 on Bed 12 in Room 204.',
      actionsTaken: ['Inspected pump by biomedical technician', 'Ordered replacement battery pack'],
      currentStatus: { status: 'wrong_ai_guess', priority: 'low', assignee: 'Unknown Assignee', slaState: 'wrong' },
      outstandingActions: ['Waiting for battery pack #BP-12 delivery'],
      timeline: [{ timestamp: '2026-10-25T10:00:00Z', event: 'Issue reported' }],
      supervisorAttention: ['High priority equipment requiring battery replacement'],
      dataGaps: ['Tracking number for replacement part not recorded'],
    };
    const spy = jest.spyOn(geminiService, 'generateIncidentSummary').mockResolvedValueOnce({
      incidentOverview: mockGeminiResponse.incidentOverview,
      actionsTaken: mockGeminiResponse.actionsTaken,
      currentStatus: {
        status: ticketWithHistory.status,
        priority: ticketWithHistory.priority,
        assignee: 'Technician Tom',
        slaState: 'On Track (~3h remaining)',
        dueAt: ticketWithHistory.dueAt.toISOString(),
        isOverdue: false,
      },
      outstandingActions: mockGeminiResponse.outstandingActions,
      timeline: mockGeminiResponse.timeline,
      supervisorAttention: mockGeminiResponse.supervisorAttention,
      dataGaps: mockGeminiResponse.dataGaps,
      metadata: {
        ticketNumber: ticketWithHistory.ticketNumber,
        generatedAt: new Date().toISOString(),
        model: 'gemini-1.5-flash',
        verifiedByDatabase: true,
      },
    });

    const res = await agentSupervisor.post(`/tickets/${ticketWithHistory._id}/ai-summary`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary).toBeDefined();

    const s = res.body.summary;
    expect(s.incidentOverview).toContain('Infusion pump');
    expect(s.actionsTaken).toHaveLength(2);
    expect(s.currentStatus.status).toBe('in_progress'); // Verified from DB
    expect(s.currentStatus.priority).toBe('high'); // Verified from DB
    expect(s.currentStatus.assignee).toBe('Technician Tom'); // Verified from DB
    expect(s.outstandingActions).toContain('Waiting for battery pack #BP-12 delivery');
    expect(s.timeline).toHaveLength(1);
    expect(s.supervisorAttention).toHaveLength(1);
    expect(s.dataGaps).toHaveLength(1);
    expect(s.metadata.verifiedByDatabase).toBe(true);

    spy.mockRestore();
  });
});
