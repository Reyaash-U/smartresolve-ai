import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, type Analytics as Data, type ApiError } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Spinner } from '../components';

const STATUS_LABEL: Record<string, string> = { OPEN: 'Open', ASSIGNED: 'Assigned', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', CLOSED: 'Closed' };

const Tile = ({ label, value, note }: { label: string; value: ReactNode; note?: string }) => (
  <div className="rounded border bg-white p-3">
    <div className="text-sm text-slate-700">{label}</div>
    <div className="text-2xl font-bold">{value}</div>
    {note && <div className="text-xs text-slate-600">{note}</div>}
  </div>
);

function CountTable({ title, rows, total }: { title: string; rows: [string, number][]; total: number }) {
  return (
    <table className="w-full rounded border bg-white text-left text-sm">
      <caption className="p-2 text-left text-base font-semibold">{title}</caption>
      <thead>
        <tr className="border-b bg-slate-50">
          <th scope="col" className="p-2">Category</th>
          <th scope="col" className="p-2 text-right">Count</th>
          <th scope="col" className="p-2 text-right">Share</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b last:border-0">
            <th scope="row" className="p-2 font-normal">{k}</th>
            <td className="p-2 text-right">{v}</td>
            <td className="p-2 text-right">{total ? `${Math.round((v / total) * 100)}%` : '—'}</td>
          </tr>
        ))}
        <tr className="bg-slate-50 font-semibold">
          <th scope="row" className="p-2">Total</th>
          <td className="p-2 text-right">{rows.reduce((s, [, v]) => s + v, 0)}</td>
          <td className="p-2" />
        </tr>
      </tbody>
    </table>
  );
}

const hrs = (n: number | null) => (n === null ? '—' : `${n} h`);

export default function Analytics() {
  const { user } = useAuth();
  const [dept, setDept] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    api<Data>(`/analytics${dept ? `?department=${encodeURIComponent(dept)}` : ''}`)
      .then(setData)
      .catch((e: ApiError) => setError(e.message));
  }, [dept]);
  useEffect(load, [load]);

  const title = user?.role === 'reporter' ? 'My Issue Summary' : 'Analytics';
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        {user?.role === 'admin' && (
          <label className="text-sm">Department
            <select className="ml-1 rounded border border-slate-500 p-2" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All departments</option>
              {['IT Support', 'Facilities', 'Administration', 'Unrouted'].map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
        )}
        <button className="rounded border px-3 py-2 text-sm" onClick={load}>Refresh</button>
      </div>

      {error && <ErrorBox message={error} onRetry={load} />}
      {!error && !data && <Spinner label="Loading analytics…" />}
      {data && (
        <>
          <p className="text-sm text-slate-700">Scope: <strong>{data.scope}</strong> · Live from stored records, updated {new Date(data.generatedAt).toLocaleTimeString()}</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Tile label="Total issues" value={data.total} />
            <Tile label="Unresolved" value={data.unresolved} note="Open, assigned or in progress" />
            <Tile label="Overdue" value={data.overdue.total} note={`${data.overdue.response} response · ${data.overdue.resolution} resolution`} />
            <Tile label="Awaiting confirmation" value={data.awaitingConfirmation} note="Resolved, not yet closed" />
            {user?.role !== 'reporter' && <Tile label="Unassigned" value={data.unassigned} note="Admin routing queue" />}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <CountTable title="By status" total={data.total} rows={Object.entries(data.byStatus).map(([k, v]) => [STATUS_LABEL[k] ?? k, v])} />
            <CountTable title="By priority" total={data.total} rows={Object.entries(data.byPriority)} />
            {data.byDepartment && <CountTable title="By department" total={data.total} rows={Object.entries(data.byDepartment)} />}
          </div>

          <div className="rounded border bg-white p-3">
            <h2 className="text-base font-semibold">Resolution time</h2>
            <p className="text-sm">
              Average {hrs(data.resolution.averageHours)} · Median {hrs(data.resolution.medianHours)} · over {data.resolution.count} resolved issue(s), measured from creation to resolution.
            </p>
          </div>

          {data.workload && (
            <table className="w-full rounded border bg-white text-left text-sm">
              <caption className="p-2 text-left text-base font-semibold">Staff workload (assigned + in progress)</caption>
              <thead>
                <tr className="border-b bg-slate-50">
                  <th scope="col" className="p-2">Staff</th>
                  <th scope="col" className="p-2">Department</th>
                  <th scope="col" className="p-2 text-right">Active cases</th>
                </tr>
              </thead>
              <tbody>
                {data.workload.map((w) => (
                  <tr key={w.staffId} className="border-b last:border-0">
                    <th scope="row" className="p-2 font-normal">{w.name}</th>
                    <td className="p-2">{w.department}</td>
                    <td className="p-2 text-right">{w.active}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p role="status" className="text-sm">
            {data.reconciliation.ok ? '✔ Totals reconcile' : '✖ Totals do not reconcile'}: {data.total} issues = {data.reconciliation.statusSum} by status = {data.reconciliation.prioritySum} by priority
            {data.reconciliation.departmentSum !== undefined ? ` = ${data.reconciliation.departmentSum} by department` : ''}.
          </p>
        </>
      )}
    </section>
  );
}
