import { Schema, model, Types } from 'mongoose';

export const DEPARTMENTS = ['IT Support', 'Facilities', 'Administration'] as const;
export type DepartmentName = (typeof DEPARTMENTS)[number];

export const BUILDINGS = ['Main Block', 'Science Block', 'Library', 'Computer Labs', 'Hostel A', 'Admin Office'] as const;
export const STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;

const departmentSchema = new Schema(
  { name: { type: String, enum: DEPARTMENTS, required: true, unique: true }, active: { type: Boolean, default: true } },
  { timestamps: true },
);
export const Department = model('Department', departmentSchema);

const userSchema = new Schema(
  {
    displayName: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['reporter', 'staff', 'admin'], required: true, default: 'reporter' },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export const User = model('User', userSchema);

const issueSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    building: { type: String, enum: BUILDINGS, required: true },
    room: { type: String, required: true },
    urgency: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], required: true },
    affectedCount: { type: Number, required: true },
    hazardFlag: { type: Boolean, default: false },
    prediction: {
      department: { type: String, enum: [...DEPARTMENTS, null], default: null },
      confidence: { type: Number, default: 0 },
      needsReview: { type: Boolean, default: false },
      reason: String,
      guess: String,
      topTerms: [String],
      modelVersion: String,
    },
    routingState: { type: String, enum: ['AUTO_ASSIGNED', 'NEEDS_REVIEW', 'NO_STAFF', 'ADMIN'], default: 'NEEDS_REVIEW' },
    suggestedDuplicates: [{ issueId: { type: Schema.Types.ObjectId, ref: 'Issue' }, score: Number, reasons: [String], _id: false }],
    priority: {
      level: { type: String, enum: ['P1', 'P2', 'P3', 'P4'], required: true },
      score: { type: Number, required: true },
      factors: [String],
      overridden: { type: Boolean, default: false },
    },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', index: true },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    status: { type: String, enum: STATUSES, default: 'OPEN', index: true },
    resolutionNote: String,
    firstResponseAt: Date,
    resolvedAt: Date,
    closedAt: Date,
    duplicateLinkIds: [{ type: Schema.Types.ObjectId, ref: 'Issue' }],
  },
  { timestamps: true },
);
issueSchema.index({ createdAt: -1 });
export const Issue = model('Issue', issueSchema);

const activitySchema = new Schema(
  {
    issueId: { type: Schema.Types.ObjectId, ref: 'Issue', required: true, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null }, // null = system
    actorLabel: { type: String, required: true },
    action: { type: String, required: true },
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    reason: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
export const ActivityLog = model('ActivityLog', activitySchema);

const counterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } });
export const Counter = model('Counter', counterSchema);

export async function nextIssueCode(): Promise<string> {
  const c = await Counter.findOneAndUpdate({ _id: 'issue' }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `SR-${String(c!.seq).padStart(6, '0')}`;
}

export const oid = (s: string) => new Types.ObjectId(s);
