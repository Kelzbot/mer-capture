import { useState } from 'react';
import { Download, Timer } from 'lucide-react';
import { fmtDate } from '../lib/normalise';
import { PAIRED_DENOMINATOR, type IndicatorReport, type Period } from '../lib/indicators';
import type { ShapeReport } from '../lib/ingest';

type Props = {
  report: IndicatorReport;
  shape: ShapeReport;
  period: Period;
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

const TAT_LEGS: Array<{ key: 'transport' | 'lab' | 'return' | 'total'; label: string; target: number }> = [
  { key: 'transport', label: 'Facility to lab', target: 5 },
  { key: 'lab', label: 'Lab receipt to assay', target: 5 },
  { key: 'return', label: 'Assay to result return', target: 5 },
  { key: 'total', label: 'Total turnaround', target: 15 },
];

export default function Dashboard({ report, shape, period }: Props) {
  const [openReasons, setOpenReasons] = useState<string | null>(null);

  const exportSummary = () => {
    const rows: string[][] = [
      ['indicator', 'label', 'numerator', 'denominator', 'denominator_source', 'percentage', 'insufficient'],
      ...report.summaries.map((s) => [
        s.code,
        s.label,
        String(s.numerator),
        String(s.denominator),
        s.denominatorSource,
        s.percentage === null ? '' : s.percentage.toFixed(1),
        String(s.insufficient),
      ]),
      [],
      ['disaggregation'],
      ['indicator', 'age_band', 'male', 'female', 'unknown', 'total'],
      ...report.disaggregation.flatMap((d) =>
        d.rows.map((r) => [d.code, r.band, String(r.male), String(r.female), String(r.unknown), String(r.total)]),
      ),
    ];
    if (report.profile === 'eid') {
      rows.push([], ['turnaround_median_days'], ['leg', 'median_days', 'records']);
      for (const leg of TAT_LEGS) {
        rows.push([
          leg.label,
          report.tatMedians[leg.key] === null ? '' : String(report.tatMedians[leg.key]),
          String(report.tatCounts[leg.key]),
        ]);
      }
    }
    download(`indicator_summary_${fmtDate(period.start)}_${fmtDate(period.end)}.csv`, rows);
  };

  const maxTat = Math.max(1, ...TAT_LEGS.map((l) => report.tatMedians[l.key] ?? 0));

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded border border-slate-300 bg-white px-6 py-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-slate-500">Period</p>
          <p className="font-mono text-sm text-slate-800">
            {fmtDate(period.start)} → {fmtDate(period.end)}
          </p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-slate-500">Records analysed</p>
          <p className="font-mono text-sm text-slate-800">{report.evaluated.length}</p>
        </div>
        <div className="max-w-xl">
          <p className="font-mono text-[10px] uppercase tracking-wide text-slate-500">Row shape</p>
          <p className="text-xs text-slate-700">{shape.message}</p>
        </div>
        <button
          type="button"
          onClick={exportSummary}
          className="ml-auto flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700"
        >
          <Download size={14} />
          Indicator summary CSV
        </button>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {report.summaries.map((s) => {
          const pct = s.percentage;
          const tone =
            pct === null ? 'border-slate-300' : pct >= 80 ? 'border-teal-500' : pct >= 50 ? 'border-amber-500' : 'border-rose-500';
          return (
            <article key={s.code} className={`rounded border-l-4 ${tone} border-y border-r border-slate-300 bg-white p-4`}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-mono text-sm font-semibold text-slate-900">{s.code}</h3>
                <span className="font-mono text-lg text-slate-900">
                  {pct === null ? '—' : `${pct.toFixed(1)}%`}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-slate-600">{s.label}</p>

              <div className="mt-3 flex items-end gap-1 font-mono">
                <span className="text-2xl leading-none text-slate-900">{s.numerator}</span>
                <span className="text-sm leading-none text-slate-400">/ {s.denominator}</span>
              </div>
              <p className="mt-1 font-mono text-[10px] text-slate-500">
                denominator: {PAIRED_DENOMINATOR[s.code] ?? s.denominatorSource}
              </p>

              {s.subBreakdown.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-slate-200 pt-2 font-mono text-[10px] text-slate-600">
                  {s.subBreakdown.map((b) => (
                    <li key={b.label} className="flex justify-between gap-2">
                      <span>{b.label}</span>
                      <span className="text-slate-900">{b.count}</span>
                    </li>
                  ))}
                </ul>
              )}

              {s.insufficient > 0 && (
                <div className="mt-3 border-t border-slate-200 pt-2">
                  <button
                    type="button"
                    onClick={() => setOpenReasons(openReasons === s.code ? null : s.code)}
                    className="font-mono text-[10px] text-amber-700 hover:underline"
                  >
                    {s.insufficient} insufficient — {openReasons === s.code ? 'hide' : 'why'}
                  </button>
                  {openReasons === s.code && (
                    <ul className="mt-2 space-y-1.5">
                      {s.insufficientReasons.map((r) => (
                        <li key={r.reason} className="text-[10px] leading-4 text-slate-600">
                          <span className="font-mono text-slate-900">{r.count}×</span> {r.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </section>

      {report.profile === 'eid' && (
        <section className="rounded border border-slate-300 bg-white p-6">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Timer size={15} className="text-slate-500" />
            Turnaround time — median days per leg
          </h3>
          <div className="mt-4 space-y-3">
            {TAT_LEGS.map((leg) => {
              const value = report.tatMedians[leg.key];
              const width = value === null ? 0 : Math.max(2, (value / maxTat) * 100);
              const over = value !== null && value > leg.target;
              return (
                <div key={leg.key} className="grid grid-cols-[180px_1fr_120px] items-center gap-3">
                  <span className="text-[11px] text-slate-700">{leg.label}</span>
                  <div className="h-5 rounded-sm bg-slate-100">
                    <div
                      className={`h-5 rounded-sm ${over ? 'bg-amber-500' : 'bg-teal-600'}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  <span className="font-mono text-[11px] text-slate-700">
                    {value === null ? 'no data' : `${value} d`}
                    <span className="text-slate-400"> (n={report.tatCounts[leg.key]}, target ≤{leg.target})</span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-800">Disaggregation by age band and sex</h3>
        <div className="grid gap-4 lg:grid-cols-2">
          {report.disaggregation.map((d) => (
            <div key={d.code} className="overflow-x-auto rounded border border-slate-300 bg-white">
              <table className="w-full border-collapse text-left">
                <caption className="border-b border-slate-300 bg-slate-50 px-4 py-2 text-left font-mono text-[11px] text-slate-700">
                  {d.code}
                </caption>
                <thead>
                  <tr className="border-b border-slate-200 font-mono text-[10px] uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-1.5 font-normal">Band</th>
                    <th className="px-4 py-1.5 text-right font-normal">Male</th>
                    <th className="px-4 py-1.5 text-right font-normal">Female</th>
                    <th className="px-4 py-1.5 text-right font-normal">Unknown</th>
                    <th className="px-4 py-1.5 text-right font-normal">Total</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-[11px] text-slate-800">
                  {d.rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-3 text-slate-500">
                        No records met this indicator.
                      </td>
                    </tr>
                  ) : (
                    d.rows.map((r) => (
                      <tr key={r.band} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-1.5">{r.band}</td>
                        <td className="px-4 py-1.5 text-right">{r.male}</td>
                        <td className="px-4 py-1.5 text-right">{r.female}</td>
                        <td className="px-4 py-1.5 text-right text-slate-400">{r.unknown}</td>
                        <td className="px-4 py-1.5 text-right font-semibold">{r.total}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
