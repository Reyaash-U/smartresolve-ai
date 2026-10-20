export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

const TOKEN_KEY = 'sr_token';
export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* storage unavailable */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  status: number;
  details: FieldError[];
  constructor(message: string, status: number, details: FieldError[] = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError('Cannot reach the server. It may be waking up — please try again in a moment.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? 'Something went wrong', res.status, data.details ?? []);
  return data as T;
}

/** Free-tier backends sleep; retry so the UI can show a "waking up" state. */
export async function waitForBackend(onAttempt?: (n: number) => void, maxAttempts = 8): Promise<boolean> {
  for (let n = 1; n <= maxAttempts; n++) {
    onAttempt?.(n);
    try {
      const r = await fetch(`${API_URL}/health`);
      if (r.ok) return true;
    } catch {
      /* backend still starting */
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
  return false;
}

export type Role = 'reporter' | 'staff' | 'admin';
export interface User {
  id: string;
  displayName: string;
  email: string;
  role: Role;
}

export interface Issue {
  id: string;
  code: string;
  title: string;
  description: string;
  building: string;
  room: string;
  urgency: string;
  affectedCount: number;
  hazardFlag: boolean;
  status: string;
  priority: { level: string; score: number; factors: string[]; overridden?: boolean };
  prediction?: { department: string | null; confidence: number; needsReview: boolean; reason?: string; guess?: string; topTerms?: string[]; modelVersion?: string };
  routingState: 'AUTO_ASSIGNED' | 'NEEDS_REVIEW' | 'NO_STAFF' | 'ADMIN';
  suggestedDuplicates: DuplicateSummary[];
  linkedCount: number;
  department: string | null;
  assignee: { id: string; displayName: string } | null;
  reporter?: { displayName: string };
  resolutionNote?: string;
  firstResponseAt?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  sla: { responseDeadline: string; resolutionDeadline: string; overdue: boolean; breached: 'response' | 'resolution' | null; overdueByMs: number };
  unassignedAdminReview: boolean;
  emergencyGuidance: string | null;
}

export interface DuplicateSummary {
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

export interface StaffUser {
  id?: string;
  _id: string;
  displayName: string;
  role: Role;
  department: string | null;
  active: boolean;
  activeWorkload: number;
}

export interface Activity {
  id: string;
  actor: string;
  action: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  createdAt: string;
}

export interface Analytics {
  scope: string;
  total: number;
  byStatus: Record<string, number>;
  byDepartment?: Record<string, number>;
  byPriority: Record<string, number>;
  unresolved: number;
  unassigned: number;
  awaitingConfirmation: number;
  overdue: { total: number; response: number; resolution: number };
  resolution: { count: number; averageHours: number | null; medianHours: number | null };
  workload?: { staffId: string; name: string; department: string | null; active: number }[];
  reconciliation: { total: number; statusSum: number; departmentSum?: number; prioritySum: number; ok: boolean };
  generatedAt: string;
}

export const BUILDINGS = ['Main Block', 'Science Block', 'Library', 'Computer Labs', 'Hostel A', 'Admin Office'];
