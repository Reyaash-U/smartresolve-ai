/**
 * Demo seed (CLI only; deliberately NOT exposed as an HTTP route).
 * Creates departments, DUMMY accounts and ~38 synthetic tickets with aged timestamps.
 *
 *   npm run seed          accounts + tickets (tickets skipped if any already exist)
 *   npm run seed:reset    wipe ALL issues/history, then re-seed fresh demo tickets
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { Department, User, DEPARTMENTS } from '../src/models';
import { seedTickets } from './demoTickets';

export const DEMO_ACCOUNTS = [
  { displayName: 'Reporter A (Demo)', email: 'reporter.a@example.test', role: 'reporter' },
  { displayName: 'Reporter B (Demo)', email: 'reporter.b@example.test', role: 'reporter' },
  { displayName: 'Reporter C (Demo)', email: 'reporter.c@example.test', role: 'reporter' },
  { displayName: 'Reporter D (Demo)', email: 'reporter.d@example.test', role: 'reporter' },
  { displayName: 'IT Staff 1 (Demo)', email: 'it.staff1@example.test', role: 'staff', dept: 'IT Support' },
  { displayName: 'IT Staff 2 (Demo)', email: 'it.staff2@example.test', role: 'staff', dept: 'IT Support' },
  { displayName: 'Facilities Staff (Demo)', email: 'facilities.staff@example.test', role: 'staff', dept: 'Facilities' },
  { displayName: 'Administration Staff (Demo)', email: 'admin.staff@example.test', role: 'staff', dept: 'Administration' },
  { displayName: 'Administrator (Demo)', email: 'admin@example.test', role: 'admin' },
] as const;

export async function seedAccounts(password: string) {
  const depts: Record<string, mongoose.Types.ObjectId> = {};
  for (const name of DEPARTMENTS) {
    const d = await Department.findOneAndUpdate({ name }, { name, active: true }, { upsert: true, new: true });
    depts[name] = d._id;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  for (const a of DEMO_ACCOUNTS) {
    await User.findOneAndUpdate(
      { email: a.email },
      { displayName: a.displayName, email: a.email, role: a.role, active: true, passwordHash, departmentId: 'dept' in a ? depts[a.dept] : undefined },
      { upsert: true, new: true },
    );
  }
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!uri || !password) throw new Error('MONGODB_URI and SEED_DEMO_PASSWORD must be set');
  const reset = process.argv.includes('--reset');

  await mongoose.connect(uri);
  await seedAccounts(password);
  console.log(`Seeded departments and ${DEMO_ACCOUNTS.length} demo accounts (dummy credentials).`);

  const t = await seedTickets({ reset });
  if (t.skipped) console.log('Tickets already exist: left untouched. Use `npm run seed:reset` to wipe and re-seed them.');
  else console.log(`Seeded ${t.seeded} synthetic tickets (${t.mismatches} routed by admin because the model disagreed).`);
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Seed failed:', e.message);
    process.exit(1);
  });
}
