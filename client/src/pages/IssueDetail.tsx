import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Activity, type ApiError, type Issue } from '../api';
import { useAuth } from '../auth';
import { AssignForm, DuplicatesPanel, PredictionPanel, PriorityForm } from '../IssuePanels';
import { StatusActions } from '../StatusActions';
import { EmergencyBanner, ErrorBox, OverdueBadge, PriorityBadge, Spinner, StatusBadge } from '../components';

/** One-line plain-language summary of what an activity entry changed. */
function Detail({ a }: { a: Activity }) {
  const before = (a.before ?? {}) as Record<string, string | null | undefined>;
  const after = (a.after ?? {}) as Record<string, string | number | boolean | null | undefined>;
  let text = '';
  if (a.action === 'NOTE_ADDED') text = `Note: ${after.note}`;
  else if (after.resolutionNote) text = `Resolution note: ${after.resolutionNote}`;
  else if (before.status && after.status && before.status !== after.status) text = `${before.status} → ${after.status}`;
  else if (a.action === 'PRIORITY_OVERRIDDEN' || a.action === 'PRIORITY_SUGGESTED') text = `${before.level} → ${after.level}`;
  else if (a.action === 'AUTO_ASSIGNED' || a.action === 'ASSIGNED' || a.action === 'REASSIGNED') text = `Owner: ${after.assignee}${after.department ? ` (${after.department})` : ''}`;
  else if (a.action === 'CATEGORY_PREDICTED') text = after.needsReview ? 'Needs review (low confidence)' : `Suggested ${after.department} — ${Math.round(Number(after.confidence) * 100)}% confidence`;
  else if (a.action === 'PRIORITY_RECOMMENDED') text = `Suggested ${after.level} (score ${after.score})`;
  return text ? <div className="text-slate-700">{text}</div> : null;
}

export default function IssueDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api<{ issue: Issue }>(`/issues/${id}`), api<{ activity: Activity[] }>(`/issues/${id}/activity`)])
      .then(([a, b]) => {
        setIssue(a.issue);
        setActivity(b.activity);
      })
      .catch((e: ApiError) => setError(e));
  }, [id]);

  useEffect(load, [load]);

  if (error?.status === 404) {
    return (
      <div className="rounded border border-dashed p-6 text-center">
        <h1 className="text-xl font-bold">Issue not found</h1>
        <p>It may not exist, or you may not have access to it.</p>
        <Link className="text-blue-800 underline" to="/issues">Back to issues</Link>
      </div>
    );
  }
  if (error) return <ErrorBox message={error.message} onRetry={load} />;
  if (!issue) return <Spinner label="Loading issue…" />;

  return (
    <article className="space-y-4">
      <Link className="text-blue-800 underline" to="/issues">← Back to issues</Link>
      <header>
        <h1 className="text-2xl font-bold">{issue.code} — {issue.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={issue.status} />
          <PriorityBadge level={issue.priority.level} />
          <OverdueBadge issue={issue} />
        </div>
      </header>
      {issue.emergencyGuidance && <EmergencyBanner message={issue.emergencyGuidance} />}

      <section className="rounded border bg-white p-4">
        <p className="whitespace-pre-wrap">{issue.description}</p>
        <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
          <div><dt className="inline font-semibold">Location: </dt><dd className="inline">{issue.building}, {issue.room}</dd></div>
          <div><dt className="inline font-semibold">Urgency: </dt><dd className="inline">{issue.urgency}</dd></div>
          <div><dt className="inline font-semibold">People affected: </dt><dd className="inline">{issue.affectedCount}</dd></div>
          <div><dt className="inline font-semibold">Reported: </dt><dd className="inline">{new Date(issue.createdAt).toLocaleString()}</dd></div>
          {issue.reporter && <div><dt className="inline font-semibold">Reporter: </dt><dd className="inline">{issue.reporter.displayName}</dd></div>}
          <div><dt className="inline font-semibold">Department: </dt><dd className="inline">{issue.department ?? 'Not yet routed'}</dd></div>
          <div><dt className="inline font-semibold">Owner: </dt><dd className="inline">{issue.assignee?.displayName ?? (issue.unassignedAdminReview ? 'Unassigned — Admin Review' : 'Unassigned')}</dd></div>
          <div><dt className="inline font-semibold">Response due: </dt><dd className="inline">{new Date(issue.sla.responseDeadline).toLocaleString()}</dd></div>
          <div><dt className="inline font-semibold">Resolution due: </dt><dd className="inline">{new Date(issue.sla.resolutionDeadline).toLocaleString()}</dd></div>
        </dl>
      </section>

      {issue.resolutionNote && (
        <section className="rounded border border-green-800 bg-green-50 p-4" aria-labelledby="res-h">
          <h2 id="res-h" className="text-lg font-semibold">Resolution note</h2>
          <p className="whitespace-pre-wrap">{issue.resolutionNote}</p>
          {issue.resolvedAt && <p className="text-sm text-slate-700">Resolved {new Date(issue.resolvedAt).toLocaleString()}</p>}
        </section>
      )}
      {user && <StatusActions issue={issue} role={user.role} onDone={load} />}

      <PredictionPanel issue={issue} />
      <DuplicatesPanel issue={issue} isAdmin={user?.role === 'admin'} onChanged={load} />

      <section className="rounded border bg-white p-4">
        <h2 className="text-lg font-semibold">
          {issue.priority.overridden ? 'Priority (set by administrator)' : 'Suggested priority'}: {issue.priority.level} (score {issue.priority.score}) — subject to review
        </h2>
        <ul className="list-disc pl-5">{issue.priority.factors.map((f) => <li key={f}>{f}</li>)}</ul>
      </section>

      {user?.role === 'admin' && issue.status !== 'RESOLVED' && issue.status !== 'CLOSED' && (
        <section className="grid gap-4 rounded border bg-white p-4 md:grid-cols-2" aria-label="Administrator actions">
          <AssignForm issue={issue} onDone={load} />
          <PriorityForm issue={issue} mode="override" onDone={load} />
        </section>
      )}
      {user?.role === 'staff' && issue.status !== 'CLOSED' && (
        <section className="rounded border bg-white p-4" aria-label="Staff actions">
          <PriorityForm issue={issue} mode="suggest" onDone={load} />
        </section>
      )}

      <section className="rounded border bg-white p-4">
        <h2 className="text-lg font-semibold">History</h2>
        <ol className="mt-2 space-y-2">
          {activity.map((a) => (
            <li key={a.id} className="border-l-4 border-slate-400 pl-3 text-sm">
              <strong>{a.action.replace(/_/g, ' ')}</strong> by {a.actor} · {new Date(a.createdAt).toLocaleString()}
              {a.reason && <div>Reason: {a.reason}</div>}
              <Detail a={a} />
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
