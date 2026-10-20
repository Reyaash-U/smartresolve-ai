import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError, type Issue } from '../api';
import { EmptyState, ErrorBox, Spinner } from '../components';
import { AssignForm, RoutingLink } from '../IssuePanels';

/** Admin routing queue: unassigned OPEN issues (low-confidence predictions or no available staff). */
export default function RoutingQueue() {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    api<{ issues: Issue[] }>('/issues?unassigned=true')
      .then((r) => setIssues(r.issues))
      .catch((e: ApiError) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  return (
    <section>
      <h1 className="mb-1 text-2xl font-bold">Admin Routing Queue</h1>
      <p className="mb-3 text-slate-700">Reports the system could not route with confidence, or that have no available staff.</p>
      {error && <ErrorBox message={error} onRetry={load} />}
      {!error && issues === null && <Spinner label="Loading routing queue…" />}
      {issues?.length === 0 && <EmptyState>The routing queue is empty. Nothing needs manual routing.</EmptyState>}
      <div className="space-y-3">
        {issues?.map((i) => (
          <div key={i.id} className="grid gap-3 md:grid-cols-2">
            <RoutingLink issue={i} />
            <div className="rounded border bg-white p-3"><AssignForm issue={i} onDone={load} /></div>
          </div>
        ))}
      </div>
    </section>
  );
}
