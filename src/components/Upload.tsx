import { useState } from 'react';
import { FileSpreadsheet, FlaskConical, Users } from 'lucide-react';
import { loadSample, readFile, type ParsedFile } from '../lib/ingest';
import type { Profile } from '../lib/aliases';

type Props = {
  current: ParsedFile | null;
  profile: Profile | null;
  onLoaded: (parsed: ParsedFile) => void;
};

export default function Upload({ current, profile, onLoaded }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<ParsedFile>) {
    setBusy(true);
    setError(null);
    try {
      const parsed = await work();
      if (parsed.rows.length === 0) throw new Error('No data rows found in that file');
      onLoaded(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <section className="rounded border border-slate-300 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-800">Load a line list</h2>
        <p className="mt-1 text-xs text-slate-600">
          CSV or Excel. Headers are matched against known Nigerian programme field names on the next
          step, where every match can be overridden.
        </p>

        <label className="mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center hover:border-teal-500 hover:bg-teal-50/40">
          <FileSpreadsheet size={26} className="text-slate-400" />
          <span className="text-xs font-medium text-slate-700">Choose a .csv, .xlsx or .xls file</span>
          <span className="font-mono text-[10px] text-slate-500">
            parsed in-browser — no upload
          </span>
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) run(() => readFile(f));
            }}
          />
        </label>

        <div className="mt-5">
          <p className="font-mono text-[10px] uppercase tracking-wide text-slate-500">
            Or load bundled sample data
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => loadSample('samples/adult_art_sample.csv'))}
              className="flex items-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700 disabled:opacity-50"
            >
              <Users size={14} />
              Adult ART sample
              <span className="font-mono text-[10px] text-slate-500">60 rows</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => loadSample('samples/eid_sample.csv'))}
              className="flex items-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700 disabled:opacity-50"
            >
              <FlaskConical size={14} />
              EID / infant PCR sample
              <span className="font-mono text-[10px] text-slate-500">40 rows</span>
            </button>
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded border border-rose-300 bg-rose-50 px-3 py-2 font-mono text-[11px] text-rose-700">
            {error}
          </p>
        )}
      </section>

      <section className="rounded border border-slate-300 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-800">Loaded file</h2>
        {current ? (
          <dl className="mt-4 space-y-3 font-mono text-[11px]">
            <div>
              <dt className="text-slate-500">FILE</dt>
              <dd className="break-all text-slate-800">{current.name}</dd>
            </div>
            <div>
              <dt className="text-slate-500">ROWS</dt>
              <dd className="text-slate-800">{current.rows.length}</dd>
            </div>
            <div>
              <dt className="text-slate-500">COLUMNS</dt>
              <dd className="text-slate-800">{current.headers.length}</dd>
            </div>
            <div>
              <dt className="text-slate-500">DETECTED PROFILE</dt>
              <dd className="text-teal-700">{profile === 'eid' ? 'EID / infant PCR' : 'Adult ART'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">HEADERS</dt>
              <dd className="mt-1 max-h-64 overflow-y-auto whitespace-pre-line leading-5 text-slate-600">
                {current.headers.join('\n')}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-4 font-mono text-[11px] text-slate-500">Nothing loaded yet.</p>
        )}
      </section>
    </div>
  );
}
