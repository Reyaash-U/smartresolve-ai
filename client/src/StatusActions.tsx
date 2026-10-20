import { useState, type FormEvent } from 'react';
import { api, type ApiError, type Issue, type Role } from './api';

type Action = { key: string; label: string; to: string; needs?: 'note' | 'reason' | null; hint?: string };

/**
 * Which buttons to offer. This only shapes the UI: the API re-checks every transition, role,
 * ownership and required note/reason, so bypassing the UI gets a 4xx.
 */
function actionsFor(issue: Issue, role: Role): Action[] {
  const s = issue.status;
  const out: Action[] = [];
  const worker = role === 'staff' || role === 'admin';
  if (worker && s === 'ASSIGNED') out.push({ key: 'start', label: 'Start work (In progress)', to: 'IN_PROGRESS' });
  if (worker && s === 'IN_PROGRESS') out.push({ key: 'resolve', label: 'Mark resolved', to: 'RESOLVED', needs: 'note' });
  if (s === 'RESOLVED' && role === 'reporter') {
    out.push({ key: 'close', label: 'Confirm resolved and close', to: 'CLOSED' });
    out.push({ key: 'reopen', label: 'Not fixed — reopen', to: 'IN_PROGRESS', needs: 'reason' });
  }
  if (s === 'RESOLVED' && role === 'admin') {
    out.push({ key: 'close', label: 'Close (admin, reason required)', to: 'CLOSED', needs: 'reason' });
    out.push({ key: 'reopen', label: 'Reopen', to: 'IN_PROGRESS', needs: 'reason' });
  }
  if (role === 'admin' && (s === 'OPEN' || s === 'ASSIGNED' || s === 'IN_PROGRESS')) {
    out.push({ key: 'xclose', label: 'Exceptional closure', to: 'CLOSED', needs: 'reason', hint: 'Closes without resolution. Recorded in the history.' });
  }
  return out;
}

export function StatusActions({ issue, role, onDone }: { issue: Issue; role: Role; onDone: () => void }) {
  const actions = actionsFor(issue, role);
  const [open, setOpen] = useState<Action | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(a: Action, e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, string> = { status: a.to };
      if (a.needs === 'note') body.note = text;
      if (a.needs === 'reason') body.reason = text;
      await api(`/issues/${issue.id}/status`, { method: 'PATCH', body });
      setOpen(null);
      setText('');
      onDone();
    } catch (err) {
      const x = err as ApiError;
      setMsg({ ok: false, text: x.details?.[0]?.message ?? x.message });
    } finally {
      setBusy(false);
    }
  }

  async function post(path: string, body?: object) {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/issues/${issue.id}/${path}`, { method: 'POST', body });
      setText('');
      onDone();
    } catch (err) {
      setMsg({ ok: false, text: (err as ApiError).message });
    } finally {
      setBusy(false);
    }
  }

  const unresolved = ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(issue.status);
  const canAck = role === 'staff' && unresolved && !issue.firstResponseAt;
  const canNote = role === 'staff' && unresolved;
  if (!actions.length && !canAck && !canNote) return null;

  const need = open?.needs === 'note' ? 15 : 5;
  return (
    <section className="space-y-3 rounded border bg-white p-4" aria-labelledby="actions-h">
      <h2 id="actions-h" className="text-lg font-semibold">Actions</h2>
      {issue.status === 'RESOLVED' && role === 'reporter' && <p>This issue was marked resolved. Please confirm it is fixed, or reopen it with a reason.</p>}

      <div className="flex flex-wrap gap-2">
        {canAck && (
          <button disabled={busy} onClick={() => post('acknowledge')} className="rounded border border-blue-800 px-3 py-2 text-blue-900 disabled:opacity-60">
            Acknowledge
          </button>
        )}
        {actions.map((a) => (
          <button
            key={a.key}
            disabled={busy}
            className="rounded bg-blue-800 px-3 py-2 text-white disabled:opacity-60"
            onClick={() => {
              setMsg(null);
              setText('');
              if (a.needs) setOpen(a);
              else void run(a);
            }}
          >
            {a.label}
          </button>
        ))}
      </div>

      {open && (
        <form onSubmit={(e) => run(open, e)} className="space-y-2" aria-label={open.label}>
          <label className="block text-sm">
            {open.needs === 'note' ? 'Resolution note (at least 15 characters)' : 'Reason (at least 5 characters)'}
            <textarea className="mt-1 w-full rounded border border-slate-500 p-2" rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={open.needs === 'note' ? 1000 : 300} autoFocus />
          </label>
          {open.hint && <p className="text-sm text-slate-700">{open.hint}</p>}
          <p className="text-xs text-slate-600">{text.trim().length}/{need} minimum characters</p>
          <div className="flex gap-2">
            <button disabled={busy || text.trim().length < need} className="rounded bg-blue-800 px-3 py-2 text-white disabled:opacity-60">{busy ? 'Saving…' : `Confirm: ${open.label}`}</button>
            <button type="button" className="rounded border px-3 py-2" onClick={() => setOpen(null)}>Cancel</button>
          </div>
        </form>
      )}

      {canNote && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void post('notes', { note: text });
          }}
          className="space-y-2 border-t pt-3"
          aria-label="Add progress note"
        >
          {!open && (
            <>
              <label className="block text-sm">Add a progress note
                <input className="mt-1 w-full rounded border border-slate-500 p-2" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
              </label>
              <button disabled={busy || text.trim().length < 3} className="rounded border border-blue-800 px-3 py-2 text-blue-900 disabled:opacity-60">Add note</button>
            </>
          )}
        </form>
      )}
      {msg && <p role="alert" className="text-sm text-red-900">{msg.text}</p>}
    </section>
  );
}
