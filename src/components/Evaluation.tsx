import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import {
  evaluateExtraction,
  type EvaluationReport,
  type ExtractedRecord,
  type ReferenceRow,
} from '../lib/evaluate';

type Props = {
  extracted: ExtractedRecord[];
  referenceRows: ReferenceRow[];
};

const HOLDOUT_OPTIONS = [10, 20, 50, 100];

const WORST_RECORDS = 8;

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

function pct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

function f1(value: number | null): string {
  return value === null ? '—' : value.toFixed(3);
}

function goodTone(value: number | null): string {
  if (value === null) return 'border-slate-300';
  if (value >= 85) return 'border-teal-500';
  if (value >= 60) return 'border-amber-500';
  return 'border-rose-500';
}

function badTone(value: number | null): string {
  if (value === null) return 'border-slate-300';
  if (value < 2) return 'border-teal-500';
  if (value < 5) return 'border-amber-500';
  return 'border-rose-500';
}

function barTone(value: number | null): string {
  if (value === null) return 'bg-slate-300';
  if (value >= 85) return 'bg-teal-600';
  if (value >= 60) return 'bg-amber-500';
  return 'bg-rose-500';
}

function truncate(value: string, max = 220): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function buildCsv(report: EvaluationReport): string[][] {
  const o = report.overall;
  const rows: string[][] = [
    ['evaluation_summary'],
    ['metric', 'value', 'numerator', 'denominator'],
    ['held_out_pct', String(report.split.pct), '', ''],
    ['seed', String(report.split.seed), '', ''],
    ['test_set_records', String(report.split.testSize), '', String(report.split.paired)],
    ['fields_evaluated', String(o.fieldsEvaluated), '', ''],
    ['overall_exact_match_pct_macro', o.exactRate === null ? '' : o.exactRate.toFixed(2), '', ''],
    ['overall_exact_match_pct_micro', o.microExactRate === null ? '' : o.microExactRate.toFixed(2), '', String(o.scoredPairs)],
    ['overall_token_f1_macro', o.fuzzyF1 === null ? '' : o.fuzzyF1.toFixed(4), '', ''],
    ['icd10_exact_pct', report.icd10.exactRate === null ? '' : report.icd10.exactRate.toFixed(2), String(report.icd10.exact), String(report.icd10.scored)],
    ['icd10_category_pct', report.icd10.categoryRate === null ? '' : report.icd10.categoryRate.toFixed(2), String(report.icd10.category), String(report.icd10.scored)],
    ['icd10_reference_unparseable', String(report.icd10.unparseable), '', ''],
    ['hallucination_rate_pct', o.hallucinationRate === null ? '' : o.hallucinationRate.toFixed(2), String(o.hallucinations), ''],
    ['omission_rate_pct', o.omissionRate === null ? '' : o.omissionRate.toFixed(2), String(o.omissions), String(o.scoredPairs)],
    ['negation_errors', String(o.negationErrors), '', ''],
    [],
    ['per_field_metrics'],
    ['field', 'reference_column', 'scored_n', 'exact_match_pct', 'token_f1', 'hallucinations', 'reference_empty_n', 'omissions', 'negation_errors'],
    ...report.fields.map((f) => [
      f.field,
      f.column,
      String(f.scored),
      f.exactRate === null ? '' : f.exactRate.toFixed(2),
      f.fuzzyF1 === null ? '' : f.fuzzyF1.toFixed(4),
      String(f.hallucinations),
      String(f.referenceEmpty),
      String(f.omissions),
      String(f.negationErrors),
    ]),
    [],
    ['per_record_field_outcomes'],
    ['record_id', 'field', 'exact', 'token_f1', 'hallucinated', 'omitted', 'negation_error', 'extracted', 'reference'],
    ...report.records.flatMap((r) =>
      r.fields.map((f) => [
        r.recordId,
        f.field,
        f.exact ? 'yes' : 'no',
        f.f1 === null ? '' : f.f1.toFixed(4),
        f.hallucinated ? 'yes' : 'no',
        f.omitted ? 'yes' : 'no',
        f.negationError ? 'yes' : 'no',
        f.extracted,
        f.reference,
      ]),
    ),
  ];

  if (report.negationExamples.length > 0) {
    rows.push([], ['negation_errors'], ['record_id', 'field', 'term', 'direction', 'extracted', 'reference']);
    for (const n of report.negationExamples) {
      rows.push([n.recordId, n.field, n.term, n.direction, n.extracted, n.reference]);
    }
  }

  return rows;
}

export default function Evaluation({ extracted, referenceRows }: Props) {
  const [holdout, setHoldout] = useState(20);
  const [seed, setSeed] = useState(42);
  const [openRecord, setOpenRecord] = useState<string | null>(null);

  const report = useMemo(
    () => evaluateExtraction(extracted, referenceRows, { holdoutPct: holdout, seed }),
    [extracted, referenceRows, holdout, seed],
  );

  if (extracted.length === 0 || report.overall.fieldsEvaluated === 0) return null;

  const o = report.overall;
  const worst = report.records.slice(0, WORST_RECORDS);

  return (
    <section className="space-y-6 rounded border-2 border-slate-400 bg-slate-50 p-6">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Evaluation against reference notes</h2>
          <p className="mt-1 text-xs text-slate-600">
            Extraction is scored against the reference structured fields shipped with this file.
            Factual match, not fluency — no model grades this.
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-wide text-slate-500">
            Held-out set
            <select
              value={holdout}
              onChange={(e) => setHoldout(Number(e.target.value))}
              className="rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[11px] normal-case tracking-normal text-slate-800"
            >
              {HOLDOUT_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}%{p === 100 ? ' (all records)' : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-wide text-slate-500">
            Seed
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 0)}
              className="w-24 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[11px] tracking-normal text-slate-800"
            />
          </label>

          <button
            type="button"
            onClick={() => download('evaluation_results.csv', buildCsv(report))}
            className="flex items-center gap-2 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700"
          >
            <Download size={13} />
            Evaluation CSV
          </button>
        </div>
      </div>

      <p className="rounded border border-slate-300 bg-white px-4 py-2 font-mono text-[11px] text-slate-700">
        TEST SET <span className="text-slate-900">{report.split.testSize}</span> of{' '}
        {report.split.paired} extracted records ({report.split.pct}%, seeded random, seed=
        {report.split.seed}) · {o.fieldsEvaluated} fields with a reference column ·{' '}
        {o.scoredPairs} scored field pairs
      </p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <article className={`rounded border-l-4 ${goodTone(o.exactRate)} border-y border-r border-slate-300 bg-white p-4`}>
          <h3 className="font-mono text-sm font-semibold text-slate-900">EXACT MATCH</h3>
          <p className="mt-2 font-mono text-3xl leading-none text-slate-900">{pct(o.exactRate)}</p>
          <p className="mt-2 text-[11px] leading-4 text-slate-600">
            Macro-average across fields. Micro {pct(o.microExactRate)} over {o.scoredPairs} pairs.
          </p>
        </article>

        <article className={`rounded border-l-4 ${goodTone(o.fuzzyF1 === null ? null : o.fuzzyF1 * 100)} border-y border-r border-slate-300 bg-white p-4`}>
          <h3 className="font-mono text-sm font-semibold text-slate-900">TOKEN F1</h3>
          <p className="mt-2 font-mono text-3xl leading-none text-slate-900">{f1(o.fuzzyF1)}</p>
          <p className="mt-2 text-[11px] leading-4 text-slate-600">
            Bag-of-words F1, stopwords removed. Credits correct content phrased differently.
          </p>
        </article>

        <article className={`rounded border-l-4 ${badTone(o.hallucinationRate)} border-y border-r border-slate-300 bg-white p-4`}>
          <h3 className="font-mono text-sm font-semibold text-slate-900">HALLUCINATION</h3>
          <p className="mt-2 font-mono text-3xl leading-none text-slate-900">
            {pct(o.hallucinationRate)}
          </p>
          <p className="mt-2 text-[11px] leading-4 text-slate-600">
            {o.hallucinations} fields populated where the reference is empty
          </p>
        </article>

        <article className={`rounded border-l-4 ${goodTone(report.icd10.exactRate)} border-y border-r border-slate-300 bg-white p-4`}>
          <h3 className="font-mono text-sm font-semibold text-slate-900">ICD-10 EXACT</h3>
          <p className="mt-2 font-mono text-3xl leading-none text-slate-900">
            {pct(report.icd10.exactRate)}
          </p>
          <p className="mt-2 text-[11px] leading-4 text-slate-600">
            {report.icd10.exact} / {report.icd10.scored} full codes correct
            {report.icd10.unparseable > 0 && ` · ${report.icd10.unparseable} reference codes unparseable`}
          </p>
        </article>

        <article className={`rounded border-l-4 ${goodTone(report.icd10.categoryRate)} border-y border-r border-slate-300 bg-white p-4`}>
          <h3 className="font-mono text-sm font-semibold text-slate-900">ICD-10 CATEGORY</h3>
          <p className="mt-2 font-mono text-3xl leading-none text-slate-900">
            {pct(report.icd10.categoryRate)}
          </p>
          <p className="mt-2 text-[11px] leading-4 text-slate-600">
            {report.icd10.category} / {report.icd10.scored} correct to 3 characters (J45.9 ≈ J45.0)
          </p>
        </article>

        <article className={`rounded border-l-4 ${o.negationErrors === 0 ? 'border-teal-500' : 'border-rose-500'} border-y border-r border-slate-300 bg-white p-4`}>
          <h3 className="font-mono text-sm font-semibold text-slate-900">NEGATION ERRORS</h3>
          <p className="mt-2 font-mono text-3xl leading-none text-slate-900">{o.negationErrors}</p>
          <p className="mt-2 text-[11px] leading-4 text-slate-600">
            Polarity inversions — a denial asserted, or an assertion denied. Safety-relevant.
          </p>
        </article>
      </div>

      <div className="rounded border border-slate-300 bg-white p-6">
        <h3 className="text-sm font-semibold text-slate-800">Per-field results</h3>
        <p className="mt-1 font-mono text-[10px] text-slate-500">
          Exact and F1 are scored only where the reference field is non-empty
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-300 font-mono text-[10px] uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3 font-normal">Field</th>
                <th className="py-2 pr-3 font-normal">n</th>
                <th className="py-2 pr-3 font-normal">Exact</th>
                <th className="py-2 pr-3 font-normal">Token F1</th>
                <th className="py-2 pr-3 font-normal">Hallucinated</th>
                <th className="py-2 pr-3 font-normal">Omitted</th>
                <th className="py-2 pr-3 font-normal">Negation</th>
              </tr>
            </thead>
            <tbody>
              {report.fields.map((f) => (
                <tr key={f.field} className="border-b border-slate-100 align-middle">
                  <td className="py-2 pr-3 text-[12px] text-slate-800">
                    {f.label}
                    <span className="ml-2 font-mono text-[10px] text-slate-400">{f.column}</span>
                  </td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-slate-600">{f.scored}</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-20 shrink-0 rounded-sm bg-slate-100">
                        <div
                          className={`h-3 rounded-sm ${barTone(f.exactRate)}`}
                          style={{ width: `${Math.max(1, f.exactRate ?? 0)}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] text-slate-700">{pct(f.exactRate)}</span>
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-20 shrink-0 rounded-sm bg-slate-100">
                        <div
                          className={`h-3 rounded-sm ${barTone(f.fuzzyF1 === null ? null : f.fuzzyF1 * 100)}`}
                          style={{ width: `${Math.max(1, (f.fuzzyF1 ?? 0) * 100)}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] text-slate-700">{f1(f.fuzzyF1)}</span>
                    </div>
                  </td>
                  <td className="py-2 pr-3 font-mono text-[11px]">
                    <span className={f.hallucinations > 0 ? 'text-rose-700' : 'text-slate-400'}>
                      {f.hallucinations}
                    </span>
                    <span className="text-slate-400"> / {f.referenceEmpty}</span>
                  </td>
                  <td className="py-2 pr-3 font-mono text-[11px]">
                    <span className={f.omissions > 0 ? 'text-amber-700' : 'text-slate-400'}>
                      {f.omissions}
                    </span>
                    <span className="text-slate-400"> / {f.scored}</span>
                  </td>
                  <td className="py-2 pr-3 font-mono text-[11px]">
                    <span className={f.negationErrors > 0 ? 'text-rose-700' : 'text-slate-400'}>
                      {f.negationErrors}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded border border-slate-300 bg-white p-6">
        <h3 className="text-sm font-semibold text-slate-800">Worst records</h3>
        <p className="mt-1 font-mono text-[10px] text-slate-500">
          Ranked by mean token F1, lowest first — click a record to see every field
        </p>
        <div className="mt-4 space-y-2">
          {worst.map((r) => {
            const open = openRecord === r.recordId;
            const shown = open ? r.fields : r.fields.filter((f) => !f.exact);
            return (
              <div key={`${r.recordId}-${r.index}`} className="rounded border border-slate-200">
                <button
                  type="button"
                  onClick={() => setOpenRecord(open ? null : r.recordId)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-left hover:bg-slate-50"
                >
                  <span className="font-mono text-[11px] text-slate-900">{r.recordId}</span>
                  <span className="font-mono text-[11px] text-slate-500">
                    F1 {f1(r.meanF1)} · exact {r.exactMatches}/{r.scoredFields}
                  </span>
                  {r.hallucinations > 0 && (
                    <span className="font-mono text-[11px] text-rose-700">
                      {r.hallucinations} hallucinated
                    </span>
                  )}
                  {r.omissions > 0 && (
                    <span className="font-mono text-[11px] text-amber-700">
                      {r.omissions} omitted
                    </span>
                  )}
                  {r.negationErrors > 0 && (
                    <span className="font-mono text-[11px] text-rose-700">
                      {r.negationErrors} negation
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[10px] uppercase tracking-wide text-slate-400">
                    {open ? 'collapse' : `${shown.length} mismatched`}
                  </span>
                </button>

                {shown.length > 0 && (
                  <div className="space-y-3 border-t border-slate-200 px-4 py-3">
                    {shown.map((f) => (
                      <div key={f.field}>
                        <p className="font-mono text-[10px] uppercase tracking-wide text-slate-500">
                          {f.label}
                          {f.hallucinated && <span className="ml-2 text-rose-700">hallucinated</span>}
                          {f.omitted && <span className="ml-2 text-amber-700">omitted</span>}
                          {f.negationError && <span className="ml-2 text-rose-700">negation inverted</span>}
                          {f.f1 !== null && <span className="ml-2 text-slate-400">F1 {f.f1.toFixed(2)}</span>}
                        </p>
                        <div className="mt-1 grid gap-2 md:grid-cols-2">
                          <div className="rounded border-l-2 border-slate-400 bg-slate-50 px-3 py-2">
                            <p className="font-mono text-[9px] uppercase tracking-wide text-slate-500">
                              Extracted
                            </p>
                            <p className="mt-1 text-[11px] leading-4 text-slate-800">
                              {truncate(f.extracted) || <span className="text-slate-400">empty</span>}
                            </p>
                          </div>
                          <div className="rounded border-l-2 border-teal-500 bg-teal-50/40 px-3 py-2">
                            <p className="font-mono text-[9px] uppercase tracking-wide text-slate-500">
                              Reference
                            </p>
                            <p className="mt-1 text-[11px] leading-4 text-slate-800">
                              {truncate(f.reference) || <span className="text-slate-400">empty</span>}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {report.negationExamples.length > 0 && (
        <div className="rounded border border-rose-300 bg-rose-50 p-6">
          <h3 className="text-sm font-semibold text-rose-800">Negation errors</h3>
          <p className="mt-1 font-mono text-[10px] text-rose-700">
            A polarity inversion on a symptom, allergy or medication field is a stop-deployment finding
          </p>
          <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
            {report.negationExamples.slice(0, 25).map((n, i) => (
              <li key={`${n.recordId}-${n.field}-${n.term}-${i}`} className="font-mono text-[11px]">
                <span className="text-rose-900">{n.recordId}</span>
                <span className="text-rose-700"> · {n.field} · “{n.term}” · </span>
                <span className="text-rose-800">
                  {n.direction === 'asserted_a_denial'
                    ? 'reference denies it, extraction asserts it'
                    : 'reference asserts it, extraction denies it'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
