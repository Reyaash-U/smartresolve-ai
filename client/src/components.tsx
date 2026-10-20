import type { ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from './auth';
import type { Issue } from './api';

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

const STATUS_STYLE: Record<string, string> = {
  OPEN: 'border-slate-500 bg-slate-100 text-slate-900',
  ASSIGNED: 'border-blue-700 bg-blue-50 text-blue-900',
  IN_PROGRESS: 'border-amber-700 bg-amber-50 text-amber-900',
  RESOLVED: 'border-green-800 bg-green-50 text-green-900',
  CLOSED: 'border-slate-700 bg-white text-slate-800',
};

// Status and priority always carry a text label, so meaning never depends on color alone.
export const StatusBadge = ({ status }: { status: string }) => (
  <span className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[status] ?? ''}`}>{STATUS_LABEL[status] ?? status}</span>
);

export const PriorityBadge = ({ level }: { level: string }) => (
  <span className="inline-block rounded border border-slate-700 bg-white px-2 py-0.5 text-xs font-bold text-slate-900">{level}</span>
);

export function OverdueBadge({ issue }: { issue: Issue }) {
  if (!issue.sla.overdue) return null;
  const hours = Math.floor(issue.sla.overdueByMs / 3600_000);
  const what = issue.sla.breached === 'response' ? 'first response' : 'resolution';
  return (
    <span className="inline-block rounded border border-red-800 bg-red-50 px-2 py-0.5 text-xs font-bold text-red-900">
      ⚠ Overdue: {what} by {hours}h{issue.department ? ` · ${issue.department}` : ''}
    </span>
  );
}

export const Spinner = ({ label = 'Loading…' }: { label?: string }) => (
  <p role="status" className="p-4 text-slate-700">
    {label}
  </p>
);

export const ErrorBox = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div role="alert" className="rounded border border-red-800 bg-red-50 p-3 text-red-900">
    <p>{message}</p>
    {onRetry && (
      <button className="mt-2 rounded bg-red-800 px-3 py-1 text-white" onClick={onRetry}>
        Try again
      </button>
    )}
  </div>
);

export const EmptyState = ({ children }: { children: ReactNode }) => <div className="rounded border border-dashed p-6 text-center text-slate-700">{children}</div>;

export const EmergencyBanner = ({ message }: { message: string }) => (
  <div role="alert" className="rounded border-2 border-red-800 bg-red-50 p-3 font-semibold text-red-900">
    🚨 {message}
  </div>
);

export function AccessDenied() {
  return (
    <EmptyState>
      <h1 className="text-xl font-bold">Access denied</h1>
      <p>You do not have permission to view this page.</p>
      <Link className="text-blue-800 underline" to="/">
        Go to your home page
      </Link>
    </EmptyState>
  );
}

export function Layout() {
  const { user, signOut } = useAuth();
  const link = ({ isActive }: { isActive: boolean }) => `rounded px-3 py-2 ${isActive ? 'bg-blue-800 text-white' : 'text-blue-900 hover:bg-blue-50'}`;
  return (
    <>
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 p-3">
          <Link to="/" className="mr-4 text-lg font-bold text-blue-900">
            SmartResolve AI
          </Link>
          <nav aria-label="Main" className="flex flex-wrap gap-1">
            {user?.role === 'reporter' && (
              <>
                <NavLink to="/report" className={link}>
                  Report an Issue
                </NavLink>
                <NavLink to="/issues" className={link}>
                  My Issues
                </NavLink>
                <NavLink to="/analytics" className={link}>
                  My Summary
                </NavLink>
              </>
            )}
            {user?.role === 'staff' && (
              <>
                <NavLink to="/issues" className={link}>
                  Work Queue
                </NavLink>
                <NavLink to="/analytics" className={link}>
                  Analytics
                </NavLink>
              </>
            )}
            {user?.role === 'admin' && (
              <>
                <NavLink to="/issues" className={link}>
                  All Issues
                </NavLink>
                <NavLink to="/routing" className={link}>
                  Routing Queue
                </NavLink>
                <NavLink to="/analytics" className={link}>
                  Analytics
                </NavLink>
                <NavLink to="/report" className={link}>
                  Report (test)
                </NavLink>
              </>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span>
              {user?.displayName} · {user?.role}
            </span>
            <button className="rounded border px-3 py-1" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-3 sm:p-4">
        <Outlet />
      </main>
    </>
  );
}
