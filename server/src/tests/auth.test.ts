import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../app';
import { User } from '../models';
import { seedAccounts } from '../../seed/seed';

let mongod: MongoMemoryServer;
const app = createApp({ loginRateLimitMax: 1000 });
const PW = 'Demo@12345';

async function login(email: string, password = PW) {
  return request(app).post('/auth/login').send({ email, password });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await seedAccounts(PW);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('registration', () => {
  it('registers a reporter and hashes the password', async () => {
    const res = await request(app).post('/auth/register').send({ displayName: 'Test User', email: 'New@Example.test', password: 'longenough1' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('reporter');
    const stored = await User.findOne({ email: 'new@example.test' }).select('+passwordHash');
    expect(stored!.passwordHash).not.toContain('longenough1');
  });
  it('rejects role elevation attempts', async () => {
    const res = await request(app).post('/auth/register').send({ displayName: 'Evil', email: 'evil@example.test', password: 'longenough1', role: 'admin' });
    expect(res.status).toBe(400);
    expect(await User.exists({ email: 'evil@example.test' })).toBeNull();
  });
  it('rejects duplicate email with 409', async () => {
    const res = await request(app).post('/auth/register').send({ displayName: 'Dup', email: 'reporter.a@example.test', password: 'longenough1' });
    expect(res.status).toBe(409);
  });
  it('rejects short password and bad email with field details', async () => {
    const res = await request(app).post('/auth/register').send({ displayName: 'X', email: 'nope', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.details.length).toBeGreaterThanOrEqual(3);
  });
});

describe('login', () => {
  it('accepts valid credentials', async () => {
    const res = await login('reporter.a@example.test');
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.passwordHash).toBeUndefined();
  });
  it('rejects wrong password and unknown email with the same message', async () => {
    const a = await login('reporter.a@example.test', 'wrong-password');
    const b = await login('nobody@example.test');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
  });
  it('blocks NoSQL operator injection', async () => {
    const res = await request(app).post('/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
  });
  it('rejects deactivated accounts', async () => {
    await User.updateOne({ email: 'reporter.b@example.test' }, { active: false });
    expect((await login('reporter.b@example.test')).status).toBe(401);
    await User.updateOne({ email: 'reporter.b@example.test' }, { active: true });
  });
});

describe('rate limiting', () => {
  it('returns 429 after too many login attempts', async () => {
    const limited = createApp({ loginRateLimitMax: 3 });
    let last = 0;
    for (let i = 0; i < 5; i++) last = (await request(limited).post('/auth/login').send({ email: 'a@example.test', password: 'x' })).status;
    expect(last).toBe(429);
  });
});

describe('authorization', () => {
  it('GET /me requires a token', async () => expect((await request(app).get('/me')).status).toBe(401));
  it('GET /me rejects a forged token', async () => {
    expect((await request(app).get('/me').set('Authorization', 'Bearer not.a.token')).status).toBe(401);
  });
  it('GET /me returns the signed-in user', async () => {
    const { body } = await login('it.staff1@example.test');
    const res = await request(app).get('/me').set('Authorization', `Bearer ${body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('staff');
  });
  it('reporter cannot call admin routes (403)', async () => {
    const { body } = await login('reporter.a@example.test');
    expect((await request(app).get('/admin/users').set('Authorization', `Bearer ${body.token}`)).status).toBe(403);
  });
  it('staff cannot call admin routes (403)', async () => {
    const { body } = await login('it.staff1@example.test');
    expect((await request(app).get('/admin/users').set('Authorization', `Bearer ${body.token}`)).status).toBe(403);
  });
  it('anonymous cannot call admin routes (401)', async () => expect((await request(app).get('/admin/users')).status).toBe(401));
  it('admin can list staff without password hashes', async () => {
    const { body } = await login('admin@example.test');
    const res = await request(app).get('/admin/users').set('Authorization', `Bearer ${body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });
  it('malformed JSON returns 400 without a stack trace', async () => {
    const res = await request(app).post('/auth/login').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('at ');
  });
});
