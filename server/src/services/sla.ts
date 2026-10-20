import type { PriorityLevel } from './priority';

const HOUR = 3600_000;

/** Demonstration SLA table, brief section 6.4 (hours). */
export const SLA_HOURS: Record<PriorityLevel, { response: number; resolution: number }> = {
  P1: { response: 2, resolution: 8 },
  P2: { response: 8, resolution: 24 },
  P3: { response: 24, resolution: 72 },
  P4: { response: 48, resolution: 120 },
};

export interface SlaInput {
  priority: PriorityLevel;
  createdAt: Date;
  firstResponseAt?: Date | null;
  resolvedAt?: Date | null;
}

export interface SlaStatus {
  responseDeadline: Date;
  resolutionDeadline: Date;
  responseOverdue: boolean;
  resolutionOverdue: boolean;
  overdue: boolean;
  /** ms past the earliest breached pending deadline (0 if none) */
  overdueByMs: number;
  breached: 'response' | 'resolution' | null;
}

/**
 * SLA for a stored issue document. A CLOSED issue has no pending obligation, so an exceptional
 * admin closure (never resolved) is not reported overdue forever.
 */
export function slaForIssue(
  i: { priority: { level: PriorityLevel }; createdAt: Date; firstResponseAt?: Date | null; resolvedAt?: Date | null; closedAt?: Date | null; status: string },
  now: Date = new Date(),
): SlaStatus {
  const closed = i.status === 'CLOSED';
  return computeSla(
    {
      priority: i.priority.level,
      createdAt: i.createdAt,
      firstResponseAt: i.firstResponseAt ?? (closed ? i.closedAt : null),
      resolvedAt: i.resolvedAt ?? (closed ? i.closedAt : null),
    },
    now,
  );
}

/** Computed on read; no scheduler needed. Timers start at original creation. */
export function computeSla(i: SlaInput, now: Date = new Date()): SlaStatus {
  const t = SLA_HOURS[i.priority];
  const responseDeadline = new Date(i.createdAt.getTime() + t.response * HOUR);
  const resolutionDeadline = new Date(i.createdAt.getTime() + t.resolution * HOUR);

  const responseOverdue = !i.firstResponseAt && now > responseDeadline;
  const resolutionOverdue = !i.resolvedAt && now > resolutionDeadline;

  let overdueByMs = 0;
  let breached: SlaStatus['breached'] = null;
  if (responseOverdue) {
    overdueByMs = now.getTime() - responseDeadline.getTime();
    breached = 'response';
  }
  if (resolutionOverdue) {
    const r = now.getTime() - resolutionDeadline.getTime();
    if (r > overdueByMs) {
      overdueByMs = r;
      breached = 'resolution';
    }
  }
  return {
    responseDeadline,
    resolutionDeadline,
    responseOverdue,
    resolutionOverdue,
    overdue: responseOverdue || resolutionOverdue,
    overdueByMs,
    breached,
  };
}
