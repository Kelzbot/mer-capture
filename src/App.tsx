import { useMemo, useState } from 'react';
import { Activity, KeyRound } from 'lucide-react';
import Upload from './components/Upload';
import Mapping from './components/Mapping';
import Dashboard from './components/Dashboard';
import DataQuality from './components/DataQuality';
import NoteExtract from './components/NoteExtract';
import BatchNotes from './components/BatchNotes';
import { autoMap, type MapResult } from './lib/mapper';
import { applyMapping, reduceToLatest, type ParsedFile } from './lib/ingest';
import { computeIndicators, type Period } from './lib/indicators';
import { facilityScore, runDQ } from './lib/dq';
import { PROVIDER_LABELS, PROVIDER_MODELS, type Provider } from './lib/extract';

const STEPS = ['Upload', 'Mapping', 'Dashboard', 'Data quality'];

type Mode = 'dataset' | 'note' | 'batch';

const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'dataset', label: 'Dataset' },
  { id: 'note', label: 'Single note' },
  { id: 'batch', label: 'Batch notes' },
];

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1));
}

export default function App() {
  const [mode, setMode] = useState<Mode>('dataset');
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState<Provider>('gemini');
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [map, setMap] = useState<MapResult | null>(null);
  const [periodStart, setPeriodStart] = useState('2026-04-01');
  const [periodEnd, setPeriodEnd] = useState('2026-06-30');

  const period: Period = useMemo(
    () => ({ start: isoToDate(periodStart), end: isoToDate(periodEnd) }),
    [periodStart, periodEnd],
  );

  const mappedRows = useMemo(
    () => (file && map ? applyMapping(file.rows, map.mapping) : []),
    [file, map],
  );

  const shape = useMemo(
    () => reduceToLatest(mappedRows, map?.profile ?? 'adult_art'),
    [mappedRows, map],
  );

  const report = useMemo(
    () => computeIndicators(shape.rows, period, map?.profile ?? 'adult_art'),
    [shape, period, map],
  );

  const flags = useMemo(
    () => (map ? runDQ(mappedRows, map.profile, period) : []),
    [mappedRows, map, period],
  );

  const scores = useMemo(
    () => (map ? facilityScore(mappedRows, flags, map.profile, period) : []),
    [mappedRows, flags, map, period],
  );

  const loaded = Boolean(file && map);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-300 bg-slate-900 text-slate-100">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <Activity size={22} className="text-teal-400" />
            <div>
              <h1 className="text-base font-semibold tracking-tight">MER Capture</h1>
              <p className="font-mono text-[11px] text-slate-400">
                PEPFAR indicator and data quality workbench — Nigeria
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3 font-mono text-[11px]">
            <span className="text-slate-400">REPORTING PERIOD</span>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-100"
            />
            <span className="text-slate-500">to</span>
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-100"
            />
          </div>
        </div>

        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-6 pb-2">
          <div className="flex gap-1">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={[
                  'rounded px-3 py-1 text-xs font-medium transition-colors',
                  mode === m.id
                    ? 'bg-teal-500 text-slate-950'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200',
                ].join(' ')}
              >
                {m.label}
              </button>
            ))}
          </div>
          {mode !== 'dataset' && (
            <div className="ml-auto flex flex-wrap items-center gap-3 font-mono text-[11px]">
              <KeyRound size={13} className="text-slate-400" />
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as Provider)}
                className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-100"
              >
                {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_LABELS[p]} — {PROVIDER_MODELS[p]}
                  </option>
                ))}
              </select>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="API key — kept in memory only"
                className="w-64 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-100 placeholder:text-slate-500"
              />
            </div>
          )}
        </div>

        {mode === 'dataset' && (
          <nav className="mx-auto flex max-w-7xl gap-1 px-6">
            {STEPS.map((label, i) => {
              const disabled = i > 0 && !loaded;
              const active = i === step;
              return (
                <button
                  key={label}
                  type="button"
                  disabled={disabled}
                  onClick={() => setStep(i)}
                  className={[
                    'flex items-center gap-2 border-b-2 px-4 py-2 text-xs font-medium transition-colors',
                    active
                      ? 'border-teal-400 text-teal-300'
                      : disabled
                        ? 'border-transparent text-slate-600'
                        : 'border-transparent text-slate-400 hover:text-slate-200',
                  ].join(' ')}
                >
                  <span className="font-mono text-[10px]">{i + 1}</span>
                  {label}
                </button>
              );
            })}
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {mode === 'note' && <NoteExtract apiKey={apiKey} provider={provider} period={period} />}
        {mode === 'batch' && <BatchNotes apiKey={apiKey} provider={provider} period={period} />}

        {mode === 'dataset' && step === 0 && (
          <Upload
            current={file}
            profile={map?.profile ?? null}
            onLoaded={(parsed) => {
              setFile(parsed);
              setMap(autoMap(parsed.headers));
              setStep(1);
            }}
          />
        )}

        {mode === 'dataset' && step === 1 && file && map && (
          <Mapping file={file} map={map} onChange={setMap} onNext={() => setStep(2)} />
        )}

        {mode === 'dataset' && step === 2 && loaded && (
          <Dashboard report={report} shape={shape.report} period={period} />
        )}

        {mode === 'dataset' && step === 3 && loaded && (
          <DataQuality
            flags={flags}
            scores={scores}
            sourceRows={mappedRows.length}
            profile={map?.profile ?? 'adult_art'}
          />
        )}
      </main>

      <footer className="mx-auto max-w-7xl px-6 pb-10 font-mono text-[10px] text-slate-500">
        All processing runs in this browser tab. Nothing is uploaded, stored or persisted.
      </footer>
    </div>
  );
}
