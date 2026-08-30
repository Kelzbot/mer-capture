import { useMemo, useRef, useState } from 'react';
import { CircleX, Download, FileSpreadsheet, Loader, Play } from 'lucide-react';
import DataQuality from './DataQuality';
import Evaluation from './Evaluation';
import { hasReferenceColumns, type ExtractedRecord, type ReferenceRow } from '../lib/evaluate';
import { readFile, type ParsedFile } from '../lib/ingest';
import { extractNote, type ExtractionResult, type Provider } from '../lib/extract';
import type { Period } from '../lib/indicators';
import {
  computeDocQuality,
  facilityOrVariantScore,
  type DocRecord,
} from '../lib/docQuality';

type Props = {
  apiKey: string;
  provider: Provider;
  period: Period;
};

type BatchRow = {
  index: number;
  recordId: string;
  status: 'ok' | 'error' | 'cancelled';
  result?: ExtractionResult;
  message?: string;
};

const CONCURRENCY = 3;

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

function rateTone(value: number | null): string {
  if (value === null) return 'border-slate-300';
  if (value >= 80) return 'border-teal-500';
  if (value >= 50) return 'border-amber-500';
  return 'border-rose-500';
}

function barTone(value: number | null): string {
  if (value === null) return 'bg-slate-300';
  if (value >= 80) return 'bg-teal-600';
  if (value >= 50) return 'bg-amber-500';
  return 'bg-rose-500';
}

export default function BatchNotes({ apiKey, provider }: Props) {
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [noteCol, setNoteCol] = useState('');
  const [idCol, setIdCol] = useState('');
  const [results, setResults] = useState<BatchRow[]>([]);
  const [done, setDone] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancelled = useRef(false);
  const controller = useRef<AbortController | null>(null);

  const total = file?.rows.length ?? 0;
  const succeeded = results.filter((r) => r?.status === 'ok');
  const failed = results.filter((r) => r?.status === 'error');

  const docRecords: DocRecord[] = useMemo(
    () =>
      succeeded.map((r) => ({
        recordId: r.recordId,
        fields: r.result?.fields ?? {},
      })),
    [succeeded],
  );

  const rows: Array<Record<string, unknown>> = useMemo(
    () => succeeded.map((r) => r.result?.row ?? {}),
    [succeeded],
  );

  const referenceReady = useMemo(
    () => (file ? hasReferenceColumns(file.headers) : false),
    [file],
  );

  const pairs = useMemo(() => {
    const extracted: ExtractedRecord[] = [];
    const reference: ReferenceRow[] = [];
    if (!file || !referenceReady) return { extracted, reference };
    for (const r of succeeded) {
      extracted.push({ recordId: r.recordId, fields: r.result?.fields ?? {} });
      reference.push(file.rows[r.index] ?? {});
    }
    return { extracted, reference };
  }, [succeeded, file, referenceReady]);

  const analysis = useMemo(() => {
    if (docRecords.length === 0) return null;
    const { metrics, flags } = computeDocQuality(docRecords);
    return { metrics, flags, scores: facilityOrVariantScore(docRecords, flags) };
  }, [docRecords]);

  async function loadFile(f: File) {
    setError(null);
    setResults([]);
    setDone(0);
    try {
      const parsed = await readFile(f);
      if (parsed.rows.length === 0) throw new Error('No data rows found in that file');
      setFile(parsed);
      const guessNote = parsed.headers.find((h) =>
        /note|narrative|comment|text|remark|summary|transcript/i.test(h),
      );
      const guessId = parsed.headers.find((h) => /encounter|record|id|number|no\b|uid/i.test(h));
      setNoteCol(guessNote ?? parsed.headers[0] ?? '');
      setIdCol(guessId ?? parsed.headers[0] ?? '');
    } catch (e) {
      setFile(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function run() {
    if (!file || !noteCol) return;
    cancelled.current = false;
    controller.current = new AbortController();
    setRunning(true);
    setError(null);
    setDone(0);

    const source = file.rows;
    const out: BatchRow[] = source.map((raw, index) => ({
      index,
      recordId: String(raw[idCol] ?? '').trim() || `row-${index + 1}`,
      status: 'cancelled',
    }));
    setResults([...out]);

    let cursor = 0;
    const worker = async () => {
      for (;;) {
        if (cancelled.current) return;
        const i = cursor++;
        if (i >= source.length) return;

        const text = String(source[i][noteCol] ?? '');
        try {
          if (!text.trim()) throw new Error('Note column is empty for this row');
          const extracted = await extractNote(text, apiKey, provider, controller.current?.signal);
          out[i] = { ...out[i], status: 'ok', result: extracted };
        } catch (e) {
          out[i] = {
            ...out[i],
            status: cancelled.current ? 'cancelled' : 'error',
            message: e instanceof Error ? e.message : String(e),
          };
        }
        setDone((d) => d + 1);
        setResults([...out]);
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRunning(false);
  }

  function cancel() {
    cancelled.current = true;
    controller.current?.abort();
    setRunning(false);
  }

  const exportRecords = () => {
    const fields = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    download('extracted_records.csv', [
      ['record_id', 'mean_confidence', ...fields],
      ...succeeded.map((r, i) => {
        const values = Object.values(r.result?.fields ?? {});
        const mean = values.length
          ? values.reduce((sum, f) => sum + f.confidence, 0) / values.length
          : 0;
        return [r.recordId, mean.toFixed(2), ...fields.map((f) => String(rows[i][f] ?? ''))];
      }),
    ]);
  };

  const exportMetrics = () => {
    if (!analysis) return;
    const m = analysis.metrics;
    download('doc_quality_metrics.csv', [
      ['metric', 'value', 'numerator', 'denominator'],
      ['records_extracted', String(m.records), '', ''],
      ['complete_records_pct', m.completeRate === null ? '' : m.completeRate.toFixed(1), String(m.completeRecords), String(m.records)],
      ['diagnosis_coding_rate_pct', m.diagnosisCodingRate === null ? '' : m.diagnosisCodingRate.toFixed(1), String(m.diagnosisCoded), String(m.diagnosisPresent)],
      ['overall_mean_confidence', m.overallConfidence === null ? '' : m.overallConfidence.toFixed(3), '', ''],
      [],
      ['section_fill_rate'],
      ['section', 'fill_rate_pct', 'filled', 'records', 'core_soap_section'],
      ...m.sectionFill.map((s) => [
        s.field,
        s.rate === null ? '' : s.rate.toFixed(1),
        String(s.filled),
        String(s.total),
        s.core ? 'yes' : 'no',
      ]),
      [],
      ['mean_confidence_per_field'],
      ['field', 'mean_confidence', 'records_with_field'],
      ...m.meanConfidence.map((c) => [
        c.field,
        c.mean === null ? '' : c.mean.toFixed(3),
        String(c.n),
      ]),
    ]);
  };

  const progress = total > 0 ? (done / total) * 100 : 0;

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-300 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-800">Batch note extraction</h2>
        <p className="mt-1 text-xs text-slate-600">
          Upload a CSV or Excel export containing a free-text note column. Every note is de-identified
          in this browser before it is sent, {CONCURRENCY} at a time.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="flex cursor-pointer items-center gap-2 rounded border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700">
            <FileSpreadsheet size={14} />
            {file ? 'Choose a different file' : 'Choose CSV or Excel file'}
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv"
              className="hidden"
              disabled={running}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) loadFile(f);
              }}
            />
          </label>

          {file && (
            <>
              <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-wide text-slate-500">
                Note column
                <select
                  value={noteCol}
                  onChange={(e) => setNoteCol(e.target.value)}
                  disabled={running}
                  className="rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[11px] normal-case tracking-normal text-slate-800"
                >
                  {file.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-wide text-slate-500">
                Record ID column
                <select
                  value={idCol}
                  onChange={(e) => setIdCol(e.target.value)}
                  disabled={running}
                  className="rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[11px] normal-case tracking-normal text-slate-800"
                >
                  {file.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>

              {running ? (
                <button
                  type="button"
                  onClick={cancel}
                  className="flex items-center gap-2 rounded border border-rose-300 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-700 hover:bg-rose-100"
                >
                  <CircleX size={14} />
                  Cancel run
                </button>
              ) : (
                <button
                  type="button"
                  onClick={run}
                  disabled={!apiKey.trim() || !noteCol}
                  className="flex items-center gap-2 rounded bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
                >
                  <Play size={14} />
                  Extract {total} notes
                </button>
              )}
            </>
          )}
        </div>

        {!apiKey.trim() && (
          <p className="mt-3 font-mono text-[10px] text-amber-700">Enter an API key above to run.</p>
        )}

        {file && referenceReady && (
          <p className="mt-3 rounded border border-teal-300 bg-teal-50 px-3 py-2 font-mono text-[11px] text-teal-800">
            Reference structured fields detected in this file — extraction will be scored against them
            once the run completes. The note column is the only column sent to the model.
          </p>
        )}

        {error && (
          <p className="mt-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 font-mono text-[11px] text-rose-700">
            {error}
          </p>
        )}

        {(running || results.length > 0) && (
          <div className="mt-5">
            <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-slate-600">
              {running && <Loader size={13} className="animate-spin text-teal-600" />}
              <span>
                {done}/{total} processed
              </span>
              <span className="text-teal-700">{succeeded.length} extracted</span>
              <span className="text-rose-700">{failed.length} failed</span>
              {!running && done > 0 && done < total && (
                <span className="text-amber-700">{total - done} not attempted</span>
              )}
              <div className="ml-auto flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={exportRecords}
                  disabled={rows.length === 0}
                  className="flex items-center gap-2 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700 disabled:opacity-40"
                >
                  <Download size={13} />
                  Extracted records CSV
                </button>
                <button
                  type="button"
                  onClick={exportMetrics}
                  disabled={!analysis}
                  className="flex items-center gap-2 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700 disabled:opacity-40"
                >
                  <Download size={13} />
                  Doc-quality metrics CSV
                </button>
              </div>
            </div>
            <div className="mt-2 h-2 w-full rounded-sm bg-slate-100">
              <div
                className="h-2 rounded-sm bg-teal-600 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {failed.length > 0 && (
          <div className="mt-4 rounded border border-rose-200 bg-rose-50 px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-wide text-rose-700">
              Failed rows — skipped, the run continued
            </p>
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {failed.map((r) => (
                <li key={r.index} className="flex gap-3 font-mono text-[11px]">
                  <span className="w-32 shrink-0 truncate text-rose-800">{r.recordId}</span>
                  <span className="text-rose-700">{r.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {analysis && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <article className={`rounded border-l-4 ${rateTone(analysis.metrics.completeRate)} border-y border-r border-slate-300 bg-white p-4`}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-mono text-sm font-semibold text-slate-900">COMPLETE</h3>
                <span className="font-mono text-lg text-slate-900">
                  {pct(analysis.metrics.completeRate)}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-slate-600">
                Encounters with every core SOAP section documented
              </p>
              <div className="mt-3 flex items-end gap-1 font-mono">
                <span className="text-2xl leading-none text-slate-900">
                  {analysis.metrics.completeRecords}
                </span>
                <span className="text-sm leading-none text-slate-400">
                  / {analysis.metrics.records}
                </span>
              </div>
              <p className="mt-1 font-mono text-[10px] text-slate-500">
                denominator: records extracted
              </p>
            </article>

            <article className={`rounded border-l-4 ${rateTone(analysis.metrics.diagnosisCodingRate)} border-y border-r border-slate-300 bg-white p-4`}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-mono text-sm font-semibold text-slate-900">ICD-10 CODED</h3>
                <span className="font-mono text-lg text-slate-900">
                  {pct(analysis.metrics.diagnosisCodingRate)}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-slate-600">
                Diagnoses carrying an ICD-10 code
              </p>
              <div className="mt-3 flex items-end gap-1 font-mono">
                <span className="text-2xl leading-none text-slate-900">
                  {analysis.metrics.diagnosisCoded}
                </span>
                <span className="text-sm leading-none text-slate-400">
                  / {analysis.metrics.diagnosisPresent}
                </span>
              </div>
              <p className="mt-1 font-mono text-[10px] text-slate-500">
                denominator: records with a final diagnosis
              </p>
            </article>

            <article className="rounded border-l-4 border-rose-500 border-y border-r border-slate-300 bg-white p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-mono text-sm font-semibold text-slate-900">CRITICAL</h3>
                <span className="font-mono text-lg text-rose-700">
                  {analysis.flags.filter((f) => f.severity === 'critical').length}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-slate-600">
                Findings that block the record from being used as coded data
              </p>
              <div className="mt-3 flex items-end gap-1 font-mono">
                <span className="text-2xl leading-none text-amber-700">
                  {analysis.flags.filter((f) => f.severity === 'warning').length}
                </span>
                <span className="text-sm leading-none text-slate-400">warnings</span>
              </div>
              <p className="mt-1 font-mono text-[10px] text-slate-500">
                full list in the findings panel below
              </p>
            </article>

            <article className={`rounded border-l-4 ${rateTone(analysis.metrics.overallConfidence === null ? null : analysis.metrics.overallConfidence * 100)} border-y border-r border-slate-300 bg-white p-4`}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-mono text-sm font-semibold text-slate-900">CONFIDENCE</h3>
                <span className="font-mono text-lg text-slate-900">
                  {analysis.metrics.overallConfidence === null
                    ? '—'
                    : analysis.metrics.overallConfidence.toFixed(2)}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-slate-600">
                Mean extraction confidence across every populated field
              </p>
              <div className="mt-3 flex items-end gap-1 font-mono">
                <span className="text-2xl leading-none text-slate-900">{succeeded.length}</span>
                <span className="text-sm leading-none text-slate-400">/ {total} notes</span>
              </div>
              <p className="mt-1 font-mono text-[10px] text-slate-500">
                denominator: notes submitted
              </p>
            </article>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded border border-slate-300 bg-white p-6">
              <h3 className="text-sm font-semibold text-slate-800">Section fill rate</h3>
              <p className="mt-1 font-mono text-[10px] text-slate-500">
                Core SOAP sections marked ●
              </p>
              <div className="mt-4 space-y-2">
                {analysis.metrics.sectionFill.map((s) => (
                  <div key={s.field} className="grid grid-cols-[190px_1fr_92px] items-center gap-3">
                    <span className="truncate text-[11px] text-slate-700">
                      {s.core && <span className="mr-1 text-teal-600">●</span>}
                      {s.label}
                    </span>
                    <div className="h-4 rounded-sm bg-slate-100">
                      <div
                        className={`h-4 rounded-sm ${barTone(s.rate)}`}
                        style={{ width: `${Math.max(1, s.rate ?? 0)}%` }}
                      />
                    </div>
                    <span className="font-mono text-[11px] text-slate-700">
                      {pct(s.rate)}
                      <span className="text-slate-400"> {s.filled}/{s.total}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded border border-slate-300 bg-white p-6">
              <h3 className="text-sm font-semibold text-slate-800">Mean confidence per field</h3>
              <p className="mt-1 font-mono text-[10px] text-slate-500">
                Averaged only over records where the field was extracted
              </p>
              <div className="mt-4 space-y-2">
                {analysis.metrics.meanConfidence.map((c) => (
                  <div key={c.field} className="grid grid-cols-[190px_1fr_92px] items-center gap-3">
                    <span className="truncate text-[11px] text-slate-700">{c.label}</span>
                    <div className="h-4 rounded-sm bg-slate-100">
                      <div
                        className={`h-4 rounded-sm ${barTone(c.mean === null ? null : c.mean * 100)}`}
                        style={{ width: `${Math.max(1, (c.mean ?? 0) * 100)}%` }}
                      />
                    </div>
                    <span className="font-mono text-[11px] text-slate-700">
                      {c.mean === null ? 'no data' : c.mean.toFixed(2)}
                      <span className="text-slate-400"> n={c.n}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <DataQuality
            flags={analysis.flags}
            scores={analysis.scores}
            sourceRows={analysis.metrics.records}
            profile="clinical_encounters"
          />
        </>
      )}

      {pairs.extracted.length > 0 && (
        <Evaluation extracted={pairs.extracted} referenceRows={pairs.reference} />
      )}

      <p className="font-mono text-[10px] text-slate-500">
        The reporting period in the header applies to Dataset mode only — these metrics describe the
        documentation quality of the notes themselves.
      </p>
    </div>
  );
}
