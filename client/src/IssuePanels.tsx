import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type ApiError, type Issue, type StaffUser } from './api';
import { StatusBadge } from './components';

/** Shows the model output as a suggestion and the routing outcome as a separate, confirmed fact. */
export function PredictionPanel({ issue }: { issue: Issue }) {
  const p = issue.prediction;
  const routing =
    issue.routingState === 'AUTO_ASSIGNED'
      ? 'Assigned automatically to the staff member with the fewest active cases.'
      : issue.routingState === 'ADMIN'
        ? 'Assigned by an administrator.'
        : issue.routingState === 'NO_STAFF'
          ? 'No eligible staff were available in this department.'
          : 'Waiting for an administrator to choose a department.';
  return (
    <section className="rounded border bg-white p-4" aria-labelledby="pred-h">
      <h2 id="pred-h" className="text-lg font-semibold">Department suggestion</h2>
      {p?.needsReview ? (
        <>
          <p className="mt-1 font-semibold">Needs review — not confident enough to choose a department.</p>
          {p.reason && <p className="text-sm">{p.reason}.</p>}
          {p.guess && <p className="text-sm text-slate-700">Leading guess (not confirmed): {p.guess}, {Math.round(p.confidence * 100)}% confidence.</p>}
        </>
      ) : (
        <>
          <p className="mt-1">
            Suggested: <strong>{p?.department}</strong> — subject to review
          </p>
          <p className="text-sm text-slate-700">
            Model confidence {Math.round((p?.confidence ?? 0) * 100)}% (a relative signal, not a guarantee).
            {p?.topTerms?.length ? ` Key terms: ${p.topTerms.join(', ')}.` : ''}
          </p>
        </>
      )}
      <p className="mt-2 border-t pt-2">
        <span className="font-semibold">Confirmed routing: </span>
        {issue.department ?? 'None yet'}
        {issue.assignee ? ` · Owner: ${issue.assignee.displayName}` : ' · Unassigned — Admin Review'}
      </p>
      <p className="text-sm text-slate-700">{routing}</p>
    </section>
  );
}

export function DuplicatesPanel({ issue, isAdmin, onChanged }: { issue: Issue; isAdmin: boolean; onChanged?: () => void }) {
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');
  const dups = issue.suggestedDuplicates;
  if (!dups.length && !issue.linkedCount) return null;

  async function link(otherId: string) {
    setMsg('');
    try {
      await api(`/issues/${issue.id}/links`, { method: 'POST', body: { otherId, reason: reason || undefined } });
      setMsg('Linked. Both records are kept.');
      onChanged?.();
    } catch (e) {
      setMsg((e as ApiError).message);
    }
  }

  return (
    <section className="rounded border border-amber-700 bg-amber-50 p-4" aria-labelledby="dup-h">
      <h2 id="dup-h" className="text-lg font-semibold">Possible existing issue</h2>
      {issue.linkedCount > 0 && <p className="text-sm">Linked to {issue.linkedCount} other report(s) by an administrator.</p>}
      {dups.length > 0 && <p className="text-sm">These open reports look similar. This is only a suggestion — your report was still saved on its own.</p>}
      <ul className="mt-2 space-y-2">
        {dups.map((d) => (
          <li key={d.id} className="rounded border bg-white p-2 text-sm">
            <div className="font-semibold">{d.code} — {d.title}</div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={d.status} />
              <span>{d.building}, {d.room}</span>
              {d.department && <span>{d.department}</span>}
              <span>Match {Math.round(d.score * 100)}%</span>
            </div>
            <ul className="list-disc pl-5 text-slate-700">{d.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            {isAdmin && (
              <button className="mt-1 rounded border border-blue-800 px-2 py-1 text-blue-900" onClick={() => link(d.id)}>
                Link these two reports
              </button>
            )}
          </li>
        ))}
      </ul>
      {isAdmin && dups.length > 0 && (
        <label className="mt-2 block text-sm">Reason for linking (optional)
          <input className="mt-1 w-full rounded border border-slate-500 p-2" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </label>
      )}
      {msg && <p role="status" className="mt-1 text-sm">{msg}</p>}
    </section>
  );
}

function useForm(run: () => Promise<void>, onDone?: () => void) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await run();
      setMsg({ ok: true, text: 'Saved.' });
      onDone?.();
    } catch (err) {
      const a = err as ApiError;
      setMsg({ ok: false, text: a.details?.[0]?.message ?? a.message });
    } finally {
      setBusy(false);
    }
  }
  return { busy, msg, submit };
}

const inp = 'mt-1 w-full rounded border border-slate-500 p-2';
const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) => (m ? <p role={m.ok ? 'status' : 'alert'} className={`text-sm ${m.ok ? 'text-green-900' : 'text-red-900'}`}>{m.text}</p> : null);

export function AssignForm({ issue, onDone }: { issue: Issue; onDone: () => void }) {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [assigneeId, setAssigneeId] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    api<{ users: StaffUser[] }>('/admin/users').then((r) => setStaff(r.users.filter((u) => u.role === 'staff' && u.active))).catch(() => undefined);
  }, []);
  const needsReason = !!issue.assignee || !!issue.department;
  const { busy, msg, submit } = useForm(
    async () => {
      await api(`/issues/${issue.id}/assignment`, { method: 'PATCH', body: { assigneeId, reason: reason || undefined } });
      setReason('');
    },
    onDone,
  );
  return (
    <form onSubmit={submit} className="space-y-2" aria-label="Assign or reassign">
      <h3 className="font-semibold">{issue.assignee ? 'Reassign' : 'Assign'} to staff</h3>
      <label className="block text-sm">Staff member
        <select className={inp} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} required>
          <option value="">Choose…</option>
          {staff.map((s) => <option key={s._id} value={s._id}>{s.displayName} — {s.department} ({s.activeWorkload} active)</option>)}
        </select>
      </label>
      <label className="block text-sm">Reason{needsReason ? ' (required)' : ' (optional)'}
        <input className={inp} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      </label>
      <button disabled={busy || !assigneeId} className="rounded bg-blue-800 px-3 py-2 text-white disabled:opacity-60">{busy ? 'Saving…' : 'Save assignment'}</button>
      <Msg m={msg} />
    </form>
  );
}

export function PriorityForm({ issue, mode, onDone }: { issue: Issue; mode: 'override' | 'suggest'; onDone: () => void }) {
  const [level, setLevel] = useState(issue.priority.level);
  const [reason, setReason] = useState('');
  const { busy, msg, submit } = useForm(async () => {
    await api(`/issues/${issue.id}/priority`, { method: 'PATCH', body: { level, reason } });
    setReason('');
  }, onDone);
  return (
    <form onSubmit={submit} className="space-y-2" aria-label={mode === 'override' ? 'Override priority' : 'Suggest priority'}>
      <h3 className="font-semibold">{mode === 'override' ? 'Override priority' : 'Suggest a different priority'}</h3>
      <label className="block text-sm">Priority
        <select className={inp} value={level} onChange={(e) => setLevel(e.target.value)}>
          {['P1', 'P2', 'P3', 'P4'].map((p) => <option key={p}>{p}</option>)}
        </select>
      </label>
      <label className="block text-sm">Reason (required)
        <input className={inp} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required />
      </label>
      <button disabled={busy} className="rounded border border-blue-800 px-3 py-2 text-blue-900 disabled:opacity-60">{busy ? 'Saving…' : mode === 'override' ? 'Apply override' : 'Send suggestion'}</button>
      {mode === 'suggest' && <p className="text-xs text-slate-700">Staff can only suggest; an administrator decides.</p>}
      <Msg m={msg} />
    </form>
  );
}

export function RoutingLink({ issue }: { issue: Issue }) {
  return (
    <div className="rounded border bg-white p-3">
      <Link to={`/issues/${issue.id}`} className="font-semibold text-blue-900 underline">{issue.code} — {issue.title}</Link>
      <p className="text-sm">{issue.building}, {issue.room} · Priority {issue.priority.level}</p>
      <p className="text-sm text-slate-700">
        {issue.prediction?.needsReview
          ? `Needs review: ${issue.prediction.reason ?? 'low confidence'}${issue.prediction.guess ? ` (leading guess ${issue.prediction.guess}, not confirmed)` : ''}`
          : issue.department
            ? `Suggested ${issue.department}, but no eligible staff were available.`
            : 'Not yet routed.'}
      </p>
    </div>
  );
}
