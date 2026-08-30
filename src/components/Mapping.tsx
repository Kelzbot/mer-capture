import { ArrowRight, CircleAlert } from 'lucide-react';
import { FIELD_LABELS, PROFILE_ALIASES } from '../lib/aliases';
import { remap, type MapResult } from '../lib/mapper';
import type { ParsedFile } from '../lib/ingest';

type Props = {
  file: ParsedFile;
  map: MapResult;
  onChange: (m: MapResult) => void;
  onNext: () => void;
};

function confidenceTone(c: number): string {
  if (c >= 1) return 'text-teal-700 bg-teal-50 border-teal-200';
  if (c >= 0.8) return 'text-amber-700 bg-amber-50 border-amber-200';
  if (c > 0) return 'text-rose-700 bg-rose-50 border-rose-200';
  return 'text-slate-500 bg-slate-50 border-slate-200';
}

export default function Mapping({ file, map, onChange, onNext }: Props) {
  const fields = Object.keys(PROFILE_ALIASES[map.profile]);
  const mappedCount = fields.filter((f) => map.mapping[f]).length;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded border border-slate-300 bg-white px-6 py-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-slate-500">Profile</p>
          <p className="text-sm font-semibold text-slate-800">
            {map.profile === 'eid' ? 'EID / infant PCR' : 'Adult ART'}
          </p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-slate-500">Fields mapped</p>
          <p className="font-mono text-sm text-slate-800">
            {mappedCount}/{fields.length}
          </p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-slate-500">Source columns</p>
          <p className="font-mono text-sm text-slate-800">{file.headers.length}</p>
        </div>
        <button
          type="button"
          onClick={onNext}
          className="ml-auto flex items-center gap-2 rounded bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700"
        >
          Compute indicators
          <ArrowRight size={14} />
        </button>
      </section>

      <section className="overflow-x-auto rounded border border-slate-300 bg-white">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-300 bg-slate-50 font-mono text-[10px] uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2 font-normal">Canonical field</th>
              <th className="px-4 py-2 font-normal">Detected header</th>
              <th className="px-4 py-2 font-normal">Confidence</th>
              <th className="px-4 py-2 font-normal">Override</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => {
              const header = map.mapping[field];
              const c = map.confidence[field] ?? 0;
              return (
                <tr key={field} className="border-b border-slate-200 last:border-0">
                  <td className="px-4 py-2">
                    <div className="text-xs font-medium text-slate-800">
                      {FIELD_LABELS[field] ?? field}
                    </div>
                    <div className="font-mono text-[10px] text-slate-500">{field}</div>
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px] text-slate-700">
                    {header ?? <span className="text-slate-400">— not found —</span>}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-block rounded border px-2 py-0.5 font-mono text-[10px] ${confidenceTone(c)}`}
                    >
                      {c > 0 ? c.toFixed(2) : 'none'}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={header ?? ''}
                      onChange={(e) =>
                        onChange(remap(map, field, e.target.value || null, file.headers))
                      }
                      className="w-full max-w-xs rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[11px] text-slate-700"
                    >
                      <option value="">— unmapped —</option>
                      {file.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="rounded border border-slate-300 bg-white p-6">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <CircleAlert size={15} className="text-amber-600" />
          Unmapped source columns
          <span className="font-mono text-[11px] font-normal text-slate-500">
            {map.unmapped.length}
          </span>
        </h3>
        {map.unmapped.length === 0 ? (
          <p className="mt-2 font-mono text-[11px] text-slate-500">
            Every column in the file was matched to a canonical field.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {map.unmapped.map((h) => (
              <span
                key={h}
                className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[10px] text-slate-600"
              >
                {h}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
