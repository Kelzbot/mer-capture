import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { parseDate, parseMissing } from './normalise';
import type { Profile } from './aliases';
import type { Row } from './indicators';

export type RawRow = Record<string, unknown>;

export type ParsedFile = {
  name: string;
  headers: string[];
  rows: RawRow[];
};

export type ShapeReport = {
  shape: 'wide' | 'long';
  inputRows: number;
  patientCount: number;
  collapsed: number;
  message: string;
};

function headersFrom(rows: RawRow[], fallback: string[]): string[] {
  const seen: string[] = [];
  for (const row of rows.slice(0, 50)) {
    for (const key of Object.keys(row)) {
      if (!seen.includes(key)) seen.push(key);
    }
  }
  return seen.length ? seen : fallback;
}

export function parseCsvText(text: string, name = 'pasted.csv'): ParsedFile {
  const parsed = Papa.parse<RawRow>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
  const rows = (parsed.data ?? []).filter(
    (r) => r && typeof r === 'object' && Object.values(r).some((v) => parseMissing(v) !== null),
  );
  return { name, headers: headersFrom(rows, parsed.meta?.fields ?? []), rows };
}

function parseWorkbook(data: ArrayBuffer, name: string): ParsedFile {
  const wb = XLSX.read(data, { type: 'array', cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: '', raw: true });
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
  const headerRow = (grid[0] ?? []).map((h) => String(h ?? '').trim()).filter(Boolean);
  const cleaned = rows.filter((r) => Object.values(r).some((v) => parseMissing(v) !== null));
  return { name, headers: headersFrom(cleaned, headerRow), rows: cleaned };
}

export async function readFile(file: File): Promise<ParsedFile> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    return parseWorkbook(await file.arrayBuffer(), file.name);
  }
  return parseCsvText(await file.text(), file.name);
}

export async function loadSample(path: string): Promise<ParsedFile> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not load ${path}`);
  return parseCsvText(await res.text(), path.split('/').pop() ?? path);
}

export function applyMapping(rows: RawRow[], mapping: Record<string, string | null>): Row[] {
  const pairs = Object.entries(mapping).filter(([, header]) => header !== null) as Array<[string, string]>;
  return rows.map((raw) => {
    const out: Row = {};
    for (const [field, header] of pairs) out[field] = raw[header];
    return out;
  });
}

function recencyKey(row: Row, profile: Profile): number {
  const primary = profile === 'eid' ? row.date_specimen_drawn : row.visit_date;
  const d = parseDate(primary).date;
  if (d) return d.getTime();
  const fallback = parseDate(profile === 'eid' ? row.date_assay_performed : row.next_pickup_date).date;
  return fallback ? fallback.getTime() : -Infinity;
}

export function reduceToLatest(rows: Row[], profile: Profile): { rows: Row[]; report: ShapeReport } {
  const ids = rows.map((r) => parseMissing(r.patient_id));
  const withId = ids.filter((v): v is string => v !== null);
  const unique = new Set(withId);
  const isLong = withId.length > 0 && unique.size < withId.length;

  if (!isLong) {
    return {
      rows,
      report: {
        shape: 'wide',
        inputRows: rows.length,
        patientCount: unique.size || rows.length,
        collapsed: 0,
        message: `Wide format detected — one row per patient. ${rows.length} rows, ${unique.size || rows.length} patients.`,
      },
    };
  }

  const best = new Map<string, Row>();
  const anonymous: Row[] = [];
  rows.forEach((row, i) => {
    const id = ids[i];
    if (id === null) {
      anonymous.push(row);
      return;
    }
    const existing = best.get(id);
    if (!existing || recencyKey(row, profile) >= recencyKey(existing, profile)) best.set(id, row);
  });

  const reduced = [...best.values(), ...anonymous];
  const dateField = profile === 'eid' ? 'date_specimen_drawn' : 'visit_date';
  return {
    rows: reduced,
    report: {
      shape: 'long',
      inputRows: rows.length,
      patientCount: reduced.length,
      collapsed: rows.length - reduced.length,
      message: `Long format detected — repeated patient IDs mean one row per visit. Reduced ${rows.length} rows to ${reduced.length} patients by most recent ${dateField}.`,
    },
  };
}
