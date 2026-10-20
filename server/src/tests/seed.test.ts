import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../app';
import { ActivityLog, Issue } from '../models';
import { seedAccounts } from '../../seed/seed';
import { DEMO_SPECS, seedTickets } from '../../seed/demoTickets';

let mongod: MongoMemoryServer;
const app = createApp({ loginRateLimitMax: 1000 });
const PW = 'Demo@12345';
const tokens: Record<string, string> = {};
const auth = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await seedAccounts(PW);
  const accounts = { a: 'reporter.a@example.test', b: 'reporter.b@example.test', it: 'it.staff1@example.test', it2: 'it.staff2@example.test', fac: 'facilities.staff@example.test', admin: 'admin@example.test' };
  for (const [k, email] of Object.entries(accounts)) tokens[k] = (await request(app).post('/auth/login').send({ email, password: PW })).body.token;
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('demo seed data', () => {
  it('seeds at least 30 tickets and is safe to run twice', async () => {
    const first = await seedTickets();
    expect(first.seeded).toBeGreaterThanOrEqual(30);
    expect(await Issue.countDocuments()).toBe(DEMO_SPECS.length);
    const second = await seedTickets();
    expect(second).toMatchObject({ skipped: true, seeded: 0 });
    expect(await Issue.countDocuments()).toBe(DEMO_SPECS.length);
  });

  it('has varied categories, states and priorities', async () => {
    const a = (await request(app).get('/admin/analytics').set(auth('admin'))).body;
    for (const s of ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) expect(a.byStatus[s], s).toBeGreaterThan(0);
    for (const d of ['IT Support', 'Facilities', 'Administration', 'Unrouted']) expect(a.byDepartment[d], d).toBeGreaterThan(0);
    for (const p of ['P1', 'P2', 'P3', 'P4']) expect(a.byPriority[p], p).toBeGreaterThan(0);
    expect(a.reconciliation.ok).toBe(true);
    expect(a.total).toBe(DEMO_SPECS.length);
  });

  it('includes overdue tickets of both kinds, correctly flagged from stored timestamps', async () => {
    const a = (await request(app).get('/admin/analytics').set(auth('admin'))).body;
    expect(a.overdue.response).toBeGreaterThanOrEqual(3);
    expect(a.overdue.resolution).toBeGreaterThanOrEqual(2);
    const list = (await request(app).get('/issues?overdue=true').set(auth('admin'))).body.issues;
    expect(list.length).toBe(a.overdue.total);
    expect(list.every((i: any) => i.sla.overdue && i.sla.overdueByMs > 0)).toBe(true);
  });

  it('keeps a populated admin routing queue and an hazard P1 ticket', async () => {
    const q = (await request(app).get('/issues?unassigned=true').set(auth('admin'))).body.issues;
    expect(q.length).toBeGreaterThanOrEqual(3);
    expect(q.every((i: any) => i.prediction.needsReview && i.assignee === null)).toBe(true);
    const p1 = (await request(app).get('/issues?priority=P1').set(auth('admin'))).body.issues;
    expect(p1.some((i: any) => i.hazardFlag && i.emergencyGuidance)).toBe(true);
  });

  it('gives Reporter A seeded resolved tickets to close or reopen, and a reopened one has history', async () => {
    const mine = (await request(app).get('/issues?status=RESOLVED').set(auth('a'))).body.issues;
    expect(mine.length).toBeGreaterThanOrEqual(2);
    const reopened = await ActivityLog.findOne({ action: 'REOPENED' });
    expect(reopened!.reason).toBeTruthy();
    // Reopen a different seeded resolved case, with a reason (reviewer script step 7)
    const res = await request(app).patch(`/issues/${mine[0].id}/status`).set(auth('a')).send({ status: 'IN_PROGRESS', reason: 'The printer is offline again today' });
    expect(res.status).toBe(200);
    expect(res.body.issue.status).toBe('IN_PROGRESS');
  });

  it('every seeded ticket has a complete, ordered history', async () => {
    const ids = await Issue.distinct('_id');
    for (const id of ids) {
      const logs = await ActivityLog.find({ issueId: id }).sort({ createdAt: 1, _id: 1 });
      expect(logs[0].action).toBe('CREATED');
      expect(logs.length).toBeGreaterThanOrEqual(4);
      expect(logs.every((l) => l.createdAt.getTime() <= Date.now())).toBe(true);
    }
  });

  it('seeded Reporter A ticket is not visible to Reporter B', async () => {
    const mine = (await request(app).get('/issues').set(auth('a'))).body.issues;
    expect((await request(app).get(`/issues/${mine[0].id}`).set(auth('b'))).status).toBe(404);
  });
});

describe('acceptance demo on top of the seeded data (reviewer script steps 1-3)', () => {
  const wifiA = { title: 'Lab 204 Wi-Fi is down', description: 'The Wi-Fi in computer lab 204 has been down since morning and nobody can connect.', building: 'Computer Labs', room: 'Lab 204', urgency: 'HIGH', affectedCount: 35, hazardFlag: false };
  const wifiB = { title: 'No internet in computer lab 204', description: 'There is no internet in the computer lab 204 for all of the students.', building: 'Computer Labs', room: 'Lab 204', urgency: 'HIGH', affectedCount: 30, hazardFlag: false };
  let aId = '';

  it('Reporter A: Wi-Fi outage is saved, routed to IT, priority P2, and NOT flagged against seeded Wi-Fi tickets', async () => {
    const res = await request(app).post('/issues').set(auth('a')).send(wifiA);
    expect(res.status).toBe(201);
    aId = res.body.issue.id;
    expect(res.body.issue).toMatchObject({ department: 'IT Support', status: 'ASSIGNED' });
    expect(res.body.issue.priority).toMatchObject({ level: 'P2', score: 9 });
    expect(res.body.issue.suggestedDuplicates).toEqual([]);
  });
  it('Reporter B: same incident in different words gets the suggestion, and is still saved', async () => {
    const res = await request(app).post('/issues').set(auth('b')).send(wifiB);
    expect(res.status).toBe(201);
    expect(res.body.issue.suggestedDuplicates.map((d: any) => d.id)).toContain(aId);
    expect(res.body.issue.suggestedDuplicates.length).toBeLessThanOrEqual(3);
    expect(await Issue.countDocuments({ title: wifiB.title })).toBe(1);
  });
  it('an unrelated Facilities complaint is not suggested as a duplicate', async () => {
    const res = await request(app).post('/issues').set(auth('b')).send({ title: 'Ceiling fan wobbling loudly', description: 'The ceiling fan in room 210 makes a loud noise and wobbles badly.', building: 'Main Block', room: 'Room 210', urgency: 'LOW', affectedCount: 20, hazardFlag: false });
    expect(res.body.issue.department).toBe('Facilities');
    expect(res.body.issue.suggestedDuplicates).toEqual([]);
  });
  it('the ambiguous report goes to the review queue', async () => {
    const res = await request(app).post('/issues').set(auth('a')).send({ title: 'Nothing is working', description: 'Nothing is working in the main office, please help us soon.', building: 'Admin Office', room: 'Main office', urgency: 'MEDIUM', affectedCount: 8, hazardFlag: false });
    expect(res.body.issue.prediction.needsReview).toBe(true);
    expect(res.body.issue.status).toBe('OPEN');
  });
  it('the assigned IT staff can resolve it; Reporter A verifies closure', async () => {
    const owner = (await request(app).get(`/issues/${aId}`).set(auth('a'))).body.issue.assignee.displayName.includes('IT Staff 1') ? 'it' : 'it2';
    const mv = (who: string, b: object) => request(app).patch(`/issues/${aId}/status`).set(auth(who)).send(b);
    expect((await request(app).post(`/issues/${aId}/acknowledge`).set(auth(owner))).status).toBe(200);
    expect((await mv(owner, { status: 'IN_PROGRESS' })).status).toBe(200);
    expect((await mv(owner, { status: 'RESOLVED', note: 'Replaced the failed access point and tested.' })).status).toBe(200);
    expect((await mv('a', { status: 'CLOSED' })).status).toBe(200);
    expect((await request(app).get('/admin/analytics').set(auth('admin'))).body.reconciliation.ok).toBe(true);
  });
  it('Reporter B cannot read Reporter A\'s ticket; Reporter cannot call an admin route', async () => {
    expect((await request(app).get(`/issues/${aId}`).set(auth('b'))).status).toBe(404);
    expect((await request(app).get('/admin/users').set(auth('a'))).status).toBe(403);
  });
});
