import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../app';
import { ActivityLog, Issue } from '../models';
import { seedAccounts } from '../../seed/seed';
import { computeAnalytics, median } from '../services/analytics';

let mongod: MongoMemoryServer;
const app = createApp({ loginRateLimitMax: 1000 });
const PW = 'Demo@12345';
const tokens: Record<string, string> = {};
const auth = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

const wifi = { title: 'Lab 204 Wi-Fi is down', description: 'The Wi-Fi in computer lab 204 is down and nobody can connect to the network.', building: 'Computer Labs', room: 'Lab 204', urgency: 'HIGH', affectedCount: 35, hazardFlag: false };
const create = (who: string, body: object = {}) => request(app).post('/issues').set(auth(who)).send({ ...wifi, ...body });
const move = (who: string, id: string, body: object) => request(app).patch(`/issues/${id}/status`).set(auth(who)).send(body);
const get = (who: string, id: string) => request(app).get(`/issues/${id}`).set(auth(who));
const backdate = (id: string, patch: Record<string, unknown>) => Issue.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: patch });
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

/** Create a Wi-Fi issue (auto-assigned to IT) and return its id plus the token key of its assigned IT staff. */
async function newItIssue(extra: object = {}) {
  const r = await create('a', { title: `Wi-Fi outage ${Math.random().toString(36).slice(2, 7)}`, room: `Lab ${Math.floor(Math.random() * 900)}`, ...extra });
  expect(r.status).toBe(201);
  const owner = r.body.issue.assignee.displayName.includes('IT Staff 1') ? 'it' : 'it2';
  return { id: r.body.issue.id as string, owner };
}

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

describe('Journey A — report to verified closure', () => {
  let id = '';
  let owner = '';
  it('starts ASSIGNED with no first response', async () => {
    ({ id, owner } = await newItIssue());
    const i = (await get('a', id)).body.issue;
    expect(i.status).toBe('ASSIGNED');
    expect(i.firstResponseAt).toBeNull();
  });
  it('reporters, other-department staff and strangers cannot start work', async () => {
    expect((await move('a', id, { status: 'IN_PROGRESS' })).status).toBe(403);
    expect((await move('fac', id, { status: 'IN_PROGRESS' })).status).toBe(404);
    expect((await move('b', id, { status: 'IN_PROGRESS' })).status).toBe(404);
  });
  it('staff acknowledges: first response is persisted once, status unchanged', async () => {
    const res = await request(app).post(`/issues/${id}/acknowledge`).set(auth(owner));
    expect(res.status).toBe(200);
    expect(res.body.issue.firstResponseAt).toBeTruthy();
    expect(res.body.issue.status).toBe('ASSIGNED');
    expect((await request(app).post(`/issues/${id}/acknowledge`).set(auth(owner))).status).toBe(409);
    expect((await request(app).post(`/issues/${id}/acknowledge`).set(auth('a'))).status).toBe(403);
  });
  it('rejects skipping IN_PROGRESS', async () => {
    const res = await move(owner, id, { status: 'RESOLVED', note: 'Replaced the faulty access point.' });
    expect(res.status).toBe(409);
  });
  it('staff moves to IN_PROGRESS', async () => {
    const res = await move(owner, id, { status: 'IN_PROGRESS' });
    expect(res.status).toBe(200);
    expect(res.body.issue.status).toBe('IN_PROGRESS');
  });
  it('cannot resolve without a resolution note of 15+ characters', async () => {
    expect((await move(owner, id, { status: 'RESOLVED' })).status).toBe(400);
    const short = await move(owner, id, { status: 'RESOLVED', note: 'fixed it' });
    expect(short.status).toBe(400);
    expect(short.body.details[0].field).toBe('note');
    expect((await get('a', id)).body.issue.status).toBe('IN_PROGRESS');
  });
  it('resolves with a note and records resolvedAt', async () => {
    const res = await move(owner, id, { status: 'RESOLVED', note: 'Replaced the faulty access point and tested.' });
    expect(res.status).toBe(200);
    expect(res.body.issue).toMatchObject({ status: 'RESOLVED', resolutionNote: 'Replaced the faulty access point and tested.' });
    expect(res.body.issue.resolvedAt).toBeTruthy();
  });
  it('staff cannot close on behalf of the reporter; another reporter cannot see it', async () => {
    expect((await move(owner, id, { status: 'CLOSED' })).status).toBe(403);
    expect((await move('b', id, { status: 'CLOSED' })).status).toBe(404);
  });
  it('the reporter closes it', async () => {
    const res = await move('a', id, { status: 'CLOSED' });
    expect(res.status).toBe(200);
    expect(res.body.issue.status).toBe('CLOSED');
    expect(res.body.issue.closedAt).toBeTruthy();
  });
  it('closed issues are final', async () => {
    expect((await move('admin', id, { status: 'IN_PROGRESS', reason: 'trying to reopen' })).status).toBe(409);
    expect((await move('a', id, { status: 'OPEN' })).status).toBe(409);
  });
  it('every step has an actor and server timestamp in the history', async () => {
    const logs = await ActivityLog.find({ issueId: id }).sort({ createdAt: 1, _id: 1 });
    const actions = logs.map((l) => l.action);
    for (const a of ['CREATED', 'AUTO_ASSIGNED', 'ACKNOWLEDGED', 'STATUS_CHANGED', 'CLOSED']) expect(actions).toContain(a);
    expect(logs.every((l) => l.actorLabel && l.createdAt)).toBe(true);
    const resolved = logs.find((l) => (l.after as any)?.status === 'RESOLVED');
    expect((resolved!.after as any).resolutionNote).toMatch(/access point/);
  });
});

describe('reopening', () => {
  let id = '';
  let owner = '';
  it('setup: a resolved ticket', async () => {
    ({ id, owner } = await newItIssue());
    await move(owner, id, { status: 'IN_PROGRESS' });
    expect((await move(owner, id, { status: 'RESOLVED', note: 'Rebooted the switch in the rack.' })).status).toBe(200);
  });
  it('requires a reason; staff cannot reopen; other reporters cannot see it', async () => {
    expect((await move('a', id, { status: 'IN_PROGRESS' })).status).toBe(400);
    expect((await move(owner, id, { status: 'IN_PROGRESS', reason: 'staff reopening' })).status).toBe(403);
    expect((await move('b', id, { status: 'IN_PROGRESS', reason: 'not my ticket' })).status).toBe(404);
  });
  it('the reporter reopens with a reason; resolution is pending again and the reason is logged', async () => {
    const res = await move('a', id, { status: 'IN_PROGRESS', reason: 'Still no connection in the back row' });
    expect(res.status).toBe(200);
    expect(res.body.issue.status).toBe('IN_PROGRESS');
    expect(res.body.issue.resolvedAt).toBeNull();
    const log = await ActivityLog.findOne({ issueId: id, action: 'REOPENED' });
    expect(log).toMatchObject({ reason: 'Still no connection in the back row' });
    expect((log!.before as any).status).toBe('RESOLVED');
  });
  it('can be resolved again and the new time replaces the old one', async () => {
    const res = await move(owner, id, { status: 'RESOLVED', note: 'Replaced a failed patch cable.' });
    expect(res.status).toBe(200);
    expect(res.body.issue.resolutionNote).toBe('Replaced a failed patch cable.');
  });
});

describe('admin overrides', () => {
  it('admin exceptional closure needs a reason, then closes; closed tickets are not overdue', async () => {
    const { id } = await newItIssue();
    await backdate(id, { createdAt: hoursAgo(300) });
    expect((await get('admin', id)).body.issue.sla.overdue).toBe(true);
    expect((await move('admin', id, { status: 'CLOSED' })).status).toBe(400);
    const ok = await move('admin', id, { status: 'CLOSED', reason: 'Duplicate of a known campus outage' });
    expect(ok.status).toBe(200);
    expect(ok.body.issue.sla.overdue).toBe(false);
    expect(await ActivityLog.countDocuments({ issueId: id, action: 'ADMIN_CLOSED' })).toBe(1);
  });
  it('admin cannot jump to ASSIGNED via status; staff cannot do exceptional closure', async () => {
    const r = await create('a', { title: 'Need a bonafide certificate', description: 'Please issue a bonafide certificate for my bank loan application.', building: 'Admin Office', room: 'Counter 3' });
    const { id } = { id: r.body.issue.id };
    expect((await move('admin', id, { status: 'CLOSED', reason: 'closing early on purpose' })).status).toBe(200);
    const { id: id2, owner } = await newItIssue();
    expect((await move(owner, id2, { status: 'CLOSED', reason: 'staff trying to close' })).status).toBe(409);
  });
  it('rejects unknown statuses and extra fields', async () => {
    const { id, owner } = await newItIssue();
    expect((await move(owner, id, { status: 'DONE' })).status).toBe(400);
    expect((await move(owner, id, { status: 'IN_PROGRESS', assigneeId: 'x' })).status).toBe(400);
    expect((await move(owner, 'not-an-id', { status: 'IN_PROGRESS' })).status).toBe(404);
  });
});

describe('Journey D — SLA indicators', () => {
  it('a seeded old ticket is overdue for first response with elapsed time and department', async () => {
    const { id } = await newItIssue();
    await backdate(id, { createdAt: hoursAgo(30) }); // P2: response due after 8h
    const i = (await get('admin', id)).body.issue;
    expect(i.sla).toMatchObject({ overdue: true, breached: 'response' });
    expect(i.sla.overdueByMs).toBeGreaterThan(20 * 3600_000);
    expect(i.department).toBe('IT Support');
  });
  it('acknowledging stops the response overdue flag but resolution can still be overdue', async () => {
    const { id, owner } = await newItIssue();
    await backdate(id, { createdAt: hoursAgo(30) });
    await request(app).post(`/issues/${id}/acknowledge`).set(auth(owner));
    expect((await get('admin', id)).body.issue.sla).toMatchObject({ overdue: true, breached: 'resolution' }); // P2 resolves in 24h
  });
  it('a staff note also counts as the first response', async () => {
    const { id, owner } = await newItIssue();
    await backdate(id, { createdAt: hoursAgo(10) });
    expect((await get('a', id)).body.issue.sla.overdue).toBe(true);
    const res = await request(app).post(`/issues/${id}/notes`).set(auth(owner)).send({ note: 'Checking the access point now.' });
    expect(res.status).toBe(200);
    expect(res.body.issue.sla.overdue).toBe(false);
  });
});

describe('analytics', () => {
  it('median helper', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('pure computation reconciles and computes resolution times', () => {
    const now = new Date('2026-10-10T12:00:00Z');
    const t = (h: number) => new Date(now.getTime() - h * 3600_000);
    const a = computeAnalytics(
      [
        { status: 'RESOLVED', priorityLevel: 'P2', department: 'IT Support', createdAt: t(10), resolvedAt: t(6), firstResponseAt: t(9) },
        { status: 'CLOSED', priorityLevel: 'P3', department: 'Facilities', createdAt: t(20), resolvedAt: t(10), closedAt: t(5), firstResponseAt: t(19) },
        { status: 'OPEN', priorityLevel: 'P1', department: null, createdAt: t(5) },
      ],
      [],
      now,
    );
    expect(a.resolution).toEqual({ count: 2, averageHours: 7, medianHours: 7 });
    expect(a.overdue).toMatchObject({ total: 1, response: 1 }); // P1 open for 5h, response due 2h
    expect(a.byDepartment.Unrouted).toBe(1);
    expect(a.reconciliation.ok).toBe(true);
  });

  const stats = (who: string, qs = '') => request(app).get(`/analytics${qs}`).set(auth(who));

  it('admin totals reconcile with the stored records', async () => {
    const res = await stats('admin');
    expect(res.status).toBe(200);
    const total = await Issue.countDocuments();
    expect(res.body.total).toBe(total);
    expect(res.body.reconciliation).toMatchObject({ ok: true, total, statusSum: total, departmentSum: total, prioritySum: total });
    for (const s of ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) {
      expect(res.body.byStatus[s]).toBe(await Issue.countDocuments({ status: s }));
    }
    expect(res.body.unresolved).toBe(res.body.byStatus.OPEN + res.body.byStatus.ASSIGNED + res.body.byStatus.IN_PROGRESS);
  });
  it('still reconciles after filtering by department', async () => {
    const res = await stats('admin', '?department=IT%20Support');
    expect(res.body.scope).toBe('IT Support');
    expect(res.body.byDepartment['IT Support']).toBe(res.body.total);
    expect(res.body.reconciliation.ok).toBe(true);
    expect((await stats('admin', '?department=Nope')).status).toBe(400);
  });
  it('updates live when a case changes status', async () => {
    const { id, owner } = await newItIssue();
    const before = (await stats('admin')).body;
    await move(owner, id, { status: 'IN_PROGRESS' });
    await move(owner, id, { status: 'RESOLVED', note: 'Restarted the controller and verified.' });
    const after = (await stats('admin')).body;
    expect(after.byStatus.ASSIGNED).toBe(before.byStatus.ASSIGNED - 1);
    expect(after.byStatus.RESOLVED).toBe(before.byStatus.RESOLVED + 1);
    expect(after.resolution.count).toBe(before.resolution.count + 1);
  });
  it('resolution time uses stored timestamps', async () => {
    const { id, owner } = await newItIssue();
    await backdate(id, { createdAt: hoursAgo(10) });
    await move(owner, id, { status: 'IN_PROGRESS' });
    await move(owner, id, { status: 'RESOLVED', note: 'Replaced the faulty access point.' });
    const doc = (await Issue.findById(id))!;
    const hours = (doc.resolvedAt!.getTime() - doc.createdAt.getTime()) / 3600_000;
    expect(hours).toBeGreaterThan(9.9);
    expect((await stats('admin')).body.resolution.averageHours).toBeGreaterThan(0);
  });
  it('staff only see their own department; reporters only their own issues, without staff data', async () => {
    const fac = (await stats('fac')).body;
    expect(fac.scope).toBe('Facilities');
    expect(fac.byDepartment.Facilities).toBe(fac.total);
    expect((await create('b', { title: 'Reporter B own report', room: 'Lab 777' })).status).toBe(201);
    const rep = (await stats('b')).body;
    const bId = (await request(app).get('/me').set(auth('b'))).body.user.id;
    expect(rep.total).toBe(await Issue.countDocuments({ reporterId: bId }));
    expect(rep.total).toBeGreaterThan(0);
    expect(rep.workload).toBeUndefined();
    expect(rep.byDepartment).toBeUndefined();
    const mine = (await stats('a')).body;
    expect(mine.total).toBe(await Issue.countDocuments({ reporterId: (await request(app).get('/me').set(auth('a'))).body.user.id }));
  });
  it('workload lists active cases per staff member', async () => {
    const res = await stats('admin');
    const it = res.body.workload.filter((w: any) => w.department === 'IT Support');
    expect(it).toHaveLength(2);
    expect(it.reduce((s: number, w: any) => s + w.active, 0)).toBe(
      await Issue.countDocuments({ status: { $in: ['ASSIGNED', 'IN_PROGRESS'] }, departmentId: (await Issue.findOne({ routingState: 'AUTO_ASSIGNED' }))!.departmentId }),
    );
  });
  it('admin analytics route is admin only; plain /analytics needs login', async () => {
    expect((await request(app).get('/admin/analytics').set(auth('a'))).status).toBe(403);
    expect((await request(app).get('/admin/analytics').set(auth('it'))).status).toBe(403);
    expect((await request(app).get('/admin/analytics').set(auth('admin'))).status).toBe(200);
    expect((await request(app).get('/analytics')).status).toBe(401);
  });
});
