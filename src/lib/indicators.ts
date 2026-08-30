import {
  addDays,
  ageBand,
  ageFromDob,
  daysBetween,
  fmtDate,
  median,
  monthsBetween,
  parseDate,
  parseMissing,
  parseNumber,
  parseResult,
  parseSex,
  parseViralLoad,
  parseYesNo,
} from './normalise';
import type { Profile } from './aliases';

export type Row = Record<string, unknown>;

export type Period = { start: Date; end: Date };

export type IndicatorStatus = 'met' | 'not_met' | 'insufficient';

export type IndicatorResult = {
  code: string;
  label: string;
  status: IndicatorStatus;
  reason: string;
  fields: string[];
  sub?: string;
};

const GRACE_DAYS = 28;

export const INDICATOR_LABELS: Record<string, string> = {
  TX_NEW: 'Newly initiated on ART',
  TX_CURR: 'Currently receiving ART',
  TX_ML: 'No longer on treatment',
  TX_PVLS_D: 'Eligible for viral load (denominator)',
  TX_PVLS_N: 'Virally suppressed (numerator)',
  TB_STAT_D: 'ART patients eligible for TB screening',
  TB_STAT_N: 'TB status documented',
  PMTCT_ART: 'Pregnant women on ART',
  PMTCT_EID_2MO: 'Infant virology test by 2 months',
  PMTCT_EID_2_12MO: 'Infant virology test 2-12 months',
  PMTCT_HEI_POS: 'HIV-infected infants identified',
};

export const PAIRED_DENOMINATOR: Record<string, string> = {
  TX_PVLS_N: 'TX_PVLS_D',
  TB_STAT_N: 'TB_STAT_D',
};

export const ADULT_INDICATORS = [
  'TX_NEW', 'TX_CURR', 'TX_ML', 'TX_PVLS_D', 'TX_PVLS_N', 'TB_STAT_D', 'TB_STAT_N', 'PMTCT_ART',
];

export const EID_INDICATORS = ['PMTCT_EID_2MO', 'PMTCT_EID_2_12MO', 'PMTCT_HEI_POS'];

function result(
  code: string,
  status: IndicatorStatus,
  reason: string,
  fields: string[],
  sub?: string,
): IndicatorResult {
  return { code, label: INDICATOR_LABELS[code] ?? code, status, reason, fields, sub };
}

function inPeriod(d: Date, period: Period): boolean {
  return d.getTime() >= period.start.getTime() && d.getTime() <= period.end.getTime();
}

function currentAt(row: Row, asOf: Date): { current: boolean | null; reason: string } {
  const next = parseDate(row.next_pickup_date).date;
  if (next) {
    const cutoff = addDays(next, GRACE_DAYS);
    return {
      current: cutoff.getTime() >= asOf.getTime(),
      reason: `next_pickup_date ${fmtDate(next)} + ${GRACE_DAYS}d grace = ${fmtDate(cutoff)} vs ${fmtDate(asOf)}`,
    };
  }

  const visit = parseDate(row.visit_date).date;
  const mmd = parseNumber(row.months_dispensed);
  if (visit && mmd !== null && mmd > 0) {
    const derived = addDays(visit, mmd * 30.44 + GRACE_DAYS);
    return {
      current: derived.getTime() >= asOf.getTime(),
      reason: `derived from visit_date ${fmtDate(visit)} + ${mmd}m dispensed + ${GRACE_DAYS}d grace = ${fmtDate(derived)} vs ${fmtDate(asOf)}`,
    };
  }

  return {
    current: null,
    reason: 'no next_pickup_date, and visit_date + months_dispensed not derivable',
  };
}

export function txNew(row: Row, period: Period): IndicatorResult {
  const fields = ['art_start_date'];
  const { date } = parseDate(row.art_start_date);
  if (!date) return result('TX_NEW', 'insufficient', 'art_start_date missing or unparseable', fields);
  if (inPeriod(date, period)) {
    return result('TX_NEW', 'met', `art_start_date ${fmtDate(date)} falls inside reporting period`, fields);
  }
  return result('TX_NEW', 'not_met', `art_start_date ${fmtDate(date)} outside reporting period`, fields);
}

export function txCurr(row: Row, period: Period): IndicatorResult {
  const fields = ['next_pickup_date', 'visit_date', 'months_dispensed'];
  const { current, reason } = currentAt(row, period.end);
  if (current === null) return result('TX_CURR', 'insufficient', reason, fields);
  return result('TX_CURR', current ? 'met' : 'not_met', reason, fields);
}

const ML_PATTERNS: Array<[RegExp, string]> = [
  [/dead|died|death|deceased/i, 'Died'],
  [/transfer|tout|to\b|transitioned/i, 'Transferred out'],
  [/stop|discontinu|refus|opt.?out/i, 'Stopped'],
  [/lost|ltfu|iit|interrupt|defaul|missed/i, 'Interruption in treatment'],
];

export function txMl(row: Row, period: Period): IndicatorResult {
  const fields = ['art_start_date', 'next_pickup_date', 'visit_date', 'current_status'];
  const start = parseDate(row.art_start_date).date;
  if (!start) {
    return result('TX_ML', 'insufficient', 'art_start_date missing, cannot establish activity at period start', fields);
  }
  if (start.getTime() > period.start.getTime()) {
    return result('TX_ML', 'not_met', `ART started ${fmtDate(start)}, after period start — not in the TX_CURR base at period start`, fields);
  }

  const atStart = currentAt(row, period.start);
  const atEnd = currentAt(row, period.end);
  if (atEnd.current === null) {
    return result('TX_ML', 'insufficient', atEnd.reason, fields);
  }

  const statusRaw = parseMissing(row.current_status);
  let sub: string | undefined;
  if (statusRaw) {
    for (const [re, label] of ML_PATTERNS) {
      if (re.test(statusRaw)) {
        sub = label;
        break;
      }
    }
  }

  if (atStart.current === false) {
    return result('TX_ML', 'not_met', `already not current at period start (${atStart.reason})`, fields);
  }

  if (atEnd.current === false) {
    const classification = sub ?? (statusRaw ? `Unclassified status "${statusRaw}"` : 'Interruption in treatment (no status recorded)');
    return result(
      'TX_ML',
      'met',
      `active at period start but not at period end (${atEnd.reason}); classified as ${classification}`,
      fields,
      sub ?? 'Interruption in treatment',
    );
  }

  return result('TX_ML', 'not_met', `still current at period end (${atEnd.reason})`, fields);
}

export function txPvlsD(row: Row, period: Period): IndicatorResult {
  const fields = ['art_start_date', 'viral_load_date'];
  const start = parseDate(row.art_start_date).date;
  if (!start) return result('TX_PVLS_D', 'insufficient', 'art_start_date missing, cannot confirm 3 months on ART', fields);

  const months = monthsBetween(start, period.end);
  if (months === null || months < 3) {
    return result('TX_PVLS_D', 'not_met', `on ART ${months === null ? 'unknown' : months.toFixed(1)} months at period end, under the 3-month threshold`, fields);
  }

  const vlDate = parseDate(row.viral_load_date).date;
  if (!vlDate) {
    return result('TX_PVLS_D', 'not_met', 'no viral_load_date, so no documented VL in the 12 months to period end', fields);
  }

  const age = daysBetween(vlDate, period.end);
  if (age === null || age < 0 || age > 365) {
    return result('TX_PVLS_D', 'not_met', `viral_load_date ${fmtDate(vlDate)} is not within 12 months before period end`, fields);
  }

  return result('TX_PVLS_D', 'met', `on ART ${months.toFixed(1)} months and VL dated ${fmtDate(vlDate)} (${age}d before period end)`, fields);
}

export function txPvlsN(row: Row, period: Period): IndicatorResult {
  const fields = ['art_start_date', 'viral_load_date', 'viral_load_result'];
  const denom = txPvlsD(row, period);
  if (denom.status !== 'met') {
    return result('TX_PVLS_N', denom.status === 'insufficient' ? 'insufficient' : 'not_met', `not in TX_PVLS_D: ${denom.reason}`, fields);
  }

  const vl = parseViralLoad(row.viral_load_result);
  if (vl.suppressed === null) {
    return result('TX_PVLS_N', 'insufficient', `viral_load_result not interpretable (raw "${String(row.viral_load_result ?? '')}")`, fields);
  }

  const shown = vl.qualitative ?? String(vl.value);
  return result(
    'TX_PVLS_N',
    vl.suppressed ? 'met' : 'not_met',
    `VL "${shown}" ${vl.suppressed ? 'is' : 'is not'} suppressed (<1000 copies/ml)`,
    fields,
  );
}

export function tbStatD(row: Row, period: Period): IndicatorResult {
  const fields = ['art_start_date', 'next_pickup_date', 'visit_date'];
  const isNew = txNew(row, period);
  const isCurr = txCurr(row, period);
  if (isNew.status === 'met' || isCurr.status === 'met') {
    return result('TB_STAT_D', 'met', isNew.status === 'met' ? 'in TX_NEW for the period' : 'in TX_CURR at period end', fields);
  }
  if (isNew.status === 'insufficient' && isCurr.status === 'insufficient') {
    return result('TB_STAT_D', 'insufficient', `neither TX_NEW nor TX_CURR evaluable: ${isCurr.reason}`, fields);
  }
  return result('TB_STAT_D', 'not_met', 'not in TX_NEW or TX_CURR for the period', fields);
}

export function tbStatN(row: Row, period: Period): IndicatorResult {
  const fields = ['tb_screen_result'];
  const denom = tbStatD(row, period);
  if (denom.status !== 'met') {
    return result('TB_STAT_N', denom.status === 'insufficient' ? 'insufficient' : 'not_met', `not in TB_STAT_D: ${denom.reason}`, fields);
  }
  const screen = parseMissing(row.tb_screen_result);
  if (!screen) return result('TB_STAT_N', 'not_met', 'no TB screen result documented', fields);
  return result('TB_STAT_N', 'met', `TB screen documented as "${screen}"`, fields);
}

export function pmtctArt(row: Row, period: Period): IndicatorResult {
  const fields = ['pregnancy_status', 'art_start_date', 'next_pickup_date'];
  const rawPreg = parseMissing(row.pregnancy_status);
  if (!rawPreg) {
    if (parseSex(row.sex) === 'M') {
      return result('PMTCT_ART', 'not_met', 'male record — not eligible for PMTCT', fields);
    }
    return result('PMTCT_ART', 'insufficient', 'pregnancy_status missing', fields);
  }

  const pregnant = parseYesNo(rawPreg) ?? (/pregnan|anc|gravid/i.test(rawPreg) && !/not|non/i.test(rawPreg) ? true : null);
  if (pregnant === null) {
    return result('PMTCT_ART', 'insufficient', `pregnancy_status "${rawPreg}" not interpretable`, fields);
  }
  if (!pregnant) return result('PMTCT_ART', 'not_met', `pregnancy_status "${rawPreg}" is not pregnant`, fields);

  const sex = parseSex(row.sex);
  if (sex === 'M') {
    return result('PMTCT_ART', 'insufficient', 'pregnancy recorded against a male record — excluded pending correction', fields);
  }

  const start = parseDate(row.art_start_date).date;
  const curr = txCurr(row, period);
  if (curr.status === 'met' || (start && start.getTime() <= period.end.getTime())) {
    return result('PMTCT_ART', 'met', `pregnant and on ART (${curr.status === 'met' ? curr.reason : `ART started ${fmtDate(start)}`})`, fields);
  }
  if (curr.status === 'insufficient' && !start) {
    return result('PMTCT_ART', 'insufficient', `pregnant but ART status not derivable: ${curr.reason}`, fields);
  }
  return result('PMTCT_ART', 'not_met', `pregnant but not on ART at period end: ${curr.reason}`, fields);
}

function infantAgeMonthsAtDraw(row: Row): { months: number | null; reason: string } {
  const drawn = parseDate(row.date_specimen_drawn).date;
  const dob = parseDate(row.infant_dob).date;
  if (drawn && dob) {
    const m = monthsBetween(dob, drawn);
    if (m !== null && m >= 0) {
      return { months: m, reason: `age at draw ${m.toFixed(1)}m from DOB ${fmtDate(dob)} and draw ${fmtDate(drawn)}` };
    }
  }
  const stated = parseNumber(row.age_months);
  if (stated !== null && stated >= 0) {
    return { months: stated, reason: `age_months ${stated} taken from the record (DOB/draw date not usable)` };
  }
  return { months: null, reason: 'neither DOB + specimen draw date nor age_months available' };
}

export function eid2mo(row: Row, period: Period): IndicatorResult {
  const fields = ['date_specimen_drawn', 'infant_dob', 'age_months'];
  const drawn = parseDate(row.date_specimen_drawn).date;
  if (!drawn) return result('PMTCT_EID_2MO', 'insufficient', 'date_specimen_drawn missing or unparseable', fields);
  if (!inPeriod(drawn, period)) {
    return result('PMTCT_EID_2MO', 'not_met', `specimen drawn ${fmtDate(drawn)}, outside reporting period`, fields);
  }
  const { months, reason } = infantAgeMonthsAtDraw(row);
  if (months === null) return result('PMTCT_EID_2MO', 'insufficient', reason, fields);
  return result('PMTCT_EID_2MO', months <= 2 ? 'met' : 'not_met', reason, fields);
}

export function eid2to12mo(row: Row, period: Period): IndicatorResult {
  const fields = ['date_specimen_drawn', 'infant_dob', 'age_months'];
  const drawn = parseDate(row.date_specimen_drawn).date;
  if (!drawn) return result('PMTCT_EID_2_12MO', 'insufficient', 'date_specimen_drawn missing or unparseable', fields);
  if (!inPeriod(drawn, period)) {
    return result('PMTCT_EID_2_12MO', 'not_met', `specimen drawn ${fmtDate(drawn)}, outside reporting period`, fields);
  }
  const { months, reason } = infantAgeMonthsAtDraw(row);
  if (months === null) return result('PMTCT_EID_2_12MO', 'insufficient', reason, fields);
  return result('PMTCT_EID_2_12MO', months > 2 && months <= 12 ? 'met' : 'not_met', reason, fields);
}

export function heiPos(row: Row, period: Period): IndicatorResult {
  const fields = ['test_result', 'date_specimen_drawn'];
  const drawn = parseDate(row.date_specimen_drawn).date;
  if (drawn && !inPeriod(drawn, period)) {
    return result('PMTCT_HEI_POS', 'not_met', `specimen drawn ${fmtDate(drawn)}, outside reporting period`, fields);
  }
  const res = parseResult(row.test_result);
  if (res === null) {
    return result('PMTCT_HEI_POS', 'insufficient', `test_result "${String(row.test_result ?? '')}" missing or not interpretable`, fields);
  }
  return result('PMTCT_HEI_POS', res === 'positive' ? 'met' : 'not_met', `PCR result recorded as ${res}`, fields);
}

export type Tat = {
  transport: number | null;
  lab: number | null;
  return: number | null;
  total: number | null;
};

export function recordTat(row: Row): Tat {
  const drawn = parseDate(row.date_specimen_drawn).date;
  const received = parseDate(row.date_specimen_received_lab).date;
  const assay = parseDate(row.date_assay_performed).date;
  const sent = parseDate(row.date_result_sent_back).date;
  const positive = (n: number | null) => (n === null || n < 0 ? null : n);
  return {
    transport: positive(daysBetween(drawn, received)),
    lab: positive(daysBetween(received, assay)),
    return: positive(daysBetween(assay, sent)),
    total: positive(daysBetween(drawn, sent)),
  };
}

export type IndicatorSummary = {
  code: string;
  label: string;
  numerator: number;
  denominator: number;
  denominatorSource: string;
  percentage: number | null;
  insufficient: number;
  insufficientReasons: Array<{ reason: string; count: number }>;
  subBreakdown: Array<{ label: string; count: number }>;
};

export type EvaluatedRow = {
  row: Row;
  patientId: string;
  facility: string;
  sex: 'M' | 'F' | null;
  band: string | null;
  results: Record<string, IndicatorResult>;
  tat: Tat | null;
};

export type Disaggregation = {
  code: string;
  rows: Array<{ band: string; male: number; female: number; unknown: number; total: number }>;
};

export type IndicatorReport = {
  profile: Profile;
  period: Period;
  evaluated: EvaluatedRow[];
  summaries: IndicatorSummary[];
  disaggregation: Disaggregation[];
  tatMedians: { transport: number | null; lab: number | null; return: number | null; total: number | null };
  tatCounts: { transport: number; lab: number; return: number; total: number };
};

const ADULT_FNS: Record<string, (r: Row, p: Period) => IndicatorResult> = {
  TX_NEW: txNew,
  TX_CURR: txCurr,
  TX_ML: txMl,
  TX_PVLS_D: txPvlsD,
  TX_PVLS_N: txPvlsN,
  TB_STAT_D: tbStatD,
  TB_STAT_N: tbStatN,
  PMTCT_ART: pmtctArt,
};

const EID_FNS: Record<string, (r: Row, p: Period) => IndicatorResult> = {
  PMTCT_EID_2MO: eid2mo,
  PMTCT_EID_2_12MO: eid2to12mo,
  PMTCT_HEI_POS: heiPos,
};

function rowBand(row: Row, profile: Profile, period: Period): string | null {
  if (profile === 'eid') {
    const dob = parseDate(row.infant_dob).date;
    const stated = parseNumber(row.age_months);
    const drawn = parseDate(row.date_specimen_drawn).date;
    const months = dob && drawn ? monthsBetween(dob, drawn) : stated;
    if (months === null || months < 0) return null;
    return ageBand(months / 12);
  }
  const stated = parseNumber(row.age);
  if (stated !== null) return ageBand(stated);
  return ageBand(ageFromDob(parseDate(row.date_of_birth).date, period.end));
}

export function computeIndicators(rows: Row[], period: Period, profile: Profile): IndicatorReport {
  const fns = profile === 'eid' ? EID_FNS : ADULT_FNS;
  const codes = profile === 'eid' ? EID_INDICATORS : ADULT_INDICATORS;

  const evaluated: EvaluatedRow[] = rows.map((row, i) => {
    const results: Record<string, IndicatorResult> = {};
    for (const code of codes) results[code] = fns[code](row, period);
    return {
      row,
      patientId: parseMissing(row.patient_id) ?? `row-${i + 1}`,
      facility: parseMissing(profile === 'eid' ? row.sending_facility : row.facility) ?? 'Unspecified facility',
      sex: parseSex(row.sex),
      band: rowBand(row, profile, period),
      results,
      tat: profile === 'eid' ? recordTat(row) : null,
    };
  });

  const summaries: IndicatorSummary[] = codes.map((code) => {
    const all = evaluated.map((e) => e.results[code]);
    const numerator = all.filter((r) => r.status === 'met').length;
    const insufficient = all.filter((r) => r.status === 'insufficient');

    const pairedCode = PAIRED_DENOMINATOR[code];
    let denominator: number;
    let denominatorSource: string;
    if (pairedCode) {
      denominator = evaluated.filter((e) => e.results[pairedCode].status === 'met').length;
      denominatorSource = pairedCode;
    } else {
      denominator = all.filter((r) => r.status !== 'insufficient').length;
      denominatorSource = 'Evaluable records';
    }

    const reasonCounts = new Map<string, number>();
    for (const r of insufficient) {
      const key = r.reason.replace(/\d{4}-\d{2}-\d{2}/g, 'date').replace(/"[^"]*"/g, '"value"');
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }

    const subCounts = new Map<string, number>();
    for (const r of all) {
      if (r.status === 'met' && r.sub) subCounts.set(r.sub, (subCounts.get(r.sub) ?? 0) + 1);
    }

    return {
      code,
      label: INDICATOR_LABELS[code] ?? code,
      numerator,
      denominator,
      denominatorSource,
      percentage: denominator > 0 ? (numerator / denominator) * 100 : null,
      insufficient: insufficient.length,
      insufficientReasons: [...reasonCounts.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      subBreakdown: [...subCounts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
    };
  });

  const disaggregation: Disaggregation[] = codes.map((code) => {
    const byBand = new Map<string, { male: number; female: number; unknown: number }>();
    for (const e of evaluated) {
      if (e.results[code].status !== 'met') continue;
      const band = e.band ?? 'Unknown';
      const bucket = byBand.get(band) ?? { male: 0, female: 0, unknown: 0 };
      if (e.sex === 'M') bucket.male++;
      else if (e.sex === 'F') bucket.female++;
      else bucket.unknown++;
      byBand.set(band, bucket);
    }
    return {
      code,
      rows: [...byBand.entries()]
        .map(([band, b]) => ({ band, ...b, total: b.male + b.female + b.unknown }))
        .sort((a, b) => a.band.localeCompare(b.band)),
    };
  });

  const legs = ['transport', 'lab', 'return', 'total'] as const;
  const tatMedians = { transport: null, lab: null, return: null, total: null } as IndicatorReport['tatMedians'];
  const tatCounts = { transport: 0, lab: 0, return: 0, total: 0 };
  for (const leg of legs) {
    const values = evaluated
      .map((e) => e.tat?.[leg])
      .filter((v): v is number => typeof v === 'number');
    tatMedians[leg] = median(values);
    tatCounts[leg] = values.length;
  }

  return { profile, period, evaluated, summaries, disaggregation, tatMedians, tatCounts };
}
