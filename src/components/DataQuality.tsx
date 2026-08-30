import { useMemo, useState } from 'react';
import { Download, ShieldAlert, TriangleAlert } from 'lucide-react';
import type { DQFlag, FacilityScore } from '../lib/dq';

type Props = {
  flags: DQFlag[];
  scores: FacilityScore[];
  sourceRows: number;
  profile: string;
};

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(name: string, rows: string[][]) {
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DataQuality({ flags, scores, sourceRows, profile }: Props) {
  const [facility, setFacility] = useState('all');

  const facilities = useMemo(
    () => Array.from(new Set(flags.map((f) => f.facility))).sort(),
    [flags],
  );

  const visible = useMemo(
    () => (facility === 'all' ? flags : flags.filter((f) => f.facility === facility)),
    [flags, facility],
  );

  const critical = visible.filter((f) => f.severity === 'critical');
  const warnings = visible.filter((f) => f.severity === 'warning');

  const exportFindings = () =>
    download(`dq_findings_${profile}.csv`, [
      ['severity', 'patient_id', 'facility', 'rule', 'message'],
      ...visible.map((f) => [f.severity, f.patient_id, f.facility, f.rule, f.message]),
    ]);

  const groups: Array<{ severity: 'critical' | 'warning'; items: DQFlag[] }> = [
    { severity: 'critical', items: critical },
    { severity: 'warning', items: warnings },
  ];

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded border border-slate-300 bg-white px-6 py-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-slate-500">Source rows audited</p>
          <p className="font-mono text-sm text-slate-800">{sourceRows}</p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-slate-500">Critical</p>
          <p className="font-mono text-sm text-rose-700">{critical.length}</p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-slate-500">Warning</p>
          <p className="font-mono text-sm text-amber-700">{warnings.length}</p>
        </div>
        <label className="flex items-center gap-2 font-mono text-[11px] text-slate-600">
          FACILITY
          <select
            value={facility}
            onChange={(e) => setFacility(e.target.value)}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-800"
          >
            <option value="all">All facilities</option>
            {facilities.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={exportFindings}
          className="ml-auto flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700"
        >
          <Download size={14} />
          DQ findings CSV
        </button>
      </section>

      <section className="overflow-x-auto rounded border border-slate-300 bg-white">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-300 bg-slate-50 font-mono text-[10px] uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2 font-normal">Facility</th>
              <th className="px-4 py-2 text-right font-normal">Records</th>
              <th className="px-4 py-2 text-right font-normal">Clean</th>
              <th className="px-4 py-2 text-right font-normal">Critical</th>
              <th className="px-4 py-2 text-right font-normal">Warning</th>
              <th className="px-4 py-2 font-normal">Score</th>
            </tr>
          </thead>
          <tbody className="font-mono text-[11px] text-slate-800">
            {scores.map((s) => (
              <tr key={s.facility} className="border-b border-slate-200 last:border-0">
                <td className="px-4 py-2 font-sans text-xs">{s.facility}</td>
                <td className="px-4 py-2 text-right">{s.records}</td>
                <td className="px-4 py-2 text-right">{s.clean}</td>
                <td className="px-4 py-2 text-right text-rose-700">{s.critical}</td>
                <td className="px-4 py-2 text-right text-amber-700">{s.warning}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-32 rounded-sm bg-slate-100">
                      <div
                        className={`h-3 rounded-sm ${s.score >= 90 ? 'bg-teal-600' : s.score >= 70 ? 'bg-amber-500' : 'bg-rose-500'}`}
                        style={{ width: `${Math.max(2, s.score)}%` }}
                      />
                    </div>
                    <span>{s.score.toFixed(0)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {groups.map((g) => (
        <section key={g.severity} className="rounded border border-slate-300 bg-white">
          <h3
            className={`flex items-center gap-2 border-b px-6 py-3 text-sm font-semibold ${
              g.severity === 'critical'
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}
          >
            {g.severity === 'critical' ? <ShieldAlert size={15} /> : <TriangleAlert size={15} />}
            {g.severity === 'critical' ? 'Critical' : 'Warning'}
            <span className="font-mono text-[11px] font-normal">{g.items.length}</span>
          </h3>
          {g.items.length === 0 ? (
            <p className="px-6 py-4 font-mono text-[11px] text-slate-500">No findings.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {g.items.map((f, i) => (
                <li key={`${f.patient_id}-${f.rule}-${i}`} className="grid gap-1 px-6 py-2.5 sm:grid-cols-[180px_180px_1fr]">
                  <span className="font-mono text-[11px] text-slate-900">{f.patient_id}</span>
                  <span className="font-mono text-[10px] text-slate-500">{f.rule}</span>
                  <span className="text-[11px] leading-4 text-slate-700">{f.message}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
