import { Request, Response, NextFunction, Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { DEPARTMENTS, Department, Issue, User } from '../models';
import { requireAuth } from '../middleware/auth';
import { computeAnalytics, type AnalyticsIssue } from '../services/analytics';

const querySchema = z.object({ department: z.enum([...DEPARTMENTS, 'Unrouted']).optional() });

/** Scope rules (brief section 3): reporter = own issues, staff = own department, admin = everything (optionally filtered). */
export async function analyticsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const q = querySchema.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'Invalid filter' });
    const u = req.user!;
    const depts = await Department.find().lean();
    const deptName = (id: unknown) => depts.find((d) => String(d._id) === String(id))?.name ?? null;

    const filter: Record<string, unknown> = {};
    let scope = 'All departments';
    if (u.role === 'reporter') {
      filter.reporterId = new mongoose.Types.ObjectId(u.id);
      scope = 'Your issues';
    } else if (u.role === 'staff') {
      if (!u.departmentId) return res.json({ scope: 'No department', ...computeAnalytics([], []) });
      filter.departmentId = new mongoose.Types.ObjectId(u.departmentId);
      scope = deptName(u.departmentId) ?? 'Your department';
    } else if (q.data.department) {
      scope = q.data.department;
      if (q.data.department === 'Unrouted') filter.departmentId = null;
      else filter.departmentId = depts.find((d) => d.name === q.data.department)?._id ?? new mongoose.Types.ObjectId();
    }

    const docs = await Issue.find(filter).select('status priority.level departmentId assigneeId createdAt firstResponseAt resolvedAt closedAt').lean();
    const issues: AnalyticsIssue[] = docs.map((d) => ({
      status: d.status as string,
      priorityLevel: d.priority!.level as AnalyticsIssue['priorityLevel'],
      department: deptName(d.departmentId),
      assigneeId: d.assigneeId ? String(d.assigneeId) : null,
      createdAt: d.createdAt,
      firstResponseAt: d.firstResponseAt,
      resolvedAt: d.resolvedAt,
      closedAt: d.closedAt,
    }));

    // Staff workload is only relevant to staff and admins.
    let staff: { id: string; name: string; department: string | null }[] = [];
    if (u.role !== 'reporter') {
      const staffFilter: Record<string, unknown> = { role: 'staff', active: true };
      if (u.role === 'staff') staffFilter.departmentId = u.departmentId;
      else if (filter.departmentId !== undefined && filter.departmentId !== null) staffFilter.departmentId = filter.departmentId;
      const users = await User.find(staffFilter).select('displayName departmentId').lean();
      staff = users.map((s) => ({ id: String(s._id), name: s.displayName, department: deptName(s.departmentId) }));
    }

    const result = computeAnalytics(issues, staff);
    // A reporter only gets their own summary, not departmental structure or staff names.
    if (u.role === 'reporter') {
      const { workload: _w, byDepartment: _d, ...own } = result;
      return res.json({ scope, ...own });
    }
    res.json({ scope, ...result });
  } catch (e) {
    next(e);
  }
}

export const analyticsRouter = Router();
analyticsRouter.get('/', requireAuth, analyticsHandler);
