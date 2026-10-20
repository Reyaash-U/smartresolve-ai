import { Router, Request } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ActivityLog, BUILDINGS, DEPARTMENTS, Department, Issue, STATUSES, nextIssueCode } from '../models';
import { requireAuth, requireRole } from '../middleware/auth';
import { User } from '../models';
import { computePriority } from '../services/priority';
import { slaForIssue } from '../services/sla';
import { EMERGENCY_MESSAGE, needsEmergencyGuidance } from '../services/emergency';
import { classifyIssue } from '../ml/classifier';
import { findDuplicates } from '../services/duplicates';
import { routeIssue } from '../services/routing';
import { config } from '../config';

// strict(): reporterId, status, priority, timestamps etc. can never be supplied by the client.
const createSchema = z
  .object({
    title: z.string().trim().min(5, 'Title must be 5–120 characters').max(120, 'Title must be 5–120 characters'),
    description: z.string().trim().min(20, 'Description must be 20–1,000 characters').max(1000, 'Description must be 20–1,000 characters'),
    building: z.enum(BUILDINGS, { errorMap: () => ({ message: 'Choose a building from the list' }) }),
    room: z.string().trim().min(2, 'Room/location must be 2–80 characters').max(80, 'Room/location must be 2–80 characters'),
    urgency: z.enum(['LOW', 'MEDIUM', 'HIGH'], { errorMap: () => ({ message: 'Urgency must be LOW, MEDIUM or HIGH' }) }),
    affectedCount: z.number({ invalid_type_error: 'Affected people must be a whole number' }).int('Affected people must be a whole number').min(1, 'Affected people must be 1–500').max(500, 'Affected people must be 1–500'),
    hazardFlag: z.boolean({ invalid_type_error: 'Safety hazard must be true or false' }).default(false),
  })
  .strict();

const listQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
  department: z.enum(DEPARTMENTS).optional(),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  unassigned: z.enum(['true']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

type Lean = Record<string, any>;

/** "Safe summary" of a possibly related report: never includes reporter name, email or profile. */
interface DuplicateSummary {
  id: string;
  code: string;
  title: string;
  status: string;
  building: string;
  room: string;
  department: string | null;
  score: number;
  reasons: string[];
}

export async function duplicateSummaries(doc: Lean): Promise<DuplicateSummary[]> {
  const ids = (doc.suggestedDuplicates ?? []).map((d: Lean) => d.issueId);
  if (!ids.length) return [];
  const found = await Issue.find({ _id: { $in: ids } }).lean();
  const [withDept] = [await withDepartmentNames(found)];
  const byId = new Map(withDept.map((i) => [String(i._id), i]));
  return (doc.suggestedDuplicates as Lean[]).flatMap((d) => {
    const i = byId.get(String(d.issueId));
    return i
      ? [{ id: String(i._id), code: i.code, title: i.title, status: i.status, building: i.building, room: i.room, department: i.departmentName ?? null, score: d.score, reasons: d.reasons }]
      : [];
  });
}

/** Shape an issue for the API. Reporter identity is only exposed to staff/admin, never email. */
export function toDto(issue: Lean, viewerRole: string, now = new Date()) {
  const sla = slaForIssue(issue as Parameters<typeof slaForIssue>[0], now);
  const reporter = issue.reporterId && typeof issue.reporterId === 'object' && 'displayName' in issue.reporterId ? issue.reporterId : null;
  const assignee = issue.assigneeId && typeof issue.assigneeId === 'object' && 'displayName' in issue.assigneeId ? issue.assigneeId : null;
  return {
    id: String(issue._id),
    code: issue.code,
    title: issue.title,
    description: issue.description,
    building: issue.building,
    room: issue.room,
    urgency: issue.urgency,
    affectedCount: issue.affectedCount,
    hazardFlag: issue.hazardFlag,
    status: issue.status,
    prediction: issue.prediction,
    routingState: issue.routingState,
    suggestedDuplicates: [] as DuplicateSummary[],
    linkedCount: (issue.duplicateLinkIds ?? []).length,
    priority: issue.priority,
    department: issue.departmentName ?? null,
    assignee: assignee ? { id: String(assignee._id), displayName: assignee.displayName } : null,
    reporter: viewerRole === 'reporter' ? undefined : reporter ? { displayName: reporter.displayName } : undefined,
    resolutionNote: issue.resolutionNote,
    firstResponseAt: issue.firstResponseAt ?? null,
    resolvedAt: issue.resolvedAt ?? null,
    closedAt: issue.closedAt ?? null,
    createdAt: issue.createdAt,
    sla: {
      responseDeadline: sla.responseDeadline,
      resolutionDeadline: sla.resolutionDeadline,
      overdue: sla.overdue,
      breached: sla.breached,
      overdueByMs: sla.overdueByMs,
    },
    unassignedAdminReview: !issue.assigneeId && issue.status === 'OPEN',
    emergencyGuidance: needsEmergencyGuidance(`${issue.title} ${issue.description}`, issue.hazardFlag) ? EMERGENCY_MESSAGE : null,
  };
}

export async function withDepartmentNames<T extends Lean>(issues: T[]): Promise<(T & { departmentName: string | null })[]> {
  const depts = await Department.find().lean();
  const names = new Map(depts.map((d) => [String(d._id), d.name]));
  return issues.map((i) => ({ ...i, departmentName: (i.departmentId ? names.get(String(i.departmentId)) : null) ?? null }));
}

/** Can this viewer see this issue? Returns false rather than leaking existence. */
function canView(req: Request, issue: Lean): boolean {
  const u = req.user!;
  if (u.role === 'admin') return true;
  const reporterId = String(issue.reporterId?._id ?? issue.reporterId);
  if (u.role === 'reporter') return reporterId === u.id;
  return !!u.departmentId && !!issue.departmentId && String(issue.departmentId) === u.departmentId;
}

export const issuesRouter = Router();
issuesRouter.use(requireAuth);

issuesRouter.post('/', requireRole('reporter', 'admin'), async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Please fix the highlighted fields', details: parsed.error.issues.map((i) => ({ field: i.path.join('.') || 'body', message: i.message })) });
    }
    const input = parsed.data;
    const priority = computePriority({ urgency: input.urgency, affectedCount: input.affectedCount, hazard: input.hazardFlag });
    const cls = classifyIssue(input.title, input.description, config.classifierThreshold);
    const route = await routeIssue(cls.department);

    // Possible duplicates among unresolved issues; compared against the routed department when known.
    const open = await Issue.find({ status: { $in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] } }).sort({ createdAt: -1 }).limit(300).lean();
    const openWithDept = await withDepartmentNames(open);
    const dupes = findDuplicates(
      { id: '', title: input.title, description: input.description, building: input.building, room: input.room, department: cls.department },
      openWithDept.map((i) => ({ id: String(i._id), title: i.title, description: i.description, building: i.building, room: i.room, department: i.departmentName ?? null })),
      config.duplicateThreshold,
    );

    const issue = await Issue.create({
      ...input,
      code: await nextIssueCode(),
      reporterId: req.user!.id, // always from the verified session
      status: route.assigneeId ? 'ASSIGNED' : 'OPEN',
      priority: { level: priority.level, score: priority.score, factors: priority.factors },
      prediction: {
        department: cls.department,
        confidence: cls.confidence,
        needsReview: cls.needsReview,
        reason: cls.reason,
        guess: cls.guess,
        topTerms: cls.topTerms,
        modelVersion: cls.modelVersion,
      },
      routingState: route.state,
      departmentId: route.departmentId,
      assigneeId: route.assigneeId,
      suggestedDuplicates: dupes.map((d) => ({ issueId: d.id, score: d.score, reasons: d.reasons })),
    });

    const sys = { actorId: null, actorLabel: 'System' };
    const logs: Record<string, unknown>[] = [
      { issueId: issue._id, actorId: req.user!.id, actorLabel: req.user!.displayName, action: 'CREATED', after: { status: 'OPEN' } },
      { issueId: issue._id, ...sys, action: 'PRIORITY_RECOMMENDED', after: { level: priority.level, score: priority.score, factors: priority.factors } },
      {
        issueId: issue._id,
        ...sys,
        action: 'CATEGORY_PREDICTED',
        after: { department: cls.department, leadingGuess: cls.guess, confidence: cls.confidence, needsReview: cls.needsReview, modelVersion: cls.modelVersion },
        reason: cls.reason || undefined,
      },
    ];
    // Only a count: the history is visible to the reporter, who must not learn other tickets' identifiers.
    if (dupes.length) logs.push({ issueId: issue._id, ...sys, action: 'DUPLICATES_SUGGESTED', after: { count: dupes.length, topScore: dupes[0].score } });
    if (route.assigneeId) {
      const staff = await User.findById(route.assigneeId).select('displayName').lean();
      logs.push({ issueId: issue._id, ...sys, action: 'AUTO_ASSIGNED', before: { status: 'OPEN' }, after: { status: 'ASSIGNED', assignee: staff?.displayName, department: cls.department } });
    } else {
      logs.push({
        issueId: issue._id,
        ...sys,
        action: 'ROUTING_QUEUED',
        reason: route.state === 'NEEDS_REVIEW' ? 'Low confidence: left for administrator review' : 'No eligible active staff in the department: left for administrator assignment',
      });
    }
    await ActivityLog.create(logs);

    const fresh = await Issue.findById(issue._id).populate('reporterId', 'displayName').populate('assigneeId', 'displayName').lean();
    const [withDept] = await withDepartmentNames([fresh!]);
    const dto = toDto(withDept, req.user!.role);
    dto.suggestedDuplicates = await duplicateSummaries(withDept);
    res.status(201).json({ issue: dto });
  } catch (e) {
    next(e);
  }
});

issuesRouter.get('/', async (req, res, next) => {
  try {
    const q = listQuerySchema.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'Invalid filter', details: q.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
    const u = req.user!;

    const filter: Record<string, unknown> = {};
    if (u.role === 'reporter') filter.reporterId = new mongoose.Types.ObjectId(u.id);
    else if (u.role === 'staff') {
      if (!u.departmentId) return res.json({ issues: [], total: 0 });
      filter.departmentId = new mongoose.Types.ObjectId(u.departmentId);
    }
    if (q.data.status) filter.status = q.data.status;
    if (q.data.priority) filter['priority.level'] = q.data.priority;
    if (q.data.unassigned) Object.assign(filter, { assigneeId: null, status: 'OPEN' });
    if (q.data.department) {
      const d = await Department.findOne({ name: q.data.department }).lean();
      // Reporters/staff scoping above already applies; an extra department filter only narrows.
      if (u.role === 'staff' && d && String(d._id) !== u.departmentId) return res.json({ issues: [], total: 0 });
      filter.departmentId = d?._id ?? new mongoose.Types.ObjectId();
    }

    const docs = await Issue.find(filter).sort({ createdAt: -1 }).populate('reporterId', 'displayName').populate('assigneeId', 'displayName').lean();
    let issues = (await withDepartmentNames(docs)).map((d) => toDto(d, u.role));
    // Overdue is derived at read time (no cron), so it is filtered after computing.
    if (q.data.overdue) issues = issues.filter((i) => i.sla.overdue === (q.data.overdue === 'true'));
    res.json({ issues: issues.slice(0, q.data.limit), total: issues.length });
  } catch (e) {
    next(e);
  }
});

export async function loadVisible(req: Request) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return null;
  const doc = await Issue.findById(id).populate('reporterId', 'displayName').populate('assigneeId', 'displayName').lean();
  if (!doc || !canView(req, doc)) return null;
  return doc;
}

issuesRouter.get('/:id', async (req, res, next) => {
  try {
    const doc = await loadVisible(req);
    if (!doc) return res.status(404).json({ error: 'Issue not found' });
    const [withDept] = await withDepartmentNames([doc]);
    const dto = toDto(withDept, req.user!.role);
    dto.suggestedDuplicates = await duplicateSummaries(withDept);
    res.json({ issue: dto });
  } catch (e) {
    next(e);
  }
});

issuesRouter.get('/:id/activity', async (req, res, next) => {
  try {
    const doc = await loadVisible(req);
    if (!doc) return res.status(404).json({ error: 'Issue not found' });
    const logs = await ActivityLog.find({ issueId: doc._id }).sort({ createdAt: 1, _id: 1 }).lean();
    res.json({ activity: logs.map((l) => ({ id: String(l._id), actor: l.actorLabel, action: l.action, before: l.before, after: l.after, reason: l.reason, createdAt: l.createdAt })) });
  } catch (e) {
    next(e);
  }
});
