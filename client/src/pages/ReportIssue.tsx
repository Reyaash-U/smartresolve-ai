import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, BUILDINGS, type ApiError, type FieldError, type Issue } from '../api';
import { EmergencyBanner, PriorityBadge, StatusBadge } from '../components';
import { DuplicatesPanel, PredictionPanel } from '../IssuePanels';

const EMERGENCY = /\b(fire|smoke|burning|injur(?:y|ed)|bleeding|unconscious|electric shock|live wire|exposed wire|gas leak|explosion|collapse|trapped)\b/i;
const EMERGENCY_TEXT = "If anyone is in danger, contact the institution's emergency personnel immediately. SmartResolve is a tracking tool, not an emergency dispatch service.";

export default function ReportIssue() {
  const [hazard, setHazard] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<FieldError[]>([]);
  const [created, setCreated] = useState<Issue | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    setFields([]);
    try {
      const r = await api<{ issue: Issue }>('/issues', {
        method: 'POST',
        body: {
          title: String(f.get('title')),
          description: String(f.get('description')),
          building: String(f.get('building')),
          room: String(f.get('room')),
          urgency: String(f.get('urgency')),
          affectedCount: Number(f.get('affectedCount')),
          hazardFlag: hazard,
        },
      });
      setCreated(r.issue);
    } catch (err) {
      const e2 = err as ApiError;
      setError(e2.message);
      setFields(e2.details ?? []);
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <section aria-live="polite" className="space-y-3">
        <h1 className="text-2xl font-bold">Report submitted</h1>
        <div className="rounded border border-green-800 bg-green-50 p-4 text-green-900">
          Your report was saved as <strong>{created.code}</strong>.
        </div>
        {created.emergencyGuidance && <EmergencyBanner message={created.emergencyGuidance} />}
        <div className="rounded border bg-white p-4">
          <p>
            Status: <StatusBadge status={created.status} /> · Suggested priority: <PriorityBadge level={created.priority.level} /> (score {created.priority.score})
          </p>
          <p className="mt-2 font-semibold">Why this priority?</p>
          <ul className="list-disc pl-5">{created.priority.factors.map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="mt-2 text-sm text-slate-700">Priority and department are suggestions and remain subject to review.</p>
        </div>
        <PredictionPanel issue={created} />
        <DuplicatesPanel issue={created} isAdmin={false} />
        <Link className="text-blue-800 underline" to={`/issues/${created.id}`}>View issue details</Link>
        {' · '}
        <button className="text-blue-800 underline" onClick={() => setCreated(null)}>Report another issue</button>
      </section>
    );
  }

  const err = (n: string) => fields.find((x) => x.field === n)?.message;
  const input = 'mt-1 w-full rounded border border-slate-500 p-2';
  const showEmergency = hazard || EMERGENCY.test(text);
  const Err = ({ n }: { n: string }) => <p id={`${n}-err`} className="text-sm text-red-800">{err(n)}</p>;

  return (
    <section>
      <h1 className="mb-3 text-2xl font-bold">Report an Issue</h1>
      <form onSubmit={submit} noValidate className="max-w-2xl space-y-3 rounded border bg-white p-4">
        {error && <div role="alert" className="rounded border border-red-800 bg-red-50 p-3 text-red-900">{error}</div>}
        {showEmergency && <EmergencyBanner message={EMERGENCY_TEXT} />}
        <div>
          <label htmlFor="title">Title (5–120 characters)</label>
          <input id="title" name="title" className={input} maxLength={120} aria-describedby="title-err" />
          <Err n="title" />
        </div>
        <div>
          <label htmlFor="description">Description (20–1,000 characters)</label>
          <textarea id="description" name="description" rows={5} className={input} maxLength={1000} onChange={(e) => setText(e.target.value)} aria-describedby="description-err" />
          <Err n="description" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="building">Campus building</label>
            <select id="building" name="building" className={input} defaultValue="" aria-describedby="building-err">
              <option value="" disabled>Select a building</option>
              {BUILDINGS.map((b) => <option key={b}>{b}</option>)}
            </select>
            <Err n="building" />
          </div>
          <div>
            <label htmlFor="room">Room / location</label>
            <input id="room" name="room" className={input} maxLength={80} aria-describedby="room-err" />
            <Err n="room" />
          </div>
          <div>
            <label htmlFor="urgency">Urgency</label>
            <select id="urgency" name="urgency" className={input} defaultValue="MEDIUM">
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
            <Err n="urgency" />
          </div>
          <div>
            <label htmlFor="affectedCount">Estimated people affected (1–500)</label>
            <input id="affectedCount" name="affectedCount" type="number" min={1} max={500} defaultValue={1} className={input} aria-describedby="affectedCount-err" />
            <Err n="affectedCount" />
          </div>
        </div>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={hazard} onChange={(e) => setHazard(e.target.checked)} />
          <span>This is a safety hazard (risk of injury or danger)</span>
        </label>
        <button disabled={busy} className="rounded bg-blue-800 px-4 py-2 font-semibold text-white disabled:opacity-60">
          {busy ? 'Submitting…' : 'Submit report'}
        </button>
      </form>
    </section>
  );
}
