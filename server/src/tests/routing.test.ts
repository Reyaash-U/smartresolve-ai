import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../app';
import { ActivityLog, Issue, User } from '../models';
import { seedAccounts } from '../../seed/seed';

let mongod: MongoMemoryServer;
const app = createApp({ loginRateLimitMax: 1000 });
const PW = 'Demo@12345';
const tokens: Record<string, string> = {};
const auth = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

const base = { building: 'Computer Labs', room: 'Lab 204', urgency: 'HIGH', affectedCount: 35, hazardFlag: false };
const create = (who: string, body: object) => request(app).post('/issues').set(auth(who)).send({ ...base, ...body });
const get = (who: string, id: string) => request(app).get(`/issues/${id}`).set(auth(who));
const assign = (who: string, id: string, body: object) => request(app).patch(`/issues/${id}/assignment`).set(auth(who)).send(body);
const staffId = async (email: string) => String((await User.findOne({ email }))!._id);

const wifiA = { title: 'Lab 204 Wi-Fi is down', description: 'The Wi-Fi in computer lab 204 is down and nobody can connect to the network.' };
const wifiB = { title: 'No internet in computer lab 204', description: 'There is no internet in the computer lab 204 for all of the students.' };

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

let wifiAId = '';
let wifiBId = '';

describe('Journey B — similar complaints', () => {
  it('Reporter A\'s Wi-Fi report is routed to IT and gets no duplicate suggestion', async () => {
    const res = await create('a', wifiA);
    expect(res.status).toBe(201);
    wifiAId = res.body.issue.id;
    expect(res.body.issue.department).toBe('IT Support');
    expect(res.body.issue.assignee.displayName).toMatch(/IT Staff/);
    expect(res.body.issue.suggestedDuplicates).toEqual([]);
  });
  it('Reporter B gets a safe-summary suggestion but their report is still saved', async () => {
    const res = await create('b', wifiB);
    expect(res.status).toBe(201);
    wifiBId = res.body.issue.id;
    const sug = res.body.issue.suggestedDuplicates;
    expect(sug).toHaveLength(1);
    expect(sug[0].id).toBe(wifiAId);
    expect(sug[0].reasons.length).toBeGreaterThan(0);
    // safe summary: no reporter identity of any kind
    expect(JSON.stringify(sug)).not.toMatch(/reporter|@example|Reporter A/i);
    expect(await Issue.countDocuments({ _id: { $in: [wifiAId, wifiBId] } })).toBe(2);
  });
  it('an unrelated Facilities complaint is not suggested as a duplicate and goes to Facilities', async () => {
    const res = await create('b', { title: 'Leaking tap in washroom', description: 'Water is dripping from the tap in the ground floor washroom.', building: 'Main Block', room: 'Washroom G1', urgency: 'LOW', affectedCount: 3 });
    expect(res.body.issue.suggestedDuplicates).toEqual([]);
    expect(res.body.issue.department).toBe('Facilities');
    expect(res.body.issue.assignee.displayName).toMatch(/Facilities/);
  });
  it('admin can link the two reports; both survive with their histories', async () => {
    const reporter = await request(app).post(`/issues/${wifiAId}/links`).set(auth('a')).send({ otherId: wifiBId });
    expect(reporter.status).toBe(403);
    const ok = await request(app).post(`/issues/${wifiAId}/links`).set(auth('admin')).send({ otherId: wifiBId, reason: 'Same Wi-Fi outage' });
    expect(ok.status).toBe(200);
    expect(ok.body.issue.linkedCount).toBe(1);
    expect((await get('b', wifiBId)).body.issue.linkedCount).toBe(1);
    const dup = await request(app).post(`/issues/${wifiAId}/links`).set(auth('admin')).send({ otherId: wifiBId });
    expect(dup.status).toBe(409);
    expect((await ActivityLog.find({ action: 'DUPLICATE_LINKED' })).length).toBe(2);
  });
});

describe('Journey C — ambiguous issue', () => {
  let id = '';
  it('is saved, but sent to the admin routing queue with no confident assignment', async () => {
    const res = await create('a', { title: 'Nothing is working', description: 'Nothing is working in the main office, please help us soon.', building: 'Admin Office', room: 'Main office', urgency: 'MEDIUM', affectedCount: 8 });
    expect(res.status).toBe(201);
    id = res.body.issue.id;
    const i = res.body.issue;
    expect(i.prediction.needsReview).toBe(true);
    expect(i.prediction.department).toBeNull();
    expect(i.routingState).toBe('NEEDS_REVIEW');
    expect(i.status).toBe('OPEN');
    expect(i.assignee).toBeNull();
    expect(i.department).toBeNull();
    expect(i.unassignedAdminReview).toBe(true);
  });
  it('appears in the admin routing queue', async () => {
    const q = await request(app).get('/issues?unassigned=true').set(auth('admin'));
    expect(q.body.issues.some((x: any) => x.id === id)).toBe(true);
  });
  it('admin routes it manually; first assignment needs no reason and is audited', async () => {
    const res = await assign('admin', id, { assigneeId: await staffId('admin.staff@example.test') });
    expect(res.status).toBe(200);
    expect(res.body.issue).toMatchObject({ status: 'ASSIGNED', department: 'Administration', routingState: 'ADMIN' });
    const log = await ActivityLog.findOne({ issueId: id, action: 'ASSIGNED' });
    expect(log!.actorLabel).toMatch(/Administrator/);
  });
  it('reassigning requires a reason, then records it with before/after', async () => {
    const target = await staffId('facilities.staff@example.test');
    expect((await assign('admin', id, { assigneeId: target })).status).toBe(400);
    const res = await assign('admin', id, { assigneeId: target, reason: 'Actually a building issue' });
    expect(res.status).toBe(200);
    expect(res.body.issue.department).toBe('Facilities');
    const log = await ActivityLog.findOne({ issueId: id, action: 'REASSIGNED' });
    expect(log!.reason).toBe('Actually a building issue');
    expect((log!.before as any).department).toBe('Administration');
    expect((log!.after as any).department).toBe('Facilities');
    // the original model output is preserved
    expect((await Issue.findById(id))!.prediction!.needsReview).toBe(true);
  });
  it('rejects non-admins, bad targets and no-op reassignment', async () => {
    const t = await staffId('it.staff1@example.test');
    expect((await assign('a', id, { assigneeId: t, reason: 'nope nope' })).status).toBe(403);
    expect((await assign('it', id, { assigneeId: t, reason: 'nope nope' })).status).toBe(403);
    const reporterId = String((await User.findOne({ email: 'reporter.a@example.test' }))!._id);
    expect((await assign('admin', id, { assigneeId: reporterId, reason: 'make reporter owner' })).status).toBe(400);
    expect((await assign('admin', id, { assigneeId: 'not-an-id', reason: 'bad id here' })).status).toBe(400);
    expect((await assign('admin', id, { assigneeId: await staffId('facilities.staff@example.test'), reason: 'same again' })).status).toBe(409);
  });
});

describe('staff assignment rules', () => {
  it('balances by lowest active workload with a deterministic tie-break', async () => {
    await Issue.deleteMany({});
    await User.updateMany({ email: { $in: ['it.staff1@example.test', 'it.staff2@example.test'] } }, { active: true });
    const ids = [await staffId('it.staff1@example.test'), await staffId('it.staff2@example.test')].sort();
    const texts = ['Projector shows no image in room 101', 'Cannot log in to the student portal password invalid', 'Printer on second floor is offline and prints nothing', 'VPN connection to the college network fails with timeout'];
    const owners: string[] = [];
    for (const [n, t] of texts.entries()) {
      const r = await create('a', { title: t, description: `${t}. Please fix this as soon as you can.`, building: 'Library', room: `Room ${n}`, urgency: 'LOW', affectedCount: 2 });
      expect(r.body.issue.department).toBe('IT Support');
      owners.push(r.body.issue.assignee.id);
    }
    expect(owners[0]).toBe(ids[0]); // tie at 0/0 -> lowest staff ID
    expect(owners[1]).toBe(ids[1]);
    expect(owners.filter((o) => o === ids[0])).toHaveLength(2);
    expect(owners.filter((o) => o === ids[1])).toHaveLength(2);
  });
  it('never assigns inactive staff; with nobody eligible the issue stays OPEN for admin', async () => {
    await User.updateOne({ email: 'admin.staff@example.test' }, { active: false });
    const r = await create('a', { title: 'Need a bonafide certificate', description: 'Please issue a bonafide certificate for my bank loan application.', building: 'Admin Office', room: 'Counter 1', urgency: 'LOW', affectedCount: 1 });
    expect(r.body.issue).toMatchObject({ status: 'OPEN', department: 'Administration', routingState: 'NO_STAFF', unassignedAdminReview: true });
    expect(r.body.issue.assignee).toBeNull();
    expect((await assign('admin', r.body.issue.id, { assigneeId: await staffId('admin.staff@example.test') })).status).toBe(400);
    await User.updateOne({ email: 'admin.staff@example.test' }, { active: true });
  });
  it('the automatic rule never assigns IT staff to a Facilities issue', async () => {
    const itIds = [await staffId('it.staff1@example.test'), await staffId('it.staff2@example.test')];
    for (const n of [1, 2, 3]) {
      const r = await create('b', { title: `Broken bench ${n}`, description: 'The bench in the lecture hall is broken and has a loose leg.', building: 'Science Block', room: `Hall ${n}`, urgency: 'LOW', affectedCount: 2 });
      expect(r.body.issue.department).toBe('Facilities');
      expect(itIds).not.toContain(r.body.issue.assignee.id);
    }
  });
});

describe('priority override', () => {
  let id = '';
  let facilitiesId = '';
  it('setup', async () => {
    id = (await create('a', { ...wifiA, title: 'Wi-Fi outage in lab 9', room: 'Lab 9' })).body.issue.id;
    facilitiesId = (await create('a', { title: 'Cracked window glass', description: 'The window glass in the reading hall is cracked and dangerous.', building: 'Library', room: 'Reading hall', urgency: 'LOW', affectedCount: 2 })).body.issue.id;
  });
  const patch = (who: string, issueId: string, body: object) => request(app).patch(`/issues/${issueId}/priority`).set(auth(who)).send(body);

  it('admin override needs a reason and is recorded with before/after', async () => {
    expect((await patch('admin', id, { level: 'P1' })).status).toBe(400);
    const res = await patch('admin', id, { level: 'P1', reason: 'Whole lab exam today' });
    expect(res.status).toBe(200);
    expect(res.body.issue.priority.level).toBe('P1');
    expect(res.body.issue.priority.factors.join(' ')).toMatch(/Admin override/);
    const log = await ActivityLog.findOne({ issueId: id, action: 'PRIORITY_OVERRIDDEN' });
    expect(log).toMatchObject({ reason: 'Whole lab exam today' });
    expect((log!.before as any).level).toBe('P2');
  });
  it('staff can only suggest: priority is unchanged but the suggestion is logged', async () => {
    const res = await patch('it', id, { level: 'P4', reason: 'Seems minor to me' });
    expect(res.status).toBe(200);
    expect(res.body.issue.priority.level).toBe('P1');
    expect(await ActivityLog.countDocuments({ issueId: id, action: 'PRIORITY_SUGGESTED' })).toBe(1);
  });
  it('staff outside the department and reporters are denied', async () => {
    expect((await patch('it', facilitiesId, { level: 'P4', reason: 'Not my department' })).status).toBe(404);
    expect((await patch('a', id, { level: 'P4', reason: 'I am the reporter' })).status).toBe(403);
  });
  it('rejects invalid levels and unknown fields', async () => {
    expect((await patch('admin', id, { level: 'P9', reason: 'invalid level' })).status).toBe(400);
    expect((await patch('admin', id, { level: 'P2', reason: 'extra field here', score: 1 })).status).toBe(400);
  });
});
