/**
 * Synthetic demo tickets (fictional people, fictional campus). Written with historical timestamps so
 * overdue / aged states are real stored data; the server clock is never manipulated.
 *
 * Ages are relative to the moment of seeding: re-run `npm run seed:reset` before a demo to refresh them.
 */
import mongoose from 'mongoose';
import { ActivityLog, Counter, Department, Issue, User } from '../src/models';
import { classifyIssue } from '../src/ml/classifier';
import { computePriority } from '../src/services/priority';

type Dept = 'IT Support' | 'Facilities' | 'Administration';
type Reporter = 'a' | 'b' | 'c' | 'd';
type Staff = 'it1' | 'it2' | 'fac' | 'adm';
type Urgency = 'LOW' | 'MEDIUM' | 'HIGH';

interface Spec {
  by: Reporter;
  dept: Dept | null; // null = left in the admin routing queue
  title: string;
  description: string;
  building: string;
  room: string;
  urgency: Urgency;
  affected: number;
  hazard?: boolean;
  ageH: number; // hours since creation
  staff?: Staff;
  respH?: number; // first acknowledgement, hours after creation
  progH?: number; // moved to IN_PROGRESS
  resH?: number; // marked RESOLVED
  closeH?: number; // closed by reporter
  note?: string;
  reopen?: { atH: number; reason: string };
}

const STAFF_EMAIL: Record<Staff, string> = {
  it1: 'it.staff1@example.test',
  it2: 'it.staff2@example.test',
  fac: 'facilities.staff@example.test',
  adm: 'admin.staff@example.test',
};
const REPORTER_EMAIL: Record<Reporter, string> = {
  a: 'reporter.a@example.test',
  b: 'reporter.b@example.test',
  c: 'reporter.c@example.test',
  d: 'reporter.d@example.test',
};

export const DEMO_SPECS: Spec[] = [
  // ---- IT Support ----
  { by: 'b', dept: 'IT Support', staff: 'it1', title: 'Library Wi-Fi keeps disconnecting', description: 'The Wi-Fi in the library reading hall disconnects every few minutes and students cannot stay online.', building: 'Library', room: 'Reading hall', urgency: 'MEDIUM', affected: 40, ageH: 30, respH: 3, progH: 4 },
  { by: 'c', dept: 'IT Support', staff: 'it2', title: 'Projector shows no image in Room 101', description: 'The projector in room 101 does not show any image when the laptop is connected to it.', building: 'Main Block', room: 'Room 101', urgency: 'MEDIUM', affected: 30, ageH: 50 },
  { by: 'd', dept: 'IT Support', staff: 'it1', title: 'Cannot log in to the student portal', description: 'The student portal says my password is invalid even after I reset it twice today.', building: 'Main Block', room: 'Online', urgency: 'LOW', affected: 1, ageH: 200, respH: 5, progH: 6, resH: 20, closeH: 30, note: 'Reset the account and cleared the cached login session.' },
  { by: 'a', dept: 'IT Support', staff: 'it2', title: 'Printer on second floor is offline', description: 'The printer on the second floor corridor shows offline and nothing prints for anyone.', building: 'Science Block', room: 'Second floor corridor', urgency: 'MEDIUM', affected: 15, ageH: 40, respH: 2, progH: 3, resH: 20, note: 'Reinstalled the printer driver and restarted the print server.' },
  { by: 'b', dept: 'IT Support', staff: 'it2', title: 'Physics lab computers freeze constantly', description: 'The lab computers in the physics lab are very slow and freeze often during practical sessions.', building: 'Science Block', room: 'Physics Lab', urgency: 'HIGH', affected: 28, ageH: 40, respH: 1, progH: 2 },
  { by: 'c', dept: 'IT Support', staff: 'it1', title: 'VPN connection fails with timeout', description: 'The VPN connection to the college network fails with a timeout error whenever I try from home.', building: 'Main Block', room: 'Staff room', urgency: 'LOW', affected: 3, ageH: 150, respH: 10, progH: 12, resH: 40, closeH: 60, note: 'Updated the VPN client and re-issued the access profile.' },
  { by: 'd', dept: 'IT Support', staff: 'it1', title: 'Online exam portal crashes on submit', description: 'The online exam portal crashes when students submit their answers at the end of the test.', building: 'Computer Labs', room: 'Lab 101', urgency: 'HIGH', affected: 120, ageH: 100, respH: 1, progH: 2, resH: 12, note: 'Increased the portal worker limit and re-ran the failed submissions.' },
  { by: 'a', dept: 'IT Support', staff: 'it2', title: 'University email account is locked', description: 'My university email account is locked and I cannot access my mail or the shared calendar.', building: 'Admin Office', room: 'Faculty office', urgency: 'LOW', affected: 1, ageH: 300, respH: 4, progH: 5, resH: 24, closeH: 48, note: 'Unlocked the account and enforced a fresh password change.' },
  { by: 'b', dept: 'IT Support', staff: 'it1', title: 'Network cable port dead in staff room', description: 'The network cable port in staff room two has no connectivity at all for any device.', building: 'Main Block', room: 'Staff room 2', urgency: 'MEDIUM', affected: 4, ageH: 5 },
  { by: 'c', dept: 'IT Support', staff: 'it2', title: 'Design software license has expired', description: 'The software license for the design tool has expired on all of the systems in this lab.', building: 'Computer Labs', room: 'Lab 305', urgency: 'HIGH', affected: 45, ageH: 20 },
  { by: 'd', dept: 'IT Support', staff: 'it1', title: 'Smart board in seminar hall not responding', description: 'The smart board in the seminar hall will not turn on or respond to touch input.', building: 'Science Block', room: 'Seminar hall', urgency: 'MEDIUM', affected: 25, ageH: 10, respH: 2, progH: 3 },
  { by: 'a', dept: 'IT Support', staff: 'it2', title: 'Wi-Fi password rejected near canteen', description: 'The Wi-Fi password is rejected by the new access point near the canteen for every phone.', building: 'Main Block', room: 'Canteen', urgency: 'LOW', affected: 6, ageH: 220, respH: 20, progH: 22, resH: 50, closeH: 70, note: 'Re-synchronised the access point with the campus controller.' },
  { by: 'd', dept: 'IT Support', staff: 'it2', title: 'Hostel Wi-Fi drops every evening', description: 'The Wi-Fi in the hostel common room drops every evening and many students lose connection.', building: 'Hostel A', room: 'Common room', urgency: 'MEDIUM', affected: 25, ageH: 70, respH: 2, progH: 3, resH: 20, note: 'Replaced the overloaded access point in the corridor.', reopen: { atH: 40, reason: 'Wi-Fi is still dropping in the evenings after the fix.' } },

  // ---- Facilities ----
  { by: 'a', dept: 'Facilities', staff: 'fac', title: 'Water leaking from corridor ceiling', description: 'Water is leaking from the ceiling in the second corridor of the science block after every rain.', building: 'Science Block', room: 'Corridor 2', urgency: 'HIGH', affected: 20, ageH: 12, respH: 1, progH: 2 },
  { by: 'b', dept: 'Facilities', staff: 'fac', title: 'Tube light flickering in room 305', description: 'The tube light in classroom 305 is flickering badly and needs to be replaced soon.', building: 'Main Block', room: 'Room 305', urgency: 'LOW', affected: 30, ageH: 30 },
  { by: 'c', dept: 'Facilities', staff: 'fac', title: 'Broken bench in lecture hall', description: 'A bench in lecture hall two is broken and has a loose leg that could collapse.', building: 'Main Block', room: 'Lecture hall 2', urgency: 'LOW', affected: 12, ageH: 160, respH: 8, progH: 10, resH: 30, closeH: 55, note: 'Replaced the leg bracket and tightened every bench in the row.' },
  { by: 'd', dept: 'Facilities', staff: 'fac', title: 'Exposed live wire in hostel corridor', description: 'An exposed live wire is hanging near a socket in the ground floor hostel corridor.', building: 'Hostel A', room: 'Ground floor corridor', urgency: 'HIGH', affected: 15, hazard: true, ageH: 5, respH: 1, progH: 1.5 },
  { by: 'a', dept: 'Facilities', staff: 'fac', title: 'Air conditioner not cooling in seminar hall', description: 'The air conditioner in the seminar hall is not cooling at all and the room is very hot.', building: 'Science Block', room: 'Seminar hall', urgency: 'MEDIUM', affected: 60, ageH: 30, respH: 3, progH: 4, resH: 18, note: 'Recharged the refrigerant and cleaned the blocked filters.' },
  { by: 'b', dept: 'Facilities', staff: 'fac', title: 'Washroom tap dripping continuously', description: 'The tap in the ground floor hostel washroom is dripping continuously and wasting water.', building: 'Hostel A', room: 'Washroom G1', urgency: 'LOW', affected: 3, ageH: 60 },
  { by: 'c', dept: 'Facilities', staff: 'fac', title: 'Main lift stuck between floors', description: 'The lift in the main block is stuck between floors and has been out of service.', building: 'Main Block', room: 'Main lift', urgency: 'HIGH', affected: 25, ageH: 120, respH: 1, progH: 2, resH: 10, closeH: 30, note: 'Technician reset the lift controller and replaced the door sensor.' },
  { by: 'd', dept: 'Facilities', staff: 'fac', title: 'Hostel corridor dustbins overflowing', description: 'The dustbins in the hostel corridor are overflowing and the smell is spreading to rooms.', building: 'Hostel A', room: 'Corridor', urgency: 'MEDIUM', affected: 20, ageH: 3 },
  { by: 'a', dept: 'Facilities', staff: 'fac', title: 'Cracked window glass in reading hall', description: 'A window glass in the library reading hall is cracked and could fall out.', building: 'Library', room: 'Reading hall', urgency: 'MEDIUM', affected: 10, ageH: 20, respH: 4, progH: 6 },
  { by: 'b', dept: 'Facilities', staff: 'fac', title: 'Roof leakage damaging lab cupboards', description: 'Roof leakage in the chemistry laboratory is damaging the cupboards and the stored supplies.', building: 'Science Block', room: 'Chemistry lab', urgency: 'HIGH', affected: 18, ageH: 40, respH: 2, progH: 3 },
  { by: 'c', dept: 'Facilities', staff: 'fac', title: 'Sewage smell from ground floor restroom', description: 'A strong sewage smell is coming from the ground floor restroom near the main entrance.', building: 'Main Block', room: 'Restroom G', urgency: 'MEDIUM', affected: 40, ageH: 130, respH: 6, progH: 8, resH: 36, closeH: 70, note: 'Cleared the blocked drain pipe and disinfected the area.' },
  { by: 'd', dept: 'Facilities', staff: 'fac', title: 'Paint peeling in staff room', description: 'The paint is peeling off the walls in the staff room and there is visible dampness.', building: 'Admin Office', room: 'Staff room', urgency: 'LOW', affected: 4, ageH: 1 },

  // ---- Administration ----
  { by: 'a', dept: 'Administration', staff: 'adm', title: 'Need a duplicate student ID card', description: 'I need a duplicate student ID card because I lost my original card last week.', building: 'Admin Office', room: 'Counter 2', urgency: 'LOW', affected: 1, ageH: 280, respH: 10, progH: 12, resH: 60, closeH: 90, note: 'Issued a duplicate ID card; collected from counter 2.' },
  { by: 'b', dept: 'Administration', staff: 'adm', title: 'Bonafide certificate for bank loan', description: 'Please issue a bonafide certificate for my bank loan application as soon as possible.', building: 'Admin Office', room: 'Counter 1', urgency: 'LOW', affected: 1, ageH: 10 },
  { by: 'c', dept: 'Administration', staff: 'adm', title: 'Classroom needed for guest lecture', description: 'A classroom allocation is required for the guest lecture next Friday afternoon.', building: 'Main Block', room: 'Dean office', urgency: 'MEDIUM', affected: 80, ageH: 25, respH: 5, progH: 6 },
  { by: 'd', dept: 'Administration', staff: 'adm', title: 'Fee receipt missing from accounts record', description: 'My fee receipt is missing from the accounts record and the portal shows the fee as unpaid.', building: 'Admin Office', room: 'Accounts counter', urgency: 'MEDIUM', affected: 1, ageH: 60, respH: 4, progH: 5, resH: 30, note: 'Located the payment and updated the accounts record.' },
  { by: 'a', dept: 'Administration', staff: 'adm', title: 'Scholarship form status not updated', description: 'The scholarship form is pending and nobody has updated its status for several weeks.', building: 'Admin Office', room: 'Scholarship cell', urgency: 'MEDIUM', affected: 2, ageH: 30 },
  { by: 'b', dept: 'Administration', staff: 'adm', title: 'Exam hall ticket not issued', description: 'The exam hall ticket has not been issued and the registrar has not responded to our requests.', building: 'Admin Office', room: 'Exam cell', urgency: 'HIGH', affected: 70, ageH: 12 },
  { by: 'c', dept: 'Administration', staff: 'adm', title: 'Transfer certificate request', description: 'Request for a transfer certificate and a copy of my academic records for another university.', building: 'Admin Office', room: 'Records room', urgency: 'LOW', affected: 1, ageH: 200, respH: 8, progH: 10, resH: 70, closeH: 100, note: 'Prepared and handed over the transfer certificate and records.' },
  { by: 'd', dept: 'Administration', staff: 'adm', title: 'Timetable overlap between two classes', description: 'Request for a timetable change because two of my scheduled classes overlap on Tuesday.', building: 'Main Block', room: 'Timetable cell', urgency: 'MEDIUM', affected: 45, ageH: 8, respH: 2, progH: 3 },

  // ---- Left for the admin routing queue (ambiguous / low confidence) ----
  { by: 'a', dept: null, title: 'Nothing is working in the main office', description: 'Nothing is working in the main office since yesterday, please check as soon as possible.', building: 'Admin Office', room: 'Main office', urgency: 'MEDIUM', affected: 12, ageH: 4 },
  { by: 'b', dept: null, title: 'Problem in the hostel', description: 'There is a problem in the hostel and many of the students are affected by it.', building: 'Hostel A', room: 'Block 2', urgency: 'MEDIUM', affected: 20, ageH: 28 },
  { by: 'c', dept: null, title: 'Please check urgently', description: 'Please check the room urgently as it is not good at all today for anyone.', building: 'Library', room: 'Room 12', urgency: 'LOW', affected: 2, ageH: 2 },
];

const HOUR = 3600_000;

export async function seedTickets(opts: { reset?: boolean; now?: Date } = {}): Promise<{ seeded: number; skipped: boolean; mismatches: number }> {
  const existing = await Issue.countDocuments();
  if (existing > 0 && !opts.reset) return { seeded: 0, skipped: true, mismatches: 0 };
  if (opts.reset) await Promise.all([Issue.deleteMany({}), ActivityLog.deleteMany({}), Counter.deleteMany({})]);

  const now = (opts.now ?? new Date()).getTime();
  const [depts, users] = await Promise.all([Department.find().lean(), User.find({ email: { $in: [...Object.values(STAFF_EMAIL), ...Object.values(REPORTER_EMAIL), 'admin@example.test'] } }).lean()]);
  const userBy = (email: string) => {
    const u = users.find((x) => x.email === email);
    if (!u) throw new Error(`Missing demo account ${email}: run the account seed first`);
    return u;
  };
  const deptId = (name: Dept) => depts.find((d) => d.name === name)!._id;
  const admin = userBy('admin@example.test');

  const issues: Record<string, unknown>[] = [];
  const logs: Record<string, unknown>[] = [];
  let mismatches = 0;

  const ordered = [...DEMO_SPECS].sort((x, y) => y.ageH - x.ageH); // oldest gets the lowest SR number
  ordered.forEach((s, idx) => {
    if (s.title.length < 5 || s.title.length > 120 || s.description.length < 20 || s.description.length > 1000) throw new Error(`Seed text out of bounds: ${s.title}`);
    const last = Math.max(s.respH ?? 0, s.progH ?? 0, s.resH ?? 0, s.closeH ?? 0, s.reopen?.atH ?? 0);
    if (last > s.ageH) throw new Error(`Seed timeline is in the future: ${s.title}`);

    const at = (h: number) => new Date(now - s.ageH * HOUR + h * HOUR);
    const created = at(0);
    const _id = new mongoose.Types.ObjectId();
    const reporter = userBy(REPORTER_EMAIL[s.by]);
    const staff = s.staff ? userBy(STAFF_EMAIL[s.staff]) : null;
    const code = `SR-${String(idx + 1).padStart(6, '0')}`;

    const pr = computePriority({ urgency: s.urgency, affectedCount: s.affected, hazard: !!s.hazard });
    const cls = classifyIssue(s.title, s.description);
    const routed = s.dept !== null;
    const autoRouted = routed && cls.department === s.dept;
    if (routed && !autoRouted) mismatches++;

    // Derived lifecycle
    const reopened = !!s.reopen;
    let status = routed ? 'ASSIGNED' : 'OPEN';
    if (s.progH !== undefined) status = 'IN_PROGRESS';
    if (s.resH !== undefined && !reopened) status = 'RESOLVED';
    if (s.closeH !== undefined) status = 'CLOSED';
    const firstResp = s.respH ?? s.progH;
    const resolvedAt = s.resH !== undefined && !reopened ? at(s.resH) : undefined;

    const log = (h: number, actor: { _id: unknown; displayName: string } | null, action: string, extra: Record<string, unknown> = {}) =>
      logs.push({ _id: new mongoose.Types.ObjectId(), issueId: _id, actorId: actor?._id ?? null, actorLabel: actor?.displayName ?? 'System', action, createdAt: at(h), ...extra });

    log(0, reporter, 'CREATED', { after: { status: 'OPEN' } });
    log(0.001, null, 'PRIORITY_RECOMMENDED', { after: { level: pr.level, score: pr.score, factors: pr.factors } });
    log(0.002, null, 'CATEGORY_PREDICTED', {
      after: { department: cls.department, leadingGuess: cls.guess, confidence: cls.confidence, needsReview: cls.needsReview, modelVersion: cls.modelVersion },
      ...(cls.reason ? { reason: cls.reason } : {}),
    });
    if (!routed) log(0.003, null, 'ROUTING_QUEUED', { reason: 'Low confidence: left for administrator review' });
    else if (autoRouted) log(0.01, null, 'AUTO_ASSIGNED', { before: { status: 'OPEN' }, after: { status: 'ASSIGNED', assignee: staff!.displayName, department: s.dept } });
    else log(0.05, admin, 'ASSIGNED', { before: { status: 'OPEN' }, after: { status: 'ASSIGNED', assignee: staff!.displayName, department: s.dept }, reason: 'Routed by administrator' });

    if (s.respH !== undefined) log(s.respH, staff, 'ACKNOWLEDGED', { after: { firstResponseAt: at(s.respH) } });
    if (s.progH !== undefined) log(s.progH, staff, 'STATUS_CHANGED', { before: { status: 'ASSIGNED' }, after: { status: 'IN_PROGRESS' } });
    if (s.resH !== undefined) log(s.resH, staff, 'STATUS_CHANGED', { before: { status: 'IN_PROGRESS' }, after: { status: 'RESOLVED', resolutionNote: s.note } });
    if (s.reopen) log(s.reopen.atH, reporter, 'REOPENED', { before: { status: 'RESOLVED' }, after: { status: 'IN_PROGRESS' }, reason: s.reopen.reason });
    if (s.closeH !== undefined) log(s.closeH, reporter, 'CLOSED', { before: { status: 'RESOLVED' }, after: { status: 'CLOSED' } });

    issues.push({
      _id,
      code,
      reporterId: reporter._id,
      title: s.title,
      description: s.description,
      building: s.building,
      room: s.room,
      urgency: s.urgency,
      affectedCount: s.affected,
      hazardFlag: !!s.hazard,
      prediction: { department: cls.department, confidence: cls.confidence, needsReview: cls.needsReview, reason: cls.reason, guess: cls.guess, topTerms: cls.topTerms, modelVersion: cls.modelVersion },
      routingState: !routed ? 'NEEDS_REVIEW' : autoRouted ? 'AUTO_ASSIGNED' : 'ADMIN',
      suggestedDuplicates: [],
      priority: { level: pr.level, score: pr.score, factors: pr.factors, overridden: false },
      departmentId: routed ? deptId(s.dept!) : undefined,
      assigneeId: routed ? staff!._id : undefined,
      status,
      resolutionNote: s.resH !== undefined ? s.note : undefined,
      firstResponseAt: firstResp !== undefined ? at(firstResp) : undefined,
      resolvedAt,
      closedAt: s.closeH !== undefined ? at(s.closeH) : undefined,
      duplicateLinkIds: [],
      createdAt: created,
      updatedAt: at(last),
      __v: 0,
    });
  });

  // Raw inserts keep the historical createdAt (Mongoose treats it as immutable).
  await Issue.collection.insertMany(issues as never[]);
  await ActivityLog.collection.insertMany(logs as never[]);
  await Counter.collection.updateOne({ _id: 'issue' as never }, { $set: { seq: ordered.length } }, { upsert: true });
  return { seeded: ordered.length, skipped: false, mismatches };
}
