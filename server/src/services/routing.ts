import mongoose from 'mongoose';
import { Department, Issue, User } from '../models';

export interface Workload {
  staffId: string;
  active: number;
}

/** Pure selection rule (brief 6.5): lowest active workload, ties broken by lowest staff ID. */
export function pickStaff(staff: Workload[]): string | null {
  if (!staff.length) return null;
  return [...staff].sort((a, b) => a.active - b.active || a.staffId.localeCompare(b.staffId))[0].staffId;
}

/** Active staff of one department with their ASSIGNED + IN_PROGRESS counts. Inactive accounts are never eligible. */
export async function eligibleWorkloads(departmentId: mongoose.Types.ObjectId): Promise<Workload[]> {
  const staff = await User.find({ role: 'staff', active: true, departmentId }).select('_id').lean();
  if (!staff.length) return [];
  const counts = await Issue.aggregate([
    { $match: { assigneeId: { $in: staff.map((s) => s._id) }, status: { $in: ['ASSIGNED', 'IN_PROGRESS'] } } },
    { $group: { _id: '$assigneeId', n: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.n as number]));
  return staff.map((s) => ({ staffId: String(s._id), active: byId.get(String(s._id)) ?? 0 }));
}

export type RoutingState = 'AUTO_ASSIGNED' | 'NEEDS_REVIEW' | 'NO_STAFF';

/** Routes by predicted department only. Never crosses departments, never guesses when unsure. */
export async function routeIssue(department: string | null): Promise<{ state: RoutingState; departmentId?: mongoose.Types.ObjectId; assigneeId?: string }> {
  if (!department) return { state: 'NEEDS_REVIEW' };
  const dept = await Department.findOne({ name: department, active: true }).lean();
  if (!dept) return { state: 'NO_STAFF' };
  const assigneeId = pickStaff(await eligibleWorkloads(dept._id));
  return assigneeId ? { state: 'AUTO_ASSIGNED', departmentId: dept._id, assigneeId } : { state: 'NO_STAFF', departmentId: dept._id };
}
