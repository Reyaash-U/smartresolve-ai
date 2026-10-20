import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../app';
import { ActivityLog, Department, Issue } from '../models';
import { seedAccounts } from '../../seed/seed';

let mongod: MongoMemoryServer;
const app = createApp({ loginRateLimitMax: 1000 });
const PW = 'Demo@12345';
const tokens: Record<string, string> = {};

const valid = {
  title: 'Lab 204 Wi-Fi is down',
  description: 'The Wi-Fi in computer lab 204 has been down since morning and nobody can connect.',
  building: 'Computer Labs',
  room: 'Lab 204',
  urgency: 'HIGH',
  affectedCount: 35,
  hazardFlag: false,
};

const auth = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
const create = (who: string, body: object = valid) => request(app).post('/issues').set(auth(who)).send(body);

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await seedAccounts(PW);
  for (const [k, email] of Object.entries({ a: 'reporter.a@example.test', b: 'reporter.b@example.test', it: 'it.staff1@example.test', fac: 'facilities.staff@example.test', admin: 'admin@example.test' })) {
    tokens[k] = (await request(app).post('/auth/login').send({ email, password: PW })).body.token;
  }
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('create issue', () => {
  it('persists a valid issue with server-owned fields and priority explanation', async () => {
    const res = await create('a');
    expect(res.status).toBe(201);
    const i = res.body.issue;
    expect(i.code).toMatch(/^SR-\d{6}$/);
    expect(i.status).toBe('ASSIGNED'); // confident IT prediction -> auto-assigned to IT staff
    expect(i.priority).toMatchObject({ level: 'P2', score: 9 });
    expect(i.priority.factors.length).toBeGreaterThan(0);
    expect(i.prediction).toMatchObject({ department: 'IT Support', needsReview: false });
    expect(i.unassignedAdminReview).toBe(false);
    expect(await Issue.countDocuments({ code: i.code })).toBe(1);
  });
  it('writes an activity entry for every automatic decision', async () => {
    const { body } = await create('a');
    const logs = await ActivityLog.find({ issueId: body.issue.id }).sort({ _id: 1 });
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['CREATED', 'PRIORITY_RECOMMENDED', 'CATEGORY_PREDICTED', 'AUTO_ASSIGNED']));
    expect(logs[0].action).toBe('CREATED');
    expect(logs.find((l) => l.action === 'CATEGORY_PREDICTED')!.actorLabel).toBe('System');
  });
  it('ignores client-supplied reporter/status/priority by rejecting them', async () => {
    const res = await create('a', { ...valid, reporterId: '64b000000000000000000000', status: 'RESOLVED' });
    expect(res.status).toBe(400);
  });
  it.each([
    ['short title', { title: 'abc' }],
    ['short description', { description: 'too short' }],
    ['overlong description', { description: 'x'.repeat(1001) }],
    ['unknown building', { building: 'Moon Base' }],
    ['affected 0', { affectedCount: 0 }],
    ['affected 501', { affectedCount: 501 }],
    ['affected 2.5', { affectedCount: 2.5 }],
    ['affected as string', { affectedCount: '35' }],
    ['bad urgency', { urgency: 'URGENT' }],
    ['object injection in title', { title: { $gt: '' } }],
  ])('rejects %s with 400 and field details', async (_n, patch) => {
    const res = await create('a', { ...valid, ...patch });
    expect(res.status).toBe(400);
    expect(res.body.details.length).toBeGreaterThan(0);
  });
  it('hazard flag forces P1 and shows emergency guidance', async () => {
    const res = await create('a', { ...valid, urgency: 'LOW', affectedCount: 1, hazardFlag: true });
    expect(res.body.issue.priority.level).toBe('P1');
    expect(res.body.issue.emergencyGuidance).toContain('emergency personnel');
  });
  it('staff cannot create reports; anonymous gets 401', async () => {
    expect((await create('it')).status).toBe(403);
    expect((await request(app).post('/issues').send(valid)).status).toBe(401);
  });
});

describe('access control', () => {
  it('Reporter B cannot read Reporter A\'s ticket by ID or its history', async () => {
    const { body } = await create('a');
    const id = body.issue.id;
    expect((await request(app).get(`/issues/${id}`).set(auth('b'))).status).toBe(404);
    expect((await request(app).get(`/issues/${id}/activity`).set(auth('b'))).status).toBe(404);
    expect((await request(app).get(`/issues/${id}`).set(auth('a'))).status).toBe(200);
  });
  it('rejects malformed IDs without a server error', async () => {
    expect((await request(app).get('/issues/not-an-id').set(auth('a'))).status).toBe(404);
  });
  it('reporter list contains only own issues', async () => {
    await create('b', { ...valid, title: 'Reporter B own issue' });
    const res = await request(app).get('/issues').set(auth('b'));
    expect(res.body.issues.length).toBeGreaterThan(0);
    expect(res.body.issues.every((i: any) => i.reporter === undefined)).toBe(true);
    expect(res.body.issues.some((i: any) => i.title === 'Reporter B own issue')).toBe(true);
    expect(res.body.issues.some((i: any) => i.title === valid.title)).toBe(false);
  });
  it('staff only sees issues in their own department', async () => {
    const it = await Department.findOne({ name: 'IT Support' });
    const fac = await Department.findOne({ name: 'Facilities' });
    const a = (await create('a', { ...valid, title: 'IT scoped issue' })).body.issue.id;
    const b = (await create('a', { ...valid, title: 'Facilities scoped issue' })).body.issue.id;
    await Issue.updateOne({ _id: a }, { departmentId: it!._id });
    await Issue.updateOne({ _id: b }, { departmentId: fac!._id });

    const list = await request(app).get('/issues').set(auth('it'));
    const titles = list.body.issues.map((i: any) => i.title);
    expect(titles).toContain('IT scoped issue');
    expect(titles).not.toContain('Facilities scoped issue');
    expect(list.body.issues[0].reporter).toBeDefined();
    expect(JSON.stringify(list.body)).not.toContain('@example.test');

    expect((await request(app).get(`/issues/${b}`).set(auth('it'))).status).toBe(404);
    expect((await request(app).get(`/issues/${a}`).set(auth('it'))).status).toBe(200);
  });
  it('admin sees everything and can filter', async () => {
    const all = await request(app).get('/issues').set(auth('admin'));
    expect(all.body.total).toBeGreaterThan(3);
    const p1 = await request(app).get('/issues?priority=P1').set(auth('admin'));
    expect(p1.body.issues.every((i: any) => i.priority.level === 'P1')).toBe(true);
    const unassigned = await request(app).get('/issues?unassigned=true').set(auth('admin'));
    expect(unassigned.body.issues.every((i: any) => i.unassignedAdminReview)).toBe(true);
  });
  it('rejects invalid or injected filters', async () => {
    expect((await request(app).get('/issues?status=BOGUS').set(auth('admin'))).status).toBe(400);
    expect((await request(app).get('/issues?status[$ne]=OPEN').set(auth('admin'))).status).toBe(400);
  });
  it('flags a backdated seeded ticket as overdue with elapsed time', async () => {
    const { body } = await create('a', { ...valid, title: 'Old ticket for overdue check' });
    // createdAt is immutable in Mongoose; seeded history is written through the raw collection.
    await Issue.collection.updateOne({ _id: new mongoose.Types.ObjectId(body.issue.id) }, { $set: { createdAt: new Date(Date.now() - 30 * 3600_000) } });
    const res = await request(app).get(`/issues/${body.issue.id}`).set(auth('a'));
    expect(res.body.issue.sla.overdue).toBe(true);
    expect(res.body.issue.sla.breached).toBe('response');
    expect(res.body.issue.sla.overdueByMs).toBeGreaterThan(0);
    const filtered = await request(app).get('/issues?overdue=true').set(auth('admin'));
    expect(filtered.body.issues.some((i: any) => i.id === body.issue.id)).toBe(true);
  });
});
