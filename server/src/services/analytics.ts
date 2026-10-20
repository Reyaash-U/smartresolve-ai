import { slaForIssue } from './sla';

export const STATUS_KEYS = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export const DEPT_KEYS = ['IT Support', 'Facilities', 'Administration', 'Unrouted'] as const;
export const PRIORITY_KEYS = ['P1', 'P2', 'P3', 'P4'] as const;

export interface AnalyticsIssue {
  status: string;
  priorityLevel: 'P1' | 'P2' | 'P3' | 'P4';
  department: string | null;
  assigneeId?: string | null;
  createdAt: Date;
  firstResponseAt?: Date | null;
  resolvedAt?: Date | null;
  closedAt?: Date | null;
}

export interface StaffRef {
  id: string;
  name: string;
  department: string | null;
}

const zero = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Every figure is derived from the stored issues passed in, so the dashboard always reconciles with
 * the underlying records (including after filtering): each breakdown sums to `total`.
 */
export function computeAnalytics(issues: AnalyticsIssue[], staff: StaffRef[], now: Date = new Date()) {
  const byStatus = zero(STATUS_KEYS);
  const byDepartment = zero(DEPT_KEYS);
  const byPriority = zero(PRIORITY_KEYS);
  const overdue = { total: 0, response: 0, resolution: 0 };
  const resolutionHours: number[] = [];
  const active = new Map<string, number>();
  let unresolved = 0;
  let unassigned = 0;

  for (const i of issues) {
    byStatus[i.status as (typeof STATUS_KEYS)[number]]++;
    byDepartment[(i.department as (typeof DEPT_KEYS)[number]) ?? 'Unrouted']++;
    byPriority[i.priorityLevel]++;

    const isUnresolved = i.status === 'OPEN' || i.status === 'ASSIGNED' || i.status === 'IN_PROGRESS';
    if (isUnresolved) unresolved++;
    if (i.status === 'OPEN' && !i.assigneeId) unassigned++;
    if ((i.status === 'ASSIGNED' || i.status === 'IN_PROGRESS') && i.assigneeId) active.set(i.assigneeId, (active.get(i.assigneeId) ?? 0) + 1);

    const sla = slaForIssue({ priority: { level: i.priorityLevel }, createdAt: i.createdAt, firstResponseAt: i.firstResponseAt, resolvedAt: i.resolvedAt, closedAt: i.closedAt, status: i.status }, now);
    if (sla.overdue) {
      overdue.total++;
      if (sla.breached === 'response') overdue.response++;
      else if (sla.breached === 'resolution') overdue.resolution++;
    }
    if (i.resolvedAt) resolutionHours.push((i.resolvedAt.getTime() - i.createdAt.getTime()) / 3600_000);
  }

  const total = issues.length;
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  const avg = resolutionHours.length ? resolutionHours.reduce((a, b) => a + b, 0) / resolutionHours.length : null;
  const med = median(resolutionHours);

  return {
    total,
    byStatus,
    byDepartment,
    byPriority,
    unresolved,
    unassigned,
    awaitingConfirmation: byStatus.RESOLVED,
    overdue,
    resolution: { count: resolutionHours.length, averageHours: avg === null ? null : round1(avg), medianHours: med === null ? null : round1(med) },
    workload: staff.map((s) => ({ staffId: s.id, name: s.name, department: s.department, active: active.get(s.id) ?? 0 })).sort((a, b) => b.active - a.active || a.name.localeCompare(b.name)),
    reconciliation: {
      total,
      statusSum: sum(byStatus),
      departmentSum: sum(byDepartment),
      prioritySum: sum(byPriority),
      ok: sum(byStatus) === total && sum(byDepartment) === total && sum(byPriority) === total,
    },
    generatedAt: now.toISOString(),
  };
}
