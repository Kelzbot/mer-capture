const MISSING_TOKENS = new Set([
  '', 'na', 'n/a', 'n.a.', '-', '--', '---', 'null', 'nil', 'none',
  'unknown', 'unk', 'not known', 'no data', 'missing', '999', '9999', '.', '?', '#n/a',
]);

export function parseMissing(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'number') {
    if (!isFinite(v)) return null;
    return MISSING_TOKENS.has(String(v)) ? null : String(v);
  }
  const s = String(v).trim();
  if (MISSING_TOKENS.has(s.toLowerCase())) return null;
  return s;
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
export const DAY_MS = 86400000;

function makeDate(y: number, m: number, d: number): Date | null {
  if (!isFinite(y) || !isFinite(m) || !isFinite(d)) return null;
  if (m < 0 || m > 11 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return null;
  return dt;
}

function expandYear(raw: string): number {
  const n = Number(raw);
  if (raw.length <= 2) return n < 50 ? 2000 + n : 1900 + n;
  return n;
}

export function parseDate(v: unknown): { date: Date | null; ambiguous: boolean } {
  const s = parseMissing(v);
  if (s === null) return { date: null, ambiguous: false };

  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n >= 20000 && n <= 60000) {
      const dt = new Date(EXCEL_EPOCH + Math.round(n) * DAY_MS);
      return { date: isNaN(dt.getTime()) ? null : dt, ambiguous: false };
    }
    return { date: null, ambiguous: false };
  }

  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    return { date: makeDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])), ambiguous: false };
  }

  const alpha = s.match(/^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})[\s\-/.]+(\d{2,4})/);
  if (alpha) {
    const m = MONTHS[alpha[2].toLowerCase()];
    if (m === undefined) return { date: null, ambiguous: false };
    return { date: makeDate(expandYear(alpha[3]), m, Number(alpha[1])), ambiguous: false };
  }

  const alphaFirst = s.match(/^([A-Za-z]{3,9})[\s\-/.]+(\d{1,2})[,\s\-/.]+(\d{2,4})/);
  if (alphaFirst) {
    const m = MONTHS[alphaFirst[1].toLowerCase()];
    if (m === undefined) return { date: null, ambiguous: false };
    return { date: makeDate(expandYear(alphaFirst[3]), m, Number(alphaFirst[2])), ambiguous: false };
  }

  const numeric = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const y = expandYear(numeric[3]);
    if (a > 12 && b <= 12) return { date: makeDate(y, b - 1, a), ambiguous: false };
    if (b > 12 && a <= 12) return { date: makeDate(y, a - 1, b), ambiguous: false };
    return { date: makeDate(y, b - 1, a), ambiguous: a <= 12 && b <= 12 && a !== b };
  }

  const fallback = new Date(s);
  if (!isNaN(fallback.getTime())) {
    return {
      date: new Date(Date.UTC(fallback.getFullYear(), fallback.getMonth(), fallback.getDate())),
      ambiguous: false,
    };
  }
  return { date: null, ambiguous: false };
}

export function daysBetween(from: Date | null, to: Date | null): number | null {
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

const SUPPRESSION_THRESHOLD = 1000;

const QUALITATIVE: Array<[RegExp, string]> = [
  [/^(tnd|targetnotdetected|targetnotdetect)$/, 'TND'],
  [/^(ldl|lowerthandetectablelimit|lessthandetectablelimit|belowdetectablelimit)$/, 'LDL'],
  [/^(nd|notdetected|novirusdetected)$/, 'ND'],
  [/^(bdl|belowdetectionlimit|belowdetectablelevel)$/, 'BDL'],
  [/^(undetectable|undetected|undetect)$/, 'Undetectable'],
];

export function parseViralLoad(v: unknown): {
  value: number | null;
  qualitative: string | null;
  suppressed: boolean | null;
} {
  const s = parseMissing(v);
  if (s === null) return { value: null, qualitative: null, suppressed: null };

  const cleaned = s
    .replace(/copies\s*(\/|per)\s*m?l/gi, '')
    .replace(/\bcopies\b/gi, '')
    .replace(/cp\s*\/\s*ml/gi, '')
    .trim();

  const key = cleaned.toLowerCase().replace(/[^a-z]/g, '');
  for (const [re, label] of QUALITATIVE) {
    if (re.test(key)) return { value: null, qualitative: label, suppressed: true };
  }

  const censored = cleaned.match(/^([<>])\s*([\d,]+(?:\.\d+)?)/);
  if (censored) {
    const n = Number(censored[2].replace(/,/g, ''));
    if (!isFinite(n)) return { value: null, qualitative: cleaned, suppressed: null };
    const qualitative = `${censored[1]}${n}`;
    if (censored[1] === '<') {
      return { value: null, qualitative, suppressed: n <= SUPPRESSION_THRESHOLD };
    }
    return { value: null, qualitative, suppressed: n >= SUPPRESSION_THRESHOLD ? false : null };
  }

  const bare = cleaned.replace(/,/g, '');
  if (/^\d+(\.\d+)?$/.test(bare)) {
    const n = Number(bare);
    if (!isFinite(n)) return { value: null, qualitative: null, suppressed: null };
    return { value: n, qualitative: null, suppressed: n < SUPPRESSION_THRESHOLD };
  }

  return { value: null, qualitative: cleaned.toUpperCase(), suppressed: null };
}

export function parseSex(v: unknown): 'M' | 'F' | null {
  const s = parseMissing(v);
  if (s === null) return null;
  const k = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['m', 'male', '1', 'man', 'boy'].includes(k)) return 'M';
  if (['f', 'female', '2', 'woman', 'girl'].includes(k)) return 'F';
  return null;
}

const DRUG_SYNONYMS: Record<string, string> = {
  tdf: 'TDF', taf: 'TAF', '3tc': '3TC', ftc: 'FTC', dtg: 'DTG', efv: 'EFV',
  efv400: 'EFV400', efv600: 'EFV600', nvp: 'NVP', abc: 'ABC', azt: 'AZT',
  zdv: 'AZT', d4t: 'd4T', ddi: 'ddI', lpvr: 'LPV/r', lpv: 'LPV/r',
  atvr: 'ATV/r', atv: 'ATV/r', drvr: 'DRV/r', drv: 'DRV/r', ral: 'RAL',
};

const THIRD_LINE = new Set(['DRV/r', 'RAL']);
const SECOND_LINE = new Set(['LPV/r', 'ATV/r']);
const FIRST_LINE = new Set(['DTG', 'EFV', 'EFV400', 'EFV600', 'NVP']);

export function parseRegimen(v: unknown): { canonical: string; line: '1st' | '2nd' | '3rd' | null } {
  const s = parseMissing(v);
  if (s === null) return { canonical: '', line: null };

  const trimmed = s.trim();
  const code = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');

  const ndr = code.match(/^([1-9])([a-z]{1,2})$/);
  if (ndr) {
    const group = Number(ndr[1]);
    const line: '1st' | '2nd' | '3rd' | null =
      group === 1 || group === 4 ? '1st' : group === 2 || group === 5 ? '2nd' : group === 3 ? '3rd' : null;
    return { canonical: trimmed.toUpperCase(), line };
  }

  if (code === 'tld') return { canonical: 'TDF/3TC/DTG', line: '1st' };
  if (code === 'tle') return { canonical: 'TDF/3TC/EFV', line: '1st' };
  if (code === 'tle400') return { canonical: 'TDF/3TC/EFV400', line: '1st' };
  if (code === 'ald' || code === 'abcld') return { canonical: 'ABC/3TC/DTG', line: '1st' };

  const parts = trimmed
    .split(/[/+\-\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const k = p.toLowerCase().replace(/[^a-z0-9]/g, '');
      return DRUG_SYNONYMS[k] ?? p.toUpperCase();
    })
    .filter((p) => p !== 'R')
    .filter((p, i, arr) => arr.indexOf(p) === i);

  if (parts.length === 0) return { canonical: trimmed.toUpperCase(), line: null };

  const canonical = parts.join('/');
  let line: '1st' | '2nd' | '3rd' | null = null;
  if (parts.some((p) => THIRD_LINE.has(p))) line = '3rd';
  else if (parts.some((p) => SECOND_LINE.has(p))) line = '2nd';
  else if (parts.some((p) => FIRST_LINE.has(p))) line = '1st';

  return { canonical, line };
}

export function parseYesNo(v: unknown): boolean | null {
  const s = parseMissing(v);
  if (s === null) return null;
  const raw = s.trim();
  if (raw === '✔' || raw === '✓') return true;
  if (raw === '✗' || raw === '×') return false;
  const k = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['yes', 'y', 'true', 't', '1', 'done', 'given', 'positive'].includes(k)) return true;
  if (['no', 'n', 'false', 'f', '0', 'notdone', 'notgiven'].includes(k)) return false;
  return null;
}

export function parseResult(v: unknown): 'positive' | 'negative' | 'indeterminate' | null {
  const s = parseMissing(v);
  if (s === null) return null;
  const raw = s.trim();
  if (raw === '+') return 'positive';
  const k = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['positive', 'pos', 'p', 'reactive', 'r', '1', 'detected', 'hivpositive'].includes(k)) return 'positive';
  if (['negative', 'neg', 'n', 'nonreactive', 'nr', '0', 'notdetected', 'hivnegative'].includes(k)) return 'negative';
  if (['indeterminate', 'invalid', 'equivocal', 'inconclusive', 'ind'].includes(k)) return 'indeterminate';
  return null;
}

export function parseNumber(v: unknown): number | null {
  const s = parseMissing(v);
  if (s === null) return null;
  const stripped = s.replace(/,/g, '').replace(/[^\d.-]/g, '');
  if (stripped === '' || stripped === '-' || stripped === '.') return null;
  const n = Number(stripped);
  return isFinite(n) ? n : null;
}

export const AGE_BANDS = [
  '<01', '01-04', '05-09', '10-14', '15-19', '20-24', '25-29',
  '30-34', '35-39', '40-44', '45-49', '50+',
] as const;

export function ageBand(n: number | null): string | null {
  if (n === null || !isFinite(n) || n < 0) return null;
  if (n < 1) return '<01';
  if (n < 5) return '01-04';
  if (n < 10) return '05-09';
  if (n < 15) return '10-14';
  if (n < 20) return '15-19';
  if (n < 25) return '20-24';
  if (n < 30) return '25-29';
  if (n < 35) return '30-34';
  if (n < 40) return '35-39';
  if (n < 45) return '40-44';
  if (n < 50) return '45-49';
  return '50+';
}

export function ageFromDob(dob: Date | null, asOf: Date): number | null {
  if (!dob) return null;
  const days = daysBetween(dob, asOf);
  if (days === null || days < 0) return null;
  return Math.floor(days / 365.25);
}

export function monthsBetween(from: Date | null, to: Date | null): number | null {
  const d = daysBetween(from, to);
  return d === null ? null : d / 30.44;
}

export function median(values: number[]): number | null {
  const sorted = values.filter((v) => isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function fmtDate(d: Date | null): string {
  if (!d) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
