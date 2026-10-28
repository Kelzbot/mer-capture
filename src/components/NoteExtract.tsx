import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Loader, ShieldCheck, Sparkles } from 'lucide-react';
import Capture from './Capture';
import { FIELD_LABELS, type Profile } from '../lib/aliases';
import { extractNote, PROVIDER_LABELS, type ExtractionResult, type Provider, type SourceKind } from '../lib/extract';
import { redactionCounts } from '../lib/deidentify';
import { computeIndicators, type Period } from '../lib/indicators';
import { runDQ } from '../lib/dq';
import { computeDocQuality, type DocFields } from '../lib/docQuality';

type Props = {
  apiKey: string;
  provider: Provider;
  period: Period;
};

const SECTIONS: Record<Profile, Array<{ title: string; fields: string[] }>> = {
  adult_art: [
    { title: 'Identification', fields: ['patient_id', 'sex', 'age', 'date_of_birth', 'facility', 'datim_code', 'state', 'lga'] },
    { title: 'Treatment', fields: ['date_confirmed_positive', 'art_start_date', 'current_regimen', 'regimen_line', 'visit_date', 'next_pickup_date', 'months_dispensed'] },
    { title: 'Laboratory', fields: ['viral_load_result', 'viral_load_date', 'baseline_cd4'] },
    { title: 'Clinical', fields: ['who_stage', 'weight', 'tb_screen_result', 'pregnancy_status', 'current_status'] },
  ],
  eid: [
    { title: 'Identification', fields: ['patient_id', 'sex', 'infant_dob', 'age_months', 'sending_facility', 'sample_reference_number'] },
    { title: 'Specimen', fields: ['date_specimen_drawn', 'date_specimen_received_lab', 'date_assay_performed', 'date_result_sent_back', 'sample_testable', 'reason_for_pcr'] },
    { title: 'Result', fields: ['test_result', 'rapid_test_done'] },
    { title: 'Mother and infant', fields: ['mother_art_status', 'infant_prophylaxis', 'ever_breastfed', 'currently_breastfeeding', 'cotrimoxazole_given'] },
  ],
  clinical: [
    { title: 'Subjective', fields: ['chief_complaint', 'hpi', 'pmh'] },
    { title: 'Objective', fields: ['exam', 'investigations'] },
    { title: 'Assessment', fields: ['differential', 'final_diagnosis', 'icd10'] },
    { title: 'Plan', fields: ['medications', 'treatment_plan'] },
    { title: 'Structured note', fields: ['soap_note'] },
  ],
  anc: [
    { title: 'Pregnancy', fields: ['lmp', 'edd', 'gestational_age', 'gravida_parity', 'anc_visit_number'] },
    { title: 'Subjective', fields: ['chief_complaint', 'hpi', 'pmh'] },
    { title: 'Objective', fields: ['blood_pressure', 'weight', 'fundal_height', 'fetal_heart_rate', 'exam'] },
    { title: 'Tests', fields: ['haemoglobin', 'urinalysis', 'hiv_status', 'investigations'] },
    { title: 'Assessment', fields: ['differential', 'final_diagnosis', 'icd10'] },
    { title: 'Plan', fields: ['iptp_sp', 'medications', 'treatment_plan', 'next_visit_date'] },
    { title: 'Structured note', fields: ['soap_note'] },
  ],
  ncd: [
    { title: 'Subjective', fields: ['conditions', 'chief_complaint', 'hpi', 'pmh', 'adherence'] },
    { title: 'Objective', fields: ['blood_pressure', 'weight', 'bmi', 'blood_glucose', 'hba1c', 'exam', 'investigations'] },
    { title: 'Assessment', fields: ['complications', 'differential', 'final_diagnosis', 'icd10'] },
    { title: 'Plan', fields: ['medications', 'treatment_plan', 'next_visit_date'] },
    { title: 'Structured note', fields: ['soap_note'] },
  ],
};

const PROFILE_LABELS: Record<Profile, string> = {
  clinical: 'General outpatient',
  anc: 'Antenatal (ANC)',
  ncd: 'Chronic follow-up (HTN, DM…)',
  adult_art: 'HIV — adult ART',
  eid: 'HIV — infant EID',
};

const isHiv = (p: Profile) => p === 'adult_art' || p === 'eid';

const SAMPLE_NOTES: Array<{ label: string; text: string }> = [
  {
    label: 'General — fever in a hypertensive adult',
    text: `General Outpatient Clinic — Consultation
Name: Mr Tunde Bakare    Hosp No: 2231/OPD/26
42yr M, trader. Phone 08061234570
C/O fever and headache x 3 days, body pains, poor appetite. No cough, no diarrhoea.
PMH: hypertensive on amlodipine 5mg daily. NKDA.
O/E: febrile 38.6C, not pale, anicteric. BP 142/90, PR 96. Chest clear. Abdomen soft, non-tender.
mRDT positive. FBC requested.
Impression: uncomplicated malaria. DDx typhoid fever.
Plan: artemether-lumefantrine 80/480mg bd x 3 days, paracetamol 1g tds x 3 days.
Continue amlodipine. Review in 3 days or earlier if worse.`,
  },
  {
    label: 'General — child with cough and fast breathing',
    text: `Paediatric OPD
Baby Amina Yusuf, 3yrs F. Brought by mother.
C/O cough and fast breathing x 2 days, fever since yesterday. Feeding poorly. No vomiting.
Immunisation up to date. Wt 13kg.
O/E: temp 38.9C, RR 48/min, mild subcostal recession. Crackles R lower zone. SpO2 94% on air.
Dx: community-acquired pneumonia.
Rx: amoxicillin 40mg/kg/dose bd x 5 days. Paracetamol 15mg/kg prn.
Counselled mother on danger signs. Review in 48 hours.`,
  },
  {
    label: 'Antenatal — booking visit at 20 weeks',
    text: `ANC Clinic — Booking Visit
Name: Mrs Ngozi Eze    ANC No: 0412/ANC/26
28yr G2P1, LMP 10/06/2026, EDD 17/03/2027, GA 20 weeks.
C/O mild pedal swelling in the evenings. No headache, no blurred vision, no vaginal bleeding.
O/E: BP 118/76, Wt 68kg. SFH 20cm, FHR 144 bpm. Mild pitting oedema both ankles.
PCV 31%. Urinalysis: protein nil, glucose nil. RVS negative.
Impression: normal pregnancy at 20 weeks, mild anaemia.
Plan: IPTp-SP 1st dose given today, ferrous sulphate 200mg daily, folic acid 5mg daily.
Next visit in 4 weeks.`,
  },
  {
    label: 'Chronic — hypertension and diabetes review',
    text: `Medical Outpatient — Follow-up
Name: Alhaji Musa Ibrahim    Hosp No: 0987/MOPD/24
61yr M, known hypertensive x 8 yrs and type 2 diabetic x 5 yrs.
Says he missed his drugs for about 2 weeks last month (ran out). Occasional headache. No chest pain, no leg swelling.
O/E: BP 158/96, Wt 84kg, BMI 29. Feet: no ulcers, sensation intact.
FBS 9.8 mmol/L. HbA1c 8.1%.
Assessment: poorly controlled hypertension and type 2 diabetes, poor adherence.
Plan: continue amlodipine 10mg daily, add lisinopril 10mg daily, continue metformin 1g bd.
Adherence counselling done. Repeat FBS and E/U/Cr. Review in 4 weeks.`,
  },
  {
    label: 'Adult ART — routine follow-up',
    text: `FMC Lakeside — ART Clinic Follow-up
Name: Mrs Adaeze Okonkwo    Hosp No: 038/10/23/OPT
Age 34yrs, Female. Phone 08034567890
Dx confirmed positive 04/02/2019, commenced ART 18/02/2019.
Current regimen TLD, 1st line. MMD 3 months.
Seen today 05/05/2026, next refill due 15/06/2026.
VL sample 12/05/2026 — result TND. Baseline CD4 340.
TB screen: no signs of TB. Not pregnant. WHO stage 1.
Wt 62kg. Status: Active on treatment.`,
  },
  {
    label: 'Adult ART — new initiation from ANC',
    text: `Northgate District Hospital ART/PMTCT
Patient ID: DEMO/NGT/0311   Miss Ngozi Eze, 24yr F
Referred from ANC. HIV confirmed 02-Apr-26 (repeat reactive).
Commenced ART same day 02-Apr-26 on TLD, first line.
ANC status: Pregnant, 22 weeks GA.
Next clinic 04-Jul-26, dispensed 3 months supply.
Baseline CD4 not done. No TB symptoms elicited.
Tel: 0803 445 9921. Booked for viral load at 6 months.`,
  },
  {
    label: 'EID — infant DBS PCR',
    text: `Reference Lab DBS Sample Form — Brookside Cottage Hospital
Baby of Mrs Chiamaka Nwosu. Hospital number 1145/EID/26
Sample Reference Number: RLAB/BRK/23/5298
Infant DOB 15/02/2026, sex F. Age at collection 2 months.
DBS collected 10/04/2026, received at the reference lab 14/04/2026.
Assay run 18-Apr-26. Result dispatched 22/04/2026.
Sample was testable. Reason for PCR: first PCR at 6 weeks.
DNA PCR result: Negative.
Mother on ART during pregnancy — yes. Baby received NVP syrup.
Ever breastfed: yes, still breastfeeding. Cotrimoxazole commenced.
Rapid test not yet done.`,
  },
  {
    label: 'Adult ART — second line, defaulted',
    text: `Millfield General Hosp - ART review
PID: DEMO/MLF/0207 | Alhaji Musa Danjuma | 55 M
On ART since 19-Mar-2014. Switched to 2nd line AZT/3TC/LPV/r.
Last seen 20/05/2026, was due 21/06/2026 but has not come.
Defaulted - 3 missed appointments. Tracking ongoing.
VL 14/05/2026 = 3,400 copies/ml. EAC session 1 done.
WHO stage 3. Weight 66kg.
TB screen - cough more than 2wks, referred for GeneXpert.
Status: IIT (interruption in treatment)
Contact 2348051234567`,
  },
  {
    label: 'Sparse note — little to extract',
    text: `Pt seen at clinic today. Doing well on treatment.
Advised to continue meds and return next month.`,
  },
];

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

function confidenceTone(c: number): string {
  if (c >= 0.8) return 'bg-teal-500';
  if (c >= 0.5) return 'bg-amber-500';
  return 'bg-rose-500';
}

function statusTone(status: string): string {
  if (status === 'met') return 'border-teal-500 text-teal-700 bg-teal-50';
  if (status === 'not_met') return 'border-slate-300 text-slate-600 bg-slate-50';
  return 'border-amber-400 text-amber-700 bg-amber-50';
}

export default function NoteExtract({ apiKey, provider, period }: Props) {
  const [noteText, setNoteText] = useState(SAMPLE_NOTES[0].text);
  const [noteKind, setNoteKind] = useState<SourceKind>('note');
  const [type, setType] = useState<Profile | 'auto'>('auto');
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [hovered, setHovered] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTransmitted, setShowTransmitted] = useState(false);
  const [clinician, setClinician] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const row = useMemo(() => {
    if (!result) return null;
    const out: Record<string, unknown> = {};
    for (const [field, extraction] of Object.entries(result.fields)) {
      const value = edits[field] ?? extraction.value;
      if (value !== '') out[field] = value;
    }
    return out;
  }, [result, edits]);

  const analysis = useMemo(() => {
    if (!result || !row) return null;
    // Programme indicators only mean something for HIV records; a general consultation
    // gets the documentation-quality rules instead.
    if (!isHiv(result.profile)) {
      return {
        results: {},
        flags: computeDocQuality([{ recordId: 'This note', fields: row as DocFields }]).flags,
      };
    }
    const report = computeIndicators([row], period, result.profile);
    return {
      results: report.evaluated[0]?.results ?? {},
      flags: runDQ([row], result.profile, period),
    };
  }, [result, row, period]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const extracted = await extractNote(
        noteText,
        apiKey,
        provider,
        undefined,
        noteKind,
        type === 'auto' ? undefined : type,
      );
      setResult(extracted);
      setSourceText(noteText);
      setEdits({});
      setHovered(null);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const highlight = hovered ? result?.fields[hovered]?.span ?? null : null;

  const exportRecord = () => {
    if (!result || !row) return;
    const fields = Object.keys(result.fields);
    download(`note_extract_${result.profile}.csv`, [
      ['field', 'value', 'confidence', 'source_span'],
      ...fields.map((f) => [
        f,
        String(row[f] ?? ''),
        result.fields[f].confidence.toFixed(2),
        result.fields[f].source_span,
      ]),
      [],
      ['reviewed_by', clinician],
      ['reviewed_at', new Date().toISOString()],
      ['provider', `${PROVIDER_LABELS[result.transmitted.provider]} (${result.transmitted.model})`],
    ]);
  };

  const counts = result ? redactionCounts(result.transmitted.entries) : null;
  const sections = result ? SECTIONS[result.profile] : [];
  const listed = new Set(sections.flatMap((s) => s.fields));
  const extras = result ? Object.keys(result.fields).filter((f) => !listed.has(f)) : [];

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold tracking-tight text-slate-900">Consultation</h2>
            <select
              onChange={(e) => {
                const sample = SAMPLE_NOTES[Number(e.target.value)];
                if (sample) {
                  setNoteText(sample.text);
                  setNoteKind('note');
                }
              }}
              className="ml-auto rounded-lg border border-slate-200 bg-white shadow-sm px-2 py-1 font-mono text-xs text-slate-700"
              defaultValue="0"
            >
              {SAMPLE_NOTES.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <Capture
            onText={(text, meta) => {
              setNoteText(text);
              setNoteKind(meta.kind);
            }}
            disabled={busy}
          />

          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            spellCheck={false}
            className="mt-3 h-72 w-full resize-y rounded border border-slate-300 bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-800"
          />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 font-mono text-xs text-slate-600">
              TYPE
              <select
                value={type}
                onChange={(e) => setType(e.target.value as Profile | 'auto')}
                className="rounded-lg border border-slate-200 bg-white shadow-sm px-2 py-1 text-slate-800"
              >
                <option value="auto">Auto-detect</option>
                {(Object.keys(PROFILE_LABELS) as Profile[]).map((p) => (
                  <option key={p} value={p}>
                    {PROFILE_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={run}
              disabled={busy || !apiKey.trim() || !noteText.trim()}
              className="flex items-center gap-2 rounded-md bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            >
              {busy ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {busy ? 'Extracting…' : 'De-identify and extract'}
            </button>
            {!apiKey.trim() && (
              <span className="font-mono text-[11px] text-amber-700">Enter an API key above</span>
            )}
          </div>

          {error && (
            <p className="mt-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 font-mono text-xs leading-4 text-rose-700">
              {error}
            </p>
          )}

          {result && (
            <div className="mt-4">
              <p className="font-mono text-[11px] uppercase tracking-wide text-slate-500">
                Source — hover a field to locate its evidence
              </p>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-700">
                {highlight ? (
                  <>
                    {sourceText.slice(0, highlight.start)}
                    <mark className="bg-amber-200 text-slate-900">
                      {sourceText.slice(highlight.start, highlight.end)}
                    </mark>
                    {sourceText.slice(highlight.end)}
                  </>
                ) : (
                  sourceText
                )}
              </pre>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm p-6">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-base font-semibold tracking-tight text-slate-900">Extracted fields</h2>
            {result && (
              <>
                <span className="rounded border border-teal-200 bg-teal-50 px-2 py-0.5 font-mono text-[11px] text-teal-700">
                  {PROFILE_LABELS[result.profile]}
                  {type === 'auto' && ' · detected'}
                </span>
                <span className="font-mono text-[11px] text-slate-500">
                  {Object.keys(result.fields).length} fields
                </span>
              </>
            )}
          </div>

          {!result ? (
            <ol className="mt-4 space-y-3 text-sm text-slate-600">
              {[
                'Paste a note, or record, upload or photograph the consultation.',
                'Leave TYPE on Auto-detect, or pick the clinic yourself.',
                'Extract. Every value shows its confidence and the sentence it came from; edit, then sign off.',
              ].map((step, i) => (
                <li key={step} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 font-mono text-[11px] font-semibold text-slate-600">
                    {i + 1}
                  </span>
                  <span className="leading-6">{step}</span>
                </li>
              ))}
              <li className="pl-9 font-mono text-[11px] text-slate-500">
                Identifiers are removed in this browser before anything is sent.
              </li>
            </ol>
          ) : Object.keys(result.fields).length === 0 ? (
            <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-4 text-amber-800">
              The model found no extractable fields in this note. That is a valid outcome — an empty
              record is preferable to an invented one.
            </p>
          ) : (
            <div className="mt-4 space-y-5">
              {[...sections, { title: 'Other', fields: extras }].map((section) => {
                const present = section.fields.filter((f) => result.fields[f]);
                if (present.length === 0) return null;
                return (
                  <div key={section.title}>
                    <h3 className="font-mono text-[11px] uppercase tracking-wide text-slate-500">
                      {section.title}
                    </h3>
                    <div className="mt-2 space-y-1.5">
                      {present.map((field) => {
                        const extraction = result.fields[field];
                        return (
                          <div
                            key={field}
                            onMouseEnter={() => setHovered(field)}
                            onMouseLeave={() => setHovered(null)}
                            className={`grid grid-cols-[1fr_1.2fr] items-center gap-3 rounded px-2 py-1 ${
                              hovered === field ? 'bg-amber-50' : ''
                            }`}
                          >
                            <label className="flex items-center gap-2 text-xs text-slate-700">
                              <span
                                title={`confidence ${extraction.confidence.toFixed(2)}`}
                                className={`h-2 w-2 shrink-0 rounded-full ${confidenceTone(extraction.confidence)}`}
                              />
                              <span className="truncate">{FIELD_LABELS[field] ?? field}</span>
                            </label>
                            <input
                              value={edits[field] ?? extraction.value}
                              onChange={(e) =>
                                setEdits((prev) => ({ ...prev, [field]: e.target.value }))
                              }
                              className="w-full rounded-lg border border-slate-200 bg-white shadow-sm px-2 py-1 font-mono text-xs text-slate-800"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {result && result.warnings.length > 0 && (
            <ul className="mt-4 space-y-1 border-t border-slate-200 pt-3">
              {result.warnings.map((w) => (
                <li key={w} className="font-mono text-[11px] text-amber-700">
                  {w}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {result && analysis && (
        <div className={`grid gap-6 ${isHiv(result.profile) ? 'lg:grid-cols-2' : ''}`}>
          {isHiv(result.profile) && (
          <section className="rounded-lg border border-slate-200 bg-white shadow-sm p-6">
            <h3 className="text-base font-semibold tracking-tight text-slate-900">Indicators for this record</h3>
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              Computed by indicators.ts from the edited values above — no model involvement.
            </p>
            <ul className="mt-4 space-y-2">
              {Object.values(analysis.results).map((r) => (
                <li key={r.code} className="border-b border-slate-100 pb-2 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-900">{r.code}</span>
                    <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${statusTone(r.status)}`}>
                      {r.status.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-4 text-slate-600">{r.reason}</p>
                </li>
              ))}
            </ul>
          </section>
          )}

          <section className="rounded-lg border border-slate-200 bg-white shadow-sm p-6">
            <h3 className="text-base font-semibold tracking-tight text-slate-900">
              Quality flags
              <span className="ml-2 font-mono text-xs font-normal text-slate-500">
                {analysis.flags.length}
              </span>
            </h3>
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              Rule-based checks on the edited values above — no model involvement.
            </p>
            {analysis.flags.length === 0 ? (
              <p className="mt-4 font-mono text-xs text-slate-500">No flags raised.</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {analysis.flags.map((f, i) => (
                  <li key={`${f.rule}-${i}`} className="border-b border-slate-100 pb-2 last:border-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${
                          f.severity === 'critical'
                            ? 'border-rose-300 bg-rose-50 text-rose-700'
                            : 'border-amber-300 bg-amber-50 text-amber-700'
                        }`}
                      >
                        {f.severity}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">{f.rule}</span>
                    </div>
                    <p className="mt-1 text-xs leading-4 text-slate-600">{f.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {result && (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setShowTransmitted(!showTransmitted)}
            className="flex w-full items-center gap-2 px-6 py-3 text-left text-sm font-semibold text-slate-800"
          >
            {showTransmitted ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            <ShieldCheck size={15} className="text-teal-600" />
            Exactly what left this browser
            {counts && (
              <span className="ml-auto font-mono text-[11px] font-normal text-slate-500">
                {counts.NAME} names · {counts.PHONE} phone numbers · {counts.ID} identifiers removed
              </span>
            )}
          </button>

          {showTransmitted && (
            <div className="space-y-4 border-t border-slate-200 px-6 py-4">
              <dl className="grid gap-3 font-mono text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-slate-500">PROVIDER</dt>
                  <dd className="text-slate-800">{PROVIDER_LABELS[result.transmitted.provider]}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">MODEL</dt>
                  <dd className="text-slate-800">{result.transmitted.model}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">ENDPOINT</dt>
                  <dd className="break-all text-slate-800">{result.transmitted.endpoint}</dd>
                </div>
              </dl>

              <div>
                <p className="font-mono text-[11px] uppercase tracking-wide text-slate-500">
                  De-identified note as transmitted
                </p>
                <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-700">
                  {result.transmitted.redacted}
                </pre>
              </div>

              <div>
                <p className="font-mono text-[11px] uppercase tracking-wide text-slate-500">
                  Full prompt as transmitted
                </p>
                <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-4 text-slate-600">
                  {result.transmitted.prompt}
                </pre>
              </div>

              <div>
                <p className="font-mono text-[11px] uppercase tracking-wide text-slate-500">
                  Identifiers held in this tab only — never transmitted
                </p>
                {result.transmitted.entries.length === 0 ? (
                  <p className="mt-1 font-mono text-xs text-slate-500">
                    Nothing matched the identifier patterns in this note.
                  </p>
                ) : (
                  <ul className="mt-1 space-y-0.5 font-mono text-xs">
                    {result.transmitted.entries.map((e) => (
                      <li key={e.token} className="flex gap-3">
                        <span className="w-24 shrink-0 text-teal-700">{e.token}</span>
                        <span className="text-slate-600">{e.original}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {result && (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm p-6">
          <h3 className="text-base font-semibold tracking-tight text-slate-900">Export</h3>
          <p className="mt-1 text-xs text-slate-600">
            Model output is a draft. A named clinician must confirm the values before this record leaves
            the tool.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 font-mono text-xs text-slate-600">
              CLINICIAN
              <input
                value={clinician}
                onChange={(e) => setClinician(e.target.value)}
                placeholder="Full name"
                className="rounded border border-slate-300 px-2 py-1 text-slate-800"
              />
            </label>
            <label className="flex max-w-md items-start gap-2 text-xs leading-4 text-slate-700">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5"
              />
              I have reviewed every extracted field against the source note and confirm it is accurate.
            </label>
            <button
              type="button"
              onClick={exportRecord}
              disabled={!clinician.trim() || !confirmed}
              className="flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download size={14} />
              Extracted record CSV
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
