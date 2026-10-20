import { Router, Request } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ActivityLog, Department, Issue, STATUSES, User } from '../models';
import { checkTransition, type Status } from '../services/statusMachine';
import { requireAuth, requireRole } from '../middleware/auth';
import { duplicateSummaries, loadVisible, toDto, withDepartmentNames } from './issues';

const objectId = z.string().refine((s) => mongoose.isValidObjectId(s), 'Invalid ID');
const reasonField = z.string().trim().min(5, 'A reason of at least 5 characters is required').max(300);
const UNRESOLVED = ['OPEN', 'ASSIGNED', 'IN_PROGRESS'];

const bad = (res: any, error: string, details?: { field: string; message: string }[]) => res.status(400).json({ error, details });

async function respond(req: Request, res: any, id: string) {
  const doc = await Issue.findById(id).populate('reporterId', 'displayName').populate('assigneeId', 'displayName').lean();
  const [withDept] = await withDepartmentNames([doc!]);
  const dto = toDto(withDept, req.user!.role);
  dto.suggestedDuplicates = await duplicateSummaries(withDept);
  return res.json({ issue: dto });
}

const actor = (req: Request) => ({ actorId: req.user!.id, actorLabel: req.user!.displayName });

export const issueActionsRouter = Router();
issueActionsRouter.use(requireAuth);

// --- Assign / reassign (admin only) ------------------------------------------------------------
const assignSchema = z.object({ assigneeId: objectId, reason: reasonField.optional() }).strict();

issueActionsRouter.patch('/:id/assignment', requireRole('admin'), async (req, res, next) => {
  try {
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) return bad(res, 'Invalid assignment', parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Issue not found' });

    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    if (!UNRESOLVED.includes(issue.status)) return res.status(409).json({ error: 'Only unresolved issues can be assigned' });

    const staff = await User.findOne({ _id: parsed.data.assigneeId, role: 'staff', active: true });
    if (!staff?.departmentId) return bad(res, 'Choose an active staff member who belongs to a department');
    if (String(issue.assigneeId) === String(staff._id)) return res.status(409).json({ error: 'That staff member already owns this issue' });

    const isReassign = !!issue.assigneeId || (!!issue.departmentId && String(issue.departmentId) !== String(staff.departmentId));
    if (isReassign && !parsed.data.reason) return bad(res, 'A reason is required to reassign', [{ field: 'reason', message: 'A reason of at least 5 characters is required' }]);

    const depts = await Department.find().lean();
    const name = (id?: unknown) => depts.find((d) => String(d._id) === String(id))?.name ?? null;
    const before = { status: issue.status, assignee: issue.assigneeId ? (await User.findById(issue.assigneeId).select('displayName').lean())?.displayName : null, department: name(issue.departmentId) };

    issue.assigneeId = staff._id;
    issue.departmentId = staff.departmentId;
    issue.routingState = 'ADMIN';
    if (issue.status === 'OPEN') issue.status = 'ASSIGNED';
    await issue.save();

    await ActivityLog.create({
      issueId: issue._id,
      ...actor(req),
      action: isReassign ? 'REASSIGNED' : 'ASSIGNED',
      before,
      after: { status: issue.status, assignee: staff.displayName, department: name(staff.departmentId) },
      reason: parsed.data.reason,
    });
    return respond(req, res, issue.id);
  } catch (e) {
    next(e);
  }
});

// --- Priority: admin overrides, staff may only suggest ------------------------------------------
const prioritySchema = z.object({ level: z.enum(['P1', 'P2', 'P3', 'P4']), reason: reasonField }).strict();

issueActionsRouter.patch('/:id/priority', requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const parsed = prioritySchema.safeParse(req.body);
    if (!parsed.success) return bad(res, 'Invalid priority change', parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));

    const visible = await loadVisible(req); // 404 for staff outside their department
    if (!visible) return res.status(404).json({ error: 'Issue not found' });
    const issue = await Issue.findById(visible._id);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    if (issue.status === 'CLOSED') return res.status(409).json({ error: 'Closed issues cannot change priority' });

    const { level, reason } = parsed.data;
    if (req.user!.role === 'staff') {
      await ActivityLog.create({ issueId: issue._id, ...actor(req), action: 'PRIORITY_SUGGESTED', before: { level: issue.priority!.level }, after: { level }, reason });
      return respond(req, res, issue.id);
    }
    if (level === issue.priority!.level) return res.status(409).json({ error: `Priority is already ${level}` });

    const before = { level: issue.priority!.level, score: issue.priority!.score };
    issue.priority!.factors.push(`Admin override ${before.level} → ${level}: ${reason}`);
    issue.priority!.level = level;
    issue.priority!.overridden = true;
    await issue.save();
    await ActivityLog.create({ issueId: issue._id, ...actor(req), action: 'PRIORITY_OVERRIDDEN', before, after: { level }, reason });
    return respond(req, res, issue.id);
  } catch (e) {
    next(e);
  }
});

// --- Link possible duplicates (admin only). Both records stay intact. --------------------------------
const linkSchema = z.object({ otherId: objectId, reason: reasonField.optional() }).strict();

issueActionsRouter.post('/:id/links', requireRole('admin'), async (req, res, next) => {
  try {
    const parsed = linkSchema.safeParse(req.body);
    if (!parsed.success) return bad(res, 'Invalid link', parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Issue not found' });
    if (req.params.id === parsed.data.otherId) return bad(res, 'An issue cannot be linked to itself');

    const [a, b] = await Promise.all([Issue.findById(req.params.id), Issue.findById(parsed.data.otherId)]);
    if (!a || !b) return res.status(404).json({ error: 'Issue not found' });
    if (a.duplicateLinkIds.some((x) => String(x) === String(b._id))) return res.status(409).json({ error: 'These issues are already linked' });

    await Promise.all([Issue.updateOne({ _id: a._id }, { $addToSet: { duplicateLinkIds: b._id } }), Issue.updateOne({ _id: b._id }, { $addToSet: { duplicateLinkIds: a._id } })]);
    await ActivityLog.create([
      { issueId: a._id, ...actor(req), action: 'DUPLICATE_LINKED', after: { linkedTo: b.code }, reason: parsed.data.reason },
      { issueId: b._id, ...actor(req), action: 'DUPLICATE_LINKED', after: { linkedTo: a.code }, reason: parsed.data.reason },
    ]);
    return respond(req, res, a.id);
  } catch (e) {
    next(e);
  }
});

// --- Status workflow (FR-08/FR-09) ---------------------------------------------------------------
const statusSchema = z
  .object({
    status: z.enum(STATUSES),
    note: z.string().trim().min(15, 'A resolution note of at least 15 characters is required').max(1000).optional(),
    reason: reasonField.optional(),
  })
  .strict();

const fieldErr = (field: string, message: string) => [{ field, message }];

issueActionsRouter.patch('/:id/status', async (req, res, next) => {
  try {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return bad(res, 'Invalid status change', parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));

    const visible = await loadVisible(req); // 404 for anyone who cannot see the issue
    if (!visible) return res.status(404).json({ error: 'Issue not found' });
    const issue = await Issue.findById(visible._id);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    const u = req.user!;
    const { status: to, note, reason } = parsed.data;
    const from = issue.status as Status;

    const check = checkTransition({
      from,
      to,
      role: u.role,
      isOwner: String(issue.reporterId) === u.id,
      isAssignedDept: !!u.departmentId && String(issue.departmentId) === u.departmentId,
    });
    if (!check.ok) return res.status(check.forbidden ? 403 : 409).json({ error: check.error });
    if (to === 'ASSIGNED') return bad(res, 'Use the assignment action to choose a staff member');
    if (check.needsNote && !note) return bad(res, 'A resolution note is required before resolving', fieldErr('note', 'A resolution note of at least 15 characters is required'));
    if (check.needsReason && !reason) return bad(res, 'A reason is required for this change', fieldErr('reason', 'A reason of at least 5 characters is required'));

    const now = new Date();
    const before: Record<string, unknown> = { status: from, resolvedAt: issue.resolvedAt ?? null };
    let action = 'STATUS_CHANGED';

    issue.status = to;
    if (to === 'IN_PROGRESS' && from === 'ASSIGNED' && u.role === 'staff' && !issue.firstResponseAt) issue.firstResponseAt = now;
    if (to === 'IN_PROGRESS' && from === 'RESOLVED') {
      action = 'REOPENED';
      issue.resolvedAt = undefined; // the resolution obligation is pending again
    }
    if (to === 'RESOLVED') {
      issue.resolutionNote = note;
      issue.resolvedAt = now;
    }
    if (to === 'CLOSED') {
      issue.closedAt = now;
      action = from === 'RESOLVED' ? 'CLOSED' : 'ADMIN_CLOSED';
    }
    await issue.save();

    await ActivityLog.create({
      issueId: issue._id,
      ...actor(req),
      action,
      before,
      after: { status: to, ...(to === 'RESOLVED' ? { resolutionNote: note } : {}) },
      reason,
    });
    return respond(req, res, issue.id);
  } catch (e) {
    next(e);
  }
});

/** Staff acknowledgement: counts as the first response (FR-10) without changing status. */
issueActionsRouter.post('/:id/acknowledge', requireRole('staff'), async (req, res, next) => {
  try {
    const visible = await loadVisible(req);
    if (!visible) return res.status(404).json({ error: 'Issue not found' });
    const issue = await Issue.findById(visible._id);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    if (!UNRESOLVED.includes(issue.status)) return res.status(409).json({ error: 'Only unresolved issues can be acknowledged' });
    if (issue.firstResponseAt) return res.status(409).json({ error: 'This issue has already been acknowledged' });

    issue.firstResponseAt = new Date();
    await issue.save();
    await ActivityLog.create({ issueId: issue._id, ...actor(req), action: 'ACKNOWLEDGED', after: { firstResponseAt: issue.firstResponseAt } });
    return respond(req, res, issue.id);
  } catch (e) {
    next(e);
  }
});

const noteSchema = z.object({ note: z.string().trim().min(3, 'Write at least 3 characters').max(500) }).strict();

/** Staff progress note, visible in the history; also counts as a first response. */
issueActionsRouter.post('/:id/notes', requireRole('staff'), async (req, res, next) => {
  try {
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) return bad(res, 'Invalid note', parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
    const visible = await loadVisible(req);
    if (!visible) return res.status(404).json({ error: 'Issue not found' });
    const issue = await Issue.findById(visible._id);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    if (!UNRESOLVED.includes(issue.status)) return res.status(409).json({ error: 'Notes can only be added to unresolved issues' });

    if (!issue.firstResponseAt) {
      issue.firstResponseAt = new Date();
      await issue.save();
    }
    await ActivityLog.create({ issueId: issue._id, ...actor(req), action: 'NOTE_ADDED', after: { note: parsed.data.note } });
    return respond(req, res, issue.id);
  } catch (e) {
    next(e);
  }
});
