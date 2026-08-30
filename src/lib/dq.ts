import {
  addDays,
  daysBetween,
  fmtDate,
  parseDate,
  parseMissing,
  parseNumber,
  parseRegimen,
  parseResult,
  parseSex,
  parseViralLoad,
  parseYesNo,
  ageFromDob,
  monthsBetween,
} from './normalise';
import type { Profile } from './aliases';
import type { Period, Row } from './indicators';

export type Severity = 'critical' | 'warning';

export type DQFlag = {
  severity: Severity;
  patient_id: string;
  rule: string;
  message: string;
  facility: string;
};

export type FacilityScore = {
  facility: string;
  records: number;
  clean: number;
  critical: number;
  warning: number;
  score: number;
};

const ART_ERA_START = Date.UTC(2002, 0, 1);

function idOf(row: Row, index: number): string {
  return parseMissing(row.patient_id) ?? `row-${index + 1}`;
}

function facilityOf(row: Row, profile: Profile): string {
  return parseMissing(profile === 'eid' ? row.sending_facility : row.facility) ?? 'Unspecified facility';
}

function adultFlags(row: Row, id: string, facility: string, period: Period): DQFlag[] {
  const out: DQFlag[] = [];
  const push = (severity: Severity, rule: string, message: string) =>
    out.push({ severity, patient_id: id, rule, message, facility });

  const artStart = parseDate(row.art_start_date).date;
  const confirmed = parseDate(row.date_confirmed_positive).date;
  const visit = parseDate(row.visit_date).date;
  const nextPickup = parseDate(row.next_pickup_date).date;
  const vlDate = parseDate(row.viral_load_date).date;
  const dob = parseDate(row.date_of_birth).date;

  if (artStart && confirmed && artStart.getTime() < confirmed.getTime()) {
    push('critical', 'art_before_diagnosis', `ART started ${fmtDate(artStart)} before HIV confirmation ${fmtDate(confirmed)}`);
  }

  if (artStart && artStart.getTime() < ART_ERA_START) {
    push('critical', 'art_start_implausible', `ART start ${fmtDate(artStart)} predates the national ART programme (2002)`);
  }

  if (nextPickup && visit && nextPickup.getTime() < visit.getTime()) {
    push('critical', 'pickup_before_visit', `next pickup ${fmtDate(nextPickup)} is before the visit date ${fmtDate(visit)}`);
  }

  if (vlDate && artStart && vlDate.getTime() < artStart.getTime()) {
    push('critical', 'vl_before_art', `VL dated ${fmtDate(vlDate)} precedes ART start ${fmtDate(artStart)}`);
  }

  const vl = parseViralLoad(row.viral_load_result);
  if ((vl.value !== null || vl.qualitative !== null) && !vlDate) {
    push('warning', 'vl_without_date', `VL result "${vl.qualitative ?? vl.value}" recorded with no VL date`);
  }

  const sex = parseSex(row.sex);
  const pregRaw = parseMissing(row.pregnancy_status);
  const pregnant = pregRaw ? (parseYesNo(pregRaw) ?? (/pregnan|anc|gravid/i.test(pregRaw) && !/not|non/i.test(pregRaw))) : null;
  if (sex === 'M' && pregnant === true) {
    push('critical', 'pregnancy_on_male', `pregnancy recorded as "${pregRaw}" on a male record`);
  }

  const regimen = parseRegimen(row.current_regimen);
  if (artStart && !regimen.canonical) {
    push('warning', 'art_without_regimen', `ART start ${fmtDate(artStart)} recorded but no current regimen`);
  }

  const age = parseNumber(row.age);
  if (age !== null && (age < 0 || age > 120)) {
    push('critical', 'age_out_of_range', `age recorded as ${age}`);
  }

  if (age !== null && dob) {
    const derived = ageFromDob(dob, period.end);
    if (derived !== null && Math.abs(derived - age) > 1) {
      push('warning', 'age_dob_mismatch', `age ${age} conflicts with DOB ${fmtDate(dob)} (implies ${derived})`);
    }
  }

  const today = new Date();
  if (visit && visit.getTime() > today.getTime()) {
    push('critical', 'visit_in_future', `visit date ${fmtDate(visit)} is in the future`);
  }

  const mmd = parseNumber(row.months_dispensed);
  if (mmd !== null && (mmd > 6 || mmd <= 0)) {
    push('warning', 'mmd_out_of_range', `months dispensed recorded as ${mmd}`);
  }

  const who = parseNumber(row.who_stage);
  const whoRaw = parseMissing(row.who_stage);
  if (whoRaw && (who === null || who < 1 || who > 4)) {
    const roman = /^(i{1,3}|iv)$/i.test(whoRaw.trim());
    if (!roman) push('warning', 'who_stage_invalid', `WHO stage "${whoRaw}" is outside stages 1-4`);
  }

  const statusRaw = parseMissing(row.current_status);
  const activeStatus = statusRaw ? /active|current|on art|alive/i.test(statusRaw) : false;
  if (activeStatus && nextPickup && addDays(nextPickup, 28).getTime() < period.end.getTime()) {
    const late = daysBetween(nextPickup, period.end);
    push('warning', 'active_but_overdue', `status "${statusRaw}" but next pickup ${fmtDate(nextPickup)} is ${late} days before period end`);
  }

  return out;
}

function eidFlags(row: Row, id: string, facility: string, period: Period): DQFlag[] {
  const out: DQFlag[] = [];
  const push = (severity: Severity, rule: string, message: string) =>
    out.push({ severity, patient_id: id, rule, message, facility });

  const dob = parseDate(row.infant_dob).date;
  const drawn = parseDate(row.date_specimen_drawn).date;
  const received = parseDate(row.date_specimen_received_lab).date;
  const assay = parseDate(row.date_assay_performed).date;
  const sent = parseDate(row.date_result_sent_back).date;
  const result = parseResult(row.test_result);
  const testable = parseYesNo(row.sample_testable);

  if (sent && assay && sent.getTime() < assay.getTime()) {
    push('critical', 'result_before_assay', `result sent ${fmtDate(sent)} before assay performed ${fmtDate(assay)}`);
  }

  if (assay && received && assay.getTime() < received.getTime()) {
    push('critical', 'assay_before_receipt', `assay ${fmtDate(assay)} before lab receipt ${fmtDate(received)}`);
  }

  if (received && drawn && received.getTime() < drawn.getTime()) {
    push('critical', 'receipt_before_draw', `lab receipt ${fmtDate(received)} before specimen drawn ${fmtDate(drawn)}`);
  }

  if (testable === false && result !== null) {
    push('critical', 'untestable_with_result', `sample marked not testable but a ${result} result is recorded`);
  }

  const stated = parseNumber(row.age_months);
  if (stated !== null && dob && drawn) {
    const derived = monthsBetween(dob, drawn);
    if (derived !== null && Math.abs(derived - stated) > 1) {
      push('warning', 'age_months_mismatch', `age_months ${stated} conflicts with DOB ${fmtDate(dob)} and draw ${fmtDate(drawn)} (implies ${derived.toFixed(1)})`);
    }
  }

  const ageMonths = dob && drawn ? monthsBetween(dob, drawn) : stated;
  const rapid = parseYesNo(row.rapid_test_done);
  if (ageMonths !== null && ageMonths > 9 && rapid !== true) {
    push('warning', 'no_rapid_test', `infant ${ageMonths.toFixed(1)} months at draw with no rapid test recorded`);
  }

  if (result === 'positive' && !sent) {
    push('critical', 'positive_no_linkage', 'positive PCR result with no result-return date — linkage to treatment cannot be confirmed');
  }

  if (drawn && dob && drawn.getTime() < dob.getTime()) {
    push('critical', 'draw_before_birth', `specimen drawn ${fmtDate(drawn)} before infant DOB ${fmtDate(dob)}`);
  }

  const total = daysBetween(drawn, sent);
  if (total !== null && total > 60) {
    push('critical', 'tat_over_60', `total turnaround ${total} days from draw to result return`);
  } else if (total !== null && total > 30) {
    push('warning', 'tat_over_30', `total turnaround ${total} days from draw to result return`);
  }

  if (assay && !sent) {
    const stuck = daysBetween(assay, period.end);
    if (stuck !== null && stuck > 14) {
      push('critical', 'result_stuck_at_lab', `assay performed ${fmtDate(assay)} (${stuck} days before period end) with no result dispatched`);
    }
  }

  return out;
}

export function detectProfile(rows: Row[]): Profile {
  if (rows.length === 0) return 'adult_art';
  const first = rows[0];
  return 'date_specimen_drawn' in first || 'test_result' in first || 'age_months' in first ? 'eid' : 'adult_art';
}

function defaultPeriod(): Period {
  const now = new Date();
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)),
  };
}

export function runDQ(rows: Row[], profile?: Profile, period?: Period): DQFlag[] {
  const prof = profile ?? detectProfile(rows);
  const per = period ?? defaultPeriod();
  const flags: DQFlag[] = [];

  const seen = new Map<string, number>();
  rows.forEach((row, i) => {
    const id = idOf(row, i);
    const facility = facilityOf(row, prof);
    const explicit = parseMissing(row.patient_id);
    if (explicit) seen.set(explicit, (seen.get(explicit) ?? 0) + 1);
    flags.push(...(prof === 'eid' ? eidFlags(row, id, facility, per) : adultFlags(row, id, facility, per)));
  });

  rows.forEach((row, i) => {
    const explicit = parseMissing(row.patient_id);
    if (explicit && (seen.get(explicit) ?? 0) > 1) {
      flags.push({
        severity: 'critical',
        patient_id: explicit,
        rule: 'duplicate_patient_id',
        message: `patient ID appears ${seen.get(explicit)} times in this file`,
        facility: facilityOf(row, prof),
      });
    } else if (!explicit) {
      flags.push({
        severity: 'critical',
        patient_id: idOf(row, i),
        rule: 'missing_patient_id',
        message: 'no patient identifier on this record',
        facility: facilityOf(row, prof),
      });
    }
  });

  return flags;
}

export function facilityScore(rows: Row[], flags?: DQFlag[], profile?: Profile, period?: Period): FacilityScore[] {
  const prof = profile ?? detectProfile(rows);
  const all = flags ?? runDQ(rows, prof, period);

  const criticalIds = new Map<string, Set<string>>();
  const counts = new Map<string, { critical: number; warning: number }>();
  for (const f of all) {
    const bucket = counts.get(f.facility) ?? { critical: 0, warning: 0 };
    if (f.severity === 'critical') {
      bucket.critical++;
      const set = criticalIds.get(f.facility) ?? new Set<string>();
      set.add(f.patient_id);
      criticalIds.set(f.facility, set);
    } else {
      bucket.warning++;
    }
    counts.set(f.facility, bucket);
  }

  const byFacility = new Map<string, number>();
  const idsByFacility = new Map<string, string[]>();
  rows.forEach((row, i) => {
    const facility = facilityOf(row, prof);
    byFacility.set(facility, (byFacility.get(facility) ?? 0) + 1);
    const list = idsByFacility.get(facility) ?? [];
    list.push(idOf(row, i));
    idsByFacility.set(facility, list);
  });

  return [...byFacility.entries()]
    .map(([facility, records]) => {
      const dirty = criticalIds.get(facility) ?? new Set<string>();
      const ids = idsByFacility.get(facility) ?? [];
      const clean = ids.filter((id) => !dirty.has(id)).length;
      const c = counts.get(facility) ?? { critical: 0, warning: 0 };
      return {
        facility,
        records,
        clean,
        critical: c.critical,
        warning: c.warning,
        score: records > 0 ? (clean / records) * 100 : 0,
      };
    })
    .sort((a, b) => a.score - b.score);
}
