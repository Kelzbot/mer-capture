import {
  ageBand,
  fmtDate,
  parseDate,
  parseMissing,
  parseRegimen,
  parseResult,
  parseSex,
  parseViralLoad,
  parseYesNo,
} from './normalise';
import { autoMap } from './mapper';
import { computeIndicators, txCurr, txPvlsN, type Period } from './indicators';
import { runDQ } from './dq';

let failures = 0;
let checks = 0;

function check(name: string, actual: unknown, expected: unknown) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`);
  }
}

function ok(name: string, condition: boolean) {
  checks++;
  if (!condition) {
    failures++;
    console.error(`FAIL ${name}`);
  }
}

const period: Period = {
  start: new Date(Date.UTC(2026, 3, 1)),
  end: new Date(Date.UTC(2026, 5, 30)),
};

check('parseDate dd/mm/yyyy', fmtDate(parseDate('14/08/2023').date), '2023-08-14');
check('parseDate dd-mm-yyyy', fmtDate(parseDate('14-08-2023').date), '2023-08-14');
check('parseDate dd-MMM-yy', fmtDate(parseDate('14-Aug-23').date), '2023-08-14');
check('parseDate dd-MMM-yyyy', fmtDate(parseDate('14-Aug-2023').date), '2023-08-14');
check('parseDate yyyy-mm-dd', fmtDate(parseDate('2023-08-14').date), '2023-08-14');
check('parseDate ISO datetime', fmtDate(parseDate('2023-08-14T09:30:00Z').date), '2023-08-14');
check('parseDate excel serial', fmtDate(parseDate(45000).date), '2023-03-15');
check('parseDate excel serial as string', fmtDate(parseDate('46162').date), '2026-05-20');
check('parseDate day-first default', fmtDate(parseDate('03/04/2026').date), '2026-04-03');
check('parseDate flags ambiguity', parseDate('03/04/2026').ambiguous, true);
check('parseDate unambiguous when day > 12', parseDate('14/08/2023').ambiguous, false);
check('parseDate rejects invalid', parseDate('13/13/2019').date, null);
check('parseDate missing', parseDate('NA').date, null);

check('parseMissing empty', parseMissing(''), null);
check('parseMissing whitespace', parseMissing('   '), null);
check('parseMissing NA', parseMissing('NA'), null);
check('parseMissing N/A', parseMissing('n/a'), null);
check('parseMissing dash', parseMissing('-'), null);
check('parseMissing double dash', parseMissing('--'), null);
check('parseMissing NULL', parseMissing('NULL'), null);
check('parseMissing NIL', parseMissing('NIL'), null);
check('parseMissing Unknown', parseMissing('Unknown'), null);
check('parseMissing UNK', parseMissing('UNK'), null);
check('parseMissing 999', parseMissing('999'), null);
check('parseMissing 9999', parseMissing(9999), null);
check('parseMissing dot', parseMissing('.'), null);
check('parseMissing question', parseMissing('?'), null);
check('parseMissing keeps value', parseMissing(' 450 '), '450');

check('parseViralLoad TND', parseViralLoad('TND'), { value: null, qualitative: 'TND', suppressed: true });
check('parseViralLoad Target Not Detected', parseViralLoad('Target Not Detected').suppressed, true);
check('parseViralLoad LDL', parseViralLoad('LDL').suppressed, true);
check('parseViralLoad Not Detected', parseViralLoad('Not Detected'), { value: null, qualitative: 'ND', suppressed: true });
check('parseViralLoad BDL', parseViralLoad('BDL').suppressed, true);
check('parseViralLoad Undetectable', parseViralLoad('Undetectable').suppressed, true);
check('parseViralLoad <20', parseViralLoad('<20'), { value: null, qualitative: '<20', suppressed: true });
check('parseViralLoad spaced < 50', parseViralLoad('< 50').suppressed, true);
check('parseViralLoad <400 copies/ml', parseViralLoad('<400 copies/ml'), { value: null, qualitative: '<400', suppressed: true });
check('parseViralLoad comma number', parseViralLoad('1,234'), { value: 1234, qualitative: null, suppressed: false });
check('parseViralLoad suppressed number', parseViralLoad('45').suppressed, true);
check('parseViralLoad blank', parseViralLoad(''), { value: null, qualitative: null, suppressed: null });
ok('parseViralLoad never NaN', !Number.isNaN(parseViralLoad('rubbish').value as number));

check('parseSex M', parseSex('Male'), 'M');
check('parseSex F', parseSex('2'), 'F');
check('parseSex unknown', parseSex('x'), null);

check('parseRegimen TLD', parseRegimen('TLD'), { canonical: 'TDF/3TC/DTG', line: '1st' });
check('parseRegimen NDR 1a', parseRegimen('1a'), { canonical: '1A', line: '1st' });
check('parseRegimen NDR 2e', parseRegimen('2e').line, '2nd');
check('parseRegimen NDR 3a', parseRegimen('3a').line, '3rd');
check('parseRegimen NDR 4a paediatric first', parseRegimen('4a').line, '1st');
check('parseRegimen NDR 5b paediatric second', parseRegimen('5b').line, '2nd');
check('parseRegimen TDF/3TC/DTG', parseRegimen('TDF/3TC/DTG'), { canonical: 'TDF/3TC/DTG', line: '1st' });
check('parseRegimen ABC/3TC/DTG', parseRegimen('ABC/3TC/DTG').canonical, 'ABC/3TC/DTG');
check('parseRegimen AZT/3TC/NVP', parseRegimen('AZT/3TC/NVP'), { canonical: 'AZT/3TC/NVP', line: '1st' });
check('parseRegimen second line', parseRegimen('AZT/3TC/LPV/r').line, '2nd');

check('parseYesNo yes', parseYesNo('Yes'), true);
check('parseYesNo tick', parseYesNo('✔'), true);
check('parseYesNo no', parseYesNo('0'), false);
check('parseYesNo unknown', parseYesNo('maybe'), null);

check('parseResult positive', parseResult('Reactive'), 'positive');
check('parseResult negative', parseResult('NR'), 'negative');
check('parseResult indeterminate', parseResult('Invalid'), 'indeterminate');
check('parseResult plus', parseResult('+'), 'positive');

check('ageBand infant', ageBand(0), '<01');
check('ageBand 4', ageBand(4), '01-04');
check('ageBand 15', ageBand(15), '15-19');
check('ageBand 49', ageBand(49), '45-49');
check('ageBand 50', ageBand(50), '50+');

const currentRow = {
  art_start_date: '2020-01-15',
  visit_date: '2026-01-10',
  next_pickup_date: '2026-06-20',
  months_dispensed: '1',
};
check('TX_CURR uses next_pickup_date not visit_date', txCurr(currentRow, period).status, 'met');
ok('TX_CURR reason cites next_pickup_date', txCurr(currentRow, period).reason.includes('next_pickup_date'));

const staleRow = { art_start_date: '2020-01-15', visit_date: '2026-06-25', next_pickup_date: '2026-04-01' };
check('TX_CURR not met when pickup lapsed', txCurr(staleRow, period).status, 'not_met');

const derivedRow = { art_start_date: '2020-01-15', visit_date: '2026-05-18', months_dispensed: '3' };
check('TX_CURR falls back to visit + MMD', txCurr(derivedRow, period).status, 'met');

const barrenRow = { art_start_date: '2020-01-15' };
check('TX_CURR insufficient without dates', txCurr(barrenRow, period).status, 'insufficient');
ok('TX_CURR insufficient carries a reason', txCurr(barrenRow, period).reason.length > 10);

const tndRow = {
  art_start_date: '2020-01-15',
  next_pickup_date: '2026-06-20',
  viral_load_date: '2026-05-01',
  viral_load_result: 'TND',
};
check('TX_PVLS_N counts TND as suppressed', txPvlsN(tndRow, period).status, 'met');
check('TX_PVLS_N rejects high VL', txPvlsN({ ...tndRow, viral_load_result: '1,450' }, period).status, 'not_met');
check('TX_PVLS_N accepts <20', txPvlsN({ ...tndRow, viral_load_result: '<20' }, period).status, 'met');

const mapAdult = autoMap([
  'Patient ID', 'Sex', 'Age', 'Facility Name', 'ART Start Date', 'Next Pickup Date', 'Viral Load', 'VL Date',
]);
check('autoMap detects adult profile', mapAdult.profile, 'adult_art');
check('autoMap exact alias confidence', mapAdult.confidence.next_pickup_date, 1);
check('autoMap maps viral load', mapAdult.mapping.viral_load_result, 'Viral Load');

const mapEid = autoMap([
  'Patient ID', 'Date of Birth', 'Age (Months)', 'Sample sent from', 'Date Specimen Drawn',
  'Date Specimen Received', 'Date Assay Performed', 'Test Result',
]);
check('autoMap detects EID profile', mapEid.profile, 'eid');
check('autoMap maps infant DOB not adult DOB', mapEid.mapping.infant_dob, 'Date of Birth');

const dqRows = [
  { patient_id: 'A1', facility: 'X', art_start_date: '2019-01-01', date_confirmed_positive: '2020-01-01' },
  { patient_id: 'A1', facility: 'X', art_start_date: '2019-01-01' },
  { patient_id: 'A2', facility: 'X', sex: 'M', pregnancy_status: 'Pregnant' },
];
const dqFlags = runDQ(dqRows, 'adult_art', period);
ok('DQ flags ART before diagnosis', dqFlags.some((f) => f.rule === 'art_before_diagnosis'));
ok('DQ flags duplicate patient id', dqFlags.some((f) => f.rule === 'duplicate_patient_id'));
ok('DQ flags pregnancy on male', dqFlags.some((f) => f.rule === 'pregnancy_on_male' && f.severity === 'critical'));

const report = computeIndicators(
  [
    { patient_id: 'P1', sex: 'F', age: '30', facility: 'X', art_start_date: '2026-05-01', next_pickup_date: '2026-06-20' },
    { patient_id: 'P2', sex: 'M', age: '45', facility: 'X', art_start_date: '2015-05-01', next_pickup_date: '2026-06-20' },
  ],
  period,
  'adult_art',
);
const txNewSummary = report.summaries.find((s) => s.code === 'TX_NEW');
check('TX_NEW numerator', txNewSummary?.numerator, 1);
check('TX_CURR numerator', report.summaries.find((s) => s.code === 'TX_CURR')?.numerator, 2);
ok('disaggregation splits by band', (report.disaggregation.find((d) => d.code === 'TX_CURR')?.rows.length ?? 0) === 2);

const eidReport = computeIndicators(
  [
    {
      patient_id: 'E1',
      sending_facility: 'Y',
      infant_dob: '2026-03-01',
      date_specimen_drawn: '2026-04-15',
      date_specimen_received_lab: '2026-04-19',
      date_assay_performed: '2026-04-23',
      date_result_sent_back: '2026-04-27',
      test_result: 'Positive',
    },
  ],
  period,
  'eid',
);
check('EID 2-month indicator', eidReport.summaries.find((s) => s.code === 'PMTCT_EID_2MO')?.numerator, 1);
check('HEI positive counted', eidReport.summaries.find((s) => s.code === 'PMTCT_HEI_POS')?.numerator, 1);
check('EID transport TAT median', eidReport.tatMedians.transport, 4);
check('EID total TAT median', eidReport.tatMedians.total, 12);

console.log(`${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
