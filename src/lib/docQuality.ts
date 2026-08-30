export type DocFieldValue = { value?: unknown; confidence?: unknown; source_span?: unknown };

export type DocFields = Record<string, DocFieldValue | string | undefined>;

export type DocRecord = { recordId: string; group?: string; fields: DocFields };

// patient_id and facility rather than record_id and group: DataQuality.tsx renders
// dq.ts's DQFlag shape, and these flags are passed straight into it unchanged.
export type DocQualityFlag = {
  severity: 'critical' | 'warning';
  patient_id: string;
  rule: string;
  message: string;
  facility: string;
};

export type GroupScore = {
  facility: string;
  records: number;
  clean: number;
  critical: number;
  warning: number;
  score: number;
};

export type SectionFill = {
  field: string;
  label: string;
  filled: number;
  total: number;
  rate: number | null;
  core: boolean;
};

export type FieldConfidence = { field: string; label: string; mean: number | null; n: number };

export type DocQualityMetrics = {
  records: number;
  completeRecords: number;
  completeRate: number | null;
  sectionFill: SectionFill[];
  diagnosisPresent: number;
  diagnosisCoded: number;
  diagnosisCodingRate: number | null;
  meanConfidence: FieldConfidence[];
  overallConfidence: number | null;
};

export type DocQualityReport = { metrics: DocQualityMetrics; flags: DocQualityFlag[] };

export const DOC_SECTIONS: string[] = [
  'chief_complaint', 'hpi', 'pmh', 'exam', 'differential', 'final_diagnosis',
  'icd10', 'investigations', 'medications', 'treatment_plan', 'soap_note',
];

export const CORE_SECTIONS: string[] = [
  'chief_complaint', 'hpi', 'exam', 'differential', 'final_diagnosis', 'treatment_plan',
];

export const DOC_LABELS: Record<string, string> = {
  chief_complaint: 'Chief complaint',
  hpi: 'History of presenting illness',
  pmh: 'Past medical history',
  exam: 'Examination',
  differential: 'Differential diagnosis',
  final_diagnosis: 'Final diagnosis',
  icd10: 'ICD-10 code',
  investigations: 'Investigations',
  medications: 'Medications',
  treatment_plan: 'Treatment plan',
  soap_note: 'SOAP note',
};

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'was', 'were', 'been', 'has', 'have', 'had', 'his', 'her',
  'their', 'they', 'she', 'this', 'that', 'there', 'from', 'per', 'due', 'also', 'but',
  'patient', 'pt', 'client', 'presents', 'presenting', 'presented', 'complains',
  'complaining', 'complaint', 'history', 'since', 'day', 'week', 'month', 'year', 'ago',
  'not', 'non', 'left', 'right', 'both', 'severe', 'mild', 'moderate', 'acute', 'chronic',
  'likely', 'suspected', 'probable', 'possible', 'rule', 'out', 'query', 'review',
  'normal', 'abnormal', 'positive', 'negative', 'seen', 'today', 'reports', 'noted',
]);

function readValue(fields: DocFields, field: string): string {
  const entry = fields?.[field];
  if (entry === null || entry === undefined) return '';
  if (typeof entry === 'string') return entry.trim();
  const raw = entry.value;
  if (raw === null || raw === undefined) return '';
  return String(raw).trim();
}

function readConfidence(fields: DocFields, field: string): number | null {
  const entry = fields?.[field];
  if (!entry || typeof entry === 'string') return null;
  const c = Number(entry.confidence);
  return isFinite(c) ? c : null;
}

function has(fields: DocFields, field: string): boolean {
  return readValue(fields, field) !== '';
}

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t))
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

function shareKeyword(a: Set<string>, b: Set<string>): boolean {
  for (const token of a) if (b.has(token)) return true;
  return false;
}

function medicationNames(text: string): string[] {
  return text
    .split(/[,;\n\r]+|\s+and\s+/i)
    .map((part) => part.replace(/^[-*\d.\s)]+/, '').trim().split(/\s+/)[0] ?? '')
    .map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((name) => name.length >= 3);
}

function truncate(text: string, max = 48): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function groupOf(record: DocRecord): string {
  if (record.group && record.group.trim()) return record.group.trim();
  const prefix = record.recordId.match(/^([A-Za-z][A-Za-z0-9]*)[-_/]/);
  return prefix ? prefix[1].toUpperCase() : 'All encounters';
}

function recordFlags(record: DocRecord): DocQualityFlag[] {
  const fields = record.fields ?? {};
  const facility = groupOf(record);
  const out: DocQualityFlag[] = [];
  const push = (severity: 'critical' | 'warning', rule: string, message: string) =>
    out.push({ severity, patient_id: record.recordId, rule, message, facility });

  const complaint = readValue(fields, 'chief_complaint');
  const diagnosis = readValue(fields, 'final_diagnosis');
  const icd10 = readValue(fields, 'icd10');
  const plan = readValue(fields, 'treatment_plan');
  const medications = readValue(fields, 'medications');

  if (diagnosis && !icd10) {
    push('critical', 'diagnosis_without_icd10', 'Diagnosis coded without ICD-10');
  }

  if (plan && !diagnosis) {
    push('critical', 'plan_without_diagnosis', 'Plan documented without a diagnosis to justify it');
  }

  if (complaint && diagnosis && !shareKeyword(keywords(complaint), keywords(diagnosis))) {
    push(
      'warning',
      'complaint_diagnosis_mismatch',
      `Diagnosis may not match presenting complaint, review — complaint "${truncate(complaint)}" against diagnosis "${truncate(diagnosis)}"`,
    );
  }

  if (medications && plan) {
    const names = medicationNames(medications);
    const planText = plan.toLowerCase();
    if (names.length > 0 && !names.some((name) => planText.includes(name))) {
      push(
        'warning',
        'medications_not_in_plan',
        `Medications listed ("${truncate(medications)}") are not referenced in the treatment plan`,
      );
    }
  }

  for (const section of CORE_SECTIONS) {
    if (!has(fields, section)) {
      push('warning', 'incomplete_soap', `Incomplete SOAP note: missing ${DOC_LABELS[section] ?? section}`);
    }
  }

  for (const field of ['final_diagnosis', 'icd10']) {
    const confidence = readConfidence(fields, field);
    if (has(fields, field) && confidence !== null && confidence < 0.5) {
      push(
        'warning',
        'low_confidence_diagnosis',
        `Low-confidence diagnosis extraction, verify against source (${DOC_LABELS[field] ?? field}, confidence ${confidence.toFixed(2)})`,
      );
    }
  }

  return out;
}

export function computeDocQuality(records: DocRecord[]): DocQualityReport {
  const total = records.length;
  const flags = records.flatMap(recordFlags);

  const sectionFill: SectionFill[] = DOC_SECTIONS.map((field) => {
    const filled = records.filter((r) => has(r.fields ?? {}, field)).length;
    return {
      field,
      label: DOC_LABELS[field] ?? field,
      filled,
      total,
      rate: total > 0 ? (filled / total) * 100 : null,
      core: CORE_SECTIONS.includes(field),
    };
  });

  const completeRecords = records.filter((r) =>
    CORE_SECTIONS.every((section) => has(r.fields ?? {}, section)),
  ).length;

  const diagnosisPresent = records.filter((r) => has(r.fields ?? {}, 'final_diagnosis')).length;
  const diagnosisCoded = records.filter(
    (r) => has(r.fields ?? {}, 'final_diagnosis') && has(r.fields ?? {}, 'icd10'),
  ).length;

  const meanConfidence: FieldConfidence[] = DOC_SECTIONS.map((field) => {
    const values = records
      .map((r) => (has(r.fields ?? {}, field) ? readConfidence(r.fields ?? {}, field) : null))
      .filter((c): c is number => c !== null);
    return {
      field,
      label: DOC_LABELS[field] ?? field,
      mean: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null,
      n: values.length,
    };
  });

  const scored = meanConfidence.filter((m) => m.mean !== null);
  const weighted = scored.reduce((sum, m) => sum + (m.mean as number) * m.n, 0);
  const weightTotal = scored.reduce((sum, m) => sum + m.n, 0);

  return {
    metrics: {
      records: total,
      completeRecords,
      completeRate: total > 0 ? (completeRecords / total) * 100 : null,
      sectionFill,
      diagnosisPresent,
      diagnosisCoded,
      diagnosisCodingRate: diagnosisPresent > 0 ? (diagnosisCoded / diagnosisPresent) * 100 : null,
      meanConfidence,
      overallConfidence: weightTotal > 0 ? weighted / weightTotal : null,
    },
    flags,
  };
}

export function facilityOrVariantScore(
  records: DocRecord[],
  flags?: DocQualityFlag[],
): GroupScore[] {
  const all = flags ?? computeDocQuality(records).flags;

  const dirty = new Map<string, Set<string>>();
  const counts = new Map<string, { critical: number; warning: number }>();
  for (const flag of all) {
    const bucket = counts.get(flag.facility) ?? { critical: 0, warning: 0 };
    if (flag.severity === 'critical') {
      bucket.critical++;
      const set = dirty.get(flag.facility) ?? new Set<string>();
      set.add(flag.patient_id);
      dirty.set(flag.facility, set);
    } else {
      bucket.warning++;
    }
    counts.set(flag.facility, bucket);
  }

  const idsByGroup = new Map<string, string[]>();
  for (const record of records) {
    const group = groupOf(record);
    const list = idsByGroup.get(group) ?? [];
    list.push(record.recordId);
    idsByGroup.set(group, list);
  }

  return [...idsByGroup.entries()]
    .map(([facility, ids]) => {
      const bad = dirty.get(facility) ?? new Set<string>();
      const clean = ids.filter((id) => !bad.has(id)).length;
      const bucket = counts.get(facility) ?? { critical: 0, warning: 0 };
      return {
        facility,
        records: ids.length,
        clean,
        critical: bucket.critical,
        warning: bucket.warning,
        score: ids.length > 0 ? (clean / ids.length) * 100 : 0,
      };
    })
    .sort((a, b) => a.score - b.score);
}
