export type Status = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type Role = 'reporter' | 'staff' | 'admin';

export interface TransitionCheck {
  ok: boolean;
  error?: string;
  /** true: the actor lacks permission (403); false/absent with ok=false: the move itself is illegal (409). */
  forbidden?: boolean;
  needsReason?: boolean;
  needsNote?: boolean;
}

const NORMAL: Record<Status, Status | null> = {
  OPEN: 'ASSIGNED',
  ASSIGNED: 'IN_PROGRESS',
  IN_PROGRESS: 'RESOLVED',
  RESOLVED: 'CLOSED',
  CLOSED: null,
};

const deny = (error: string): TransitionCheck => ({ ok: false, error, forbidden: true });

/**
 * Pure transition validator, brief FR-08.
 * isOwner: actor is the issue's reporter. isAssignedDept: staff belongs to the issue's department.
 */
export function checkTransition(args: {
  from: Status;
  to: Status;
  role: Role;
  isOwner: boolean;
  isAssignedDept: boolean;
}): TransitionCheck {
  const { from, to, role, isOwner, isAssignedDept } = args;

  if (from === to) return { ok: false, error: 'Issue is already in that status' };
  if (from === 'CLOSED') return { ok: false, error: 'Closed issues cannot change status' };

  // Reopen: RESOLVED -> IN_PROGRESS by reporter (own) or admin, with reason
  if (from === 'RESOLVED' && to === 'IN_PROGRESS') {
    if (role === 'admin' || (role === 'reporter' && isOwner)) return { ok: true, needsReason: true };
    return deny('Only the reporter or an admin may reopen a resolved issue');
  }

  // Exceptional admin closure from any unresolved state, explicit reason
  if (to === 'CLOSED' && from !== 'RESOLVED') {
    return role === 'admin' ? { ok: true, needsReason: true } : { ok: false, error: `Illegal transition ${from} → ${to}` };
  }

  if (NORMAL[from] !== to) return { ok: false, error: `Illegal transition ${from} → ${to}` };

  switch (to) {
    case 'ASSIGNED':
      // Normally done by the assignment engine/admin, not manual status move
      return role === 'admin' ? { ok: true } : deny('Assignment is performed by routing or an admin');
    case 'IN_PROGRESS':
      if (role === 'admin') return { ok: true };
      if (role === 'staff' && isAssignedDept) return { ok: true };
      return deny('Only staff of the assigned department or an admin may start work');
    case 'RESOLVED':
      if (role === 'admin' || (role === 'staff' && isAssignedDept)) return { ok: true, needsNote: true };
      return deny('Only staff of the assigned department or an admin may resolve');
    case 'CLOSED':
      if (role === 'reporter' && isOwner) return { ok: true };
      if (role === 'admin') return { ok: true, needsReason: true };
      return deny('Only the reporter (or an admin with a reason) may close an issue');
    default:
      return { ok: false, error: 'Illegal transition' };
  }
}
