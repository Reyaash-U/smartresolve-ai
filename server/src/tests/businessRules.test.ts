import { describe, expect, it } from 'vitest';
import { computePriority } from '../services/priority';
import { computeSla } from '../services/sla';
import { checkTransition } from '../services/statusMachine';

describe('priority thresholds', () => {
  it('LOW/1 person scores 3 -> P4', () => expect(computePriority({ urgency: 'LOW', affectedCount: 1, hazard: false }).level).toBe('P4'));
  it('score 4 is P4', () => expect(computePriority({ urgency: 'LOW', affectedCount: 6, hazard: false }).score).toBe(4));
  it('score 5 is P3', () => expect(computePriority({ urgency: 'LOW', affectedCount: 21, hazard: false }).level).toBe('P3'));
  it('score 7 is P3', () => expect(computePriority({ urgency: 'MEDIUM', affectedCount: 21, hazard: false }).level).toBe('P3'));
  it('score 7 (HIGH, 1 person) is still P3', () => expect(computePriority({ urgency: 'HIGH', affectedCount: 1, hazard: false }).level).toBe('P3'));
  it('score 8 is P2', () => expect(computePriority({ urgency: 'HIGH', affectedCount: 10, hazard: false })).toMatchObject({ score: 8, level: 'P2' }));
  it('score 9 is P2 (max without hazard)', () => expect(computePriority({ urgency: 'HIGH', affectedCount: 500, hazard: false })).toMatchObject({ score: 9, level: 'P2' }));
  it('hazard forces P1 even for low inputs', () => {
    const r = computePriority({ urgency: 'LOW', affectedCount: 1, hazard: true });
    expect(r.level).toBe('P1');
    expect(r.score).toBe(8);
  });
  it('is deterministic', () => {
    const a = computePriority({ urgency: 'MEDIUM', affectedCount: 35, hazard: false });
    const b = computePriority({ urgency: 'MEDIUM', affectedCount: 35, hazard: false });
    expect(a).toEqual(b);
  });
});

describe('SLA', () => {
  const created = new Date('2026-10-01T00:00:00Z');
  it('P1 response overdue after 2h without response', () => {
    const s = computeSla({ priority: 'P1', createdAt: created }, new Date('2026-10-01T03:00:00Z'));
    expect(s.responseOverdue).toBe(true);
    expect(s.overdueByMs).toBe(3600_000);
  });
  it('not overdue once responded', () => {
    const s = computeSla({ priority: 'P1', createdAt: created, firstResponseAt: new Date('2026-10-01T01:00:00Z') }, new Date('2026-10-01T03:00:00Z'));
    expect(s.responseOverdue).toBe(false);
  });
  it('resolution overdue after deadline when unresolved', () => {
    const s = computeSla({ priority: 'P3', createdAt: created, firstResponseAt: created }, new Date('2026-10-05T00:00:00Z'));
    expect(s.resolutionOverdue).toBe(true);
    expect(s.breached).toBe('resolution');
  });
  it('resolved tickets are never overdue', () => {
    const s = computeSla({ priority: 'P4', createdAt: created, firstResponseAt: created, resolvedAt: created }, new Date('2027-01-01'));
    expect(s.overdue).toBe(false);
  });
});

describe('status machine', () => {
  const base = { isOwner: false, isAssignedDept: true };
  it('rejects skipping states', () => expect(checkTransition({ from: 'OPEN', to: 'RESOLVED', role: 'admin', ...base }).ok).toBe(false));
  it('staff cannot close', () => expect(checkTransition({ from: 'RESOLVED', to: 'CLOSED', role: 'staff', ...base }).ok).toBe(false));
  it('owner reporter can close', () => expect(checkTransition({ from: 'RESOLVED', to: 'CLOSED', role: 'reporter', isOwner: true, isAssignedDept: false }).ok).toBe(true));
  it('other reporter cannot close', () => expect(checkTransition({ from: 'RESOLVED', to: 'CLOSED', role: 'reporter', isOwner: false, isAssignedDept: false }).ok).toBe(false));
  it('reopen needs reason', () => expect(checkTransition({ from: 'RESOLVED', to: 'IN_PROGRESS', role: 'reporter', isOwner: true, isAssignedDept: false })).toEqual({ ok: true, needsReason: true }));
  it('resolve needs note', () => expect(checkTransition({ from: 'IN_PROGRESS', to: 'RESOLVED', role: 'staff', ...base }).needsNote).toBe(true));
  it('staff from another department cannot start work', () => expect(checkTransition({ from: 'ASSIGNED', to: 'IN_PROGRESS', role: 'staff', isOwner: false, isAssignedDept: false }).ok).toBe(false));
  it('admin exceptional closure needs reason', () => expect(checkTransition({ from: 'OPEN', to: 'CLOSED', role: 'admin', ...base })).toEqual({ ok: true, needsReason: true }));
});
