import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ApiError, type Issue } from '../api';
import { useAuth } from '../auth';
import { EmptyState, ErrorBox, OverdueBadge, PriorityBadge, Spinner, StatusBadge } from '../components';

const STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const DEPARTMENTS = ['IT Support', 'Facilities', 'Administration'];

export default function IssueList() {
  const { user } = useAuth();
  const [filters, setFilters] = useState({ status: '', department: '', priority: '', overdue: '' });
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    setIssues(null);
    setError('');
    api<{ issues: Issue[] }>(`/issues?${qs}`)
      .then((r) => setIssues(r.issues))
      .catch((e: ApiError) => setError(e.message));
  }, [filters]);

  useEffect(load, [load]);

  const title = user?.role === 'staff' ? 'Staff Work Queue' : user?.role === 'admin' ? 'All Issues' : 'My Issues';
  const sel = 'rounded border border-slate-500 p-2';
  const set = (k: string) => (e: React.ChangeEvent<HTMLSelectElement>) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <section>
      <h1 className="mb-3 text-2xl font-bold">{title}</h1>
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filters">
        <label className="text-sm">Status
          <select className={`${sel} ml-1`} value={filters.status} onChange={set('status')}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </label>
        {user?.role === 'admin' && (
          <label className="text-sm">Department
            <select className={`${sel} ml-1`} value={filters.department} onChange={set('department')}>
              <option value="">All</option>
              {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
        )}
        <label className="text-sm">Priority
          <select className={`${sel} ml-1`} value={filters.priority} onChange={set('priority')}>
            <option value="">All</option>
            {['P1', 'P2', 'P3', 'P4'].map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label className="text-sm">Overdue
          <select className={`${sel} ml-1`} value={filters.overdue} onChange={set('overdue')}>
            <option value="">Any</option>
            <option value="true">Overdue only</option>
            <option value="false">Not overdue</option>
          </select>
        </label>
      </div>

      {error && <ErrorBox message={error} onRetry={load} />}
      {!error && issues === null && <Spinner label="Loading issues…" />}
      {issues?.length === 0 && (
        <EmptyState>
          No issues match.{' '}
          {user?.role === 'reporter' && <Link className="text-blue-800 underline" to="/report">Report an issue</Link>}
        </EmptyState>
      )}
      <ul className="space-y-2">
        {issues?.map((i) => (
          <li key={i.id} className="rounded border bg-white p-3">
            <Link to={`/issues/${i.id}`} className="font-semibold text-blue-900 underline">
              {i.code} — {i.title}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge status={i.status} />
              <PriorityBadge level={i.priority.level} />
              <OverdueBadge issue={i} />
              <span>{i.building}, {i.room}</span>
              {i.unassignedAdminReview ? <span>Unassigned — Admin Review</span> : i.assignee && <span>Owner: {i.assignee.displayName}</span>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
