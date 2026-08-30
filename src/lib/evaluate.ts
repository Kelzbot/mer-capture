import { DOC_LABELS, DOC_SECTIONS, type DocFields, type DocFieldValue } from './docQuality';

export type ReferenceRow = Record<string, unknown>;

export type ExtractedRecord = { recordId: string; fields: DocFields };

export type FieldMetrics = {
  field: string;
  label: string;
  column: string;
  scored: number;
  exactMatches: number;
  exactRate: number | null;
  fuzzyF1: number | null;
  referenceEmpty: number;
  hallucinations: number;
  hallucinationRate: number | null;
  omissions: number;
  omissionRate: number | null;
  negationErrors: number;
};

export type Icd10Metrics = {
  scored: number;
  exact: number;
  exactRate: number | null;
  category: number;
  categoryRate: number | null;
  unparseable: number;
};

export type NegationDirection = 'asserted_a_denial' | 'denied_an_assertion';

export type NegationExample = {
  recordId: string;
  field: string;
  term: string;
  direction: NegationDirection;
  reference: string;
  extracted: string;
};

export type FieldOutcome = {
  field: string;
  label: string;
  extracted: string;
  reference: string;
  exact: boolean;
  f1: number | null;
  hallucinated: boolean;
  omitted: boolean;
  negationError: boolean;
};

export type RecordOutcome = {
  recordId: string;
  index: number;
  fields: FieldOutcome[];
  scoredFields: number;
  exactMatches: number;
  meanF1: number | null;
  hallucinations: number;
  omissions: number;
  negationErrors: number;
};

export type EvalSplit = {
  seed: number;
  pct: number;
  paired: number;
  testSize: number;
  heldOutIds: string[];
};

export type EvaluationOverall = {
  records: number;
  fieldsEvaluated: number;
  scoredPairs: number;
  exactRate: number | null;
  fuzzyF1: number | null;
  microExactRate: number | null;
  hallucinations: number;
  hallucinationRate: number | null;
  omissions: number;
  omissionRate: number | null;
  negationErrors: number;
};

export type EvaluationReport = {
  fields: FieldMetrics[];
  icd10: Icd10Metrics;
  overall: EvaluationOverall;
  negationExamples: NegationExample[];
  records: RecordOutcome[];
  split: EvalSplit;
  columns: Record<string, string | null>;
};

export type EvaluateOptions = {
  columns?: Record<string, string | null>;
  fields?: string[];
  holdoutPct?: number;
  seed?: number;
};

const REFERENCE_ALIASES: Record<string, string[]> = {
  chief_complaint: ['chief complaint', 'cc', 'presenting complaint', 'reason for visit', 'complaint'],
  hpi: ['hpi', 'history of presenting illness', 'history of present illness', 'presenting history'],
  pmh: ['pmh', 'past medical history', 'medical history', 'past history'],
  exam: ['exam', 'examination', 'physical exam', 'physical examination', 'clinical findings', 'findings'],
  differential: ['differential', 'differential diagnosis', 'differentials', 'ddx'],
  final_diagnosis: ['final diagnosis', 'diagnosis', 'primary diagnosis', 'confirmed diagnosis', 'dx'],
  icd10: ['icd10', 'icd 10', 'icd10 code', 'icd 10 code', 'icd code', 'icd'],
  investigations: ['investigations', 'investigation', 'tests', 'labs', 'laboratory', 'workup'],
  medications: ['medications', 'medication', 'drugs', 'prescription', 'meds'],
  treatment_plan: ['treatment plan', 'plan', 'management plan', 'management', 'treatment'],
  soap_note: ['soap note', 'soap', 'structured note'],
};

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'as',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had', 'do', 'does',
  'did', 'it', 'its', 'he', 'she', 'his', 'her', 'they', 'their', 'them', 'this', 'that',
  'these', 'those', 'there', 'from', 'per', 'due', 'also', 'but', 'if', 'then', 'than',
  'patient', 'pt', 'client', 'presents', 'presenting', 'presented', 'complains',
  'complaining', 'history', 'since', 'day', 'days', 'week', 'weeks', 'month', 'months',
  'year', 'years', 'ago', 'given', 'started', 'commenced', 'plan', 'note', 'notes',
]);

const NEG_CUES = new Set([
  'no', 'not', 'denies', 'denied', 'denying', 'without', 'absent', 'negative', 'nil', 'none',
]);

const NEG_WINDOW = 5;

const ICD10_PATTERN = /\b([A-TV-Z][0-9][0-9A-Z])(?:\.([0-9A-Z]{1,4}))?\b/;

export function normaliseText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'`“‘]+|["'`”’]+$/g, '')
    .replace(/[.,;:!?\s]+$/g, '')
    .trim()
    .toLowerCase();
}

export function readExtractedValue(fields: DocFields, field: string): string {
  const entry = fields ? fields[field] : undefined;
  if (entry === null || entry === undefined) return '';
  if (typeof entry === 'string') return entry.trim();
  if (typeof entry === 'object') {
    const raw = (entry as DocFieldValue).value;
    if (raw === null || raw === undefined) return '';
    if (Array.isArray(raw)) return raw.map((v) => String(v ?? '').trim()).filter(Boolean).join('; ');
    return String(raw).trim();
  }
  return String(entry).trim();
}

function readReferenceValue(row: ReferenceRow, column: string | null): string {
  if (!column) return '';
  const raw = row ? row[column] : undefined;
  if (raw === null || raw === undefined) return '';
  if (Array.isArray(raw)) return raw.map((v) => String(v ?? '').trim()).filter(Boolean).join('; ');
  return String(raw).trim();
}

const MISSING_TOKENS = new Set([
  '', 'na', 'n/a', 'nil', 'none', 'null', 'unknown', 'unk', '-', '--', '.', '?',
  'not documented', 'not stated', 'not recorded', 'not applicable',
]);

function isMissing(value: string): boolean {
  return MISSING_TOKENS.has(normaliseText(value));
}

function headerKey(h: string): string {
  return String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function detectReferenceColumns(headers: string[]): Record<string, string | null> {
  const byKey = new Map<string, string>();
  for (const h of headers) {
    const k = headerKey(h);
    if (k && !byKey.has(k)) byKey.set(k, h);
  }

  const columns: Record<string, string | null> = {};
  for (const field of DOC_SECTIONS) {
    const candidates = [field, ...(REFERENCE_ALIASES[field] ?? [])];
    let found: string | null = null;
    for (const candidate of candidates) {
      const hit = byKey.get(headerKey(candidate));
      if (hit) {
        found = hit;
        break;
      }
    }
    columns[field] = found;
  }
  return columns;
}

export function hasReferenceColumns(headers: string[], minimum = 3): boolean {
  const columns = detectReferenceColumns(headers);
  return Object.values(columns).filter(Boolean).length >= minimum;
}

export function tokenise(value: string): string[] {
  return normaliseText(value)
    .replace(/[^a-z0-9\s.-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function tokenF1(extracted: string, reference: string): number {
  const a = tokenise(extracted);
  const b = tokenise(reference);
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const t of b) counts.set(t, (counts.get(t) ?? 0) + 1);

  let overlap = 0;
  for (const t of a) {
    const remaining = counts.get(t) ?? 0;
    if (remaining > 0) {
      overlap += 1;
      counts.set(t, remaining - 1);
    }
  }
  if (overlap === 0) return 0;

  const precision = overlap / a.length;
  const recall = overlap / b.length;
  return (2 * precision * recall) / (precision + recall);
}

export function parseIcd10(value: string): { code: string; category: string } | null {
  const match = ICD10_PATTERN.exec(String(value).toUpperCase());
  if (!match) return null;
  const category = match[1];
  const code = match[2] ? category + '.' + match[2] : category;
  return { code, category };
}

type Polarity = { negated: Set<string>; asserted: Set<string> };

export function polarity(text: string): Polarity {
  const negated = new Set<string>();
  const asserted = new Set<string>();

  const clauses = normaliseText(text).split(/[.,;:()\n•]|\bbut\b|\bhowever\b|\bwhereas\b/);

  for (const clause of clauses) {
    const words = clause
      .replace(/[^a-z0-9\s.-]/g, ' ')
      .split(/\s+/)
      .map((t) => t.replace(/^[.-]+|[.-]+$/g, ''))
      .filter(Boolean);

    let window = 0;
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i];
      if (NEG_CUES.has(word)) {
        window = NEG_WINDOW;
        continue;
      }
      if (word === 'for' && NEG_CUES.has(words[i - 1] ?? '')) continue;
      if (word.length > 1 && !STOPWORDS.has(word)) {
        if (window > 0) negated.add(word);
        else asserted.add(word);
      }
      if (window > 0) window -= 1;
    }
  }

  for (const term of negated) asserted.delete(term);
  return { negated, asserted };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function heldOutIndices(total: number, pct: number, seed: number): number[] {
  if (total <= 0) return [];
  const clamped = Math.max(1, Math.min(100, pct));
  const size = Math.max(1, Math.min(total, Math.round((total * clamped) / 100)));
  const order = Array.from({ length: total }, (_, i) => i);
  const rand = mulberry32(seed);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  return order.slice(0, size).sort((a, b) => a - b);
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

type FieldBucket = {
  scored: number;
  exact: number;
  f1: number[];
  refEmpty: number;
  hallucinations: number;
  omissions: number;
  negations: number;
};

export function evaluateExtraction(
  extractedRecords: ExtractedRecord[],
  referenceRows: ReferenceRow[],
  options: EvaluateOptions = {},
): EvaluationReport {
  const paired = Math.min(extractedRecords.length, referenceRows.length);
  const headers = Array.from(new Set(referenceRows.flatMap((r) => Object.keys(r ?? {}))));
  const columns = options.columns ?? detectReferenceColumns(headers);
  const fields = (options.fields ?? DOC_SECTIONS).filter((f) => Boolean(columns[f]));

  const seed = options.seed ?? 42;
  const pct = Math.max(1, Math.min(100, options.holdoutPct ?? 20));
  const selected = heldOutIndices(paired, pct, seed);

  const stats = new Map<string, FieldBucket>();
  for (const field of fields) {
    stats.set(field, {
      scored: 0, exact: 0, f1: [], refEmpty: 0, hallucinations: 0, omissions: 0, negations: 0,
    });
  }

  const icd10: Icd10Metrics = {
    scored: 0, exact: 0, exactRate: null, category: 0, categoryRate: null, unparseable: 0,
  };

  const negationExamples: NegationExample[] = [];
  const records: RecordOutcome[] = [];

  for (const index of selected) {
    const extractedRecord = extractedRecords[index];
    const referenceRow = referenceRows[index] ?? {};
    const outcomes: FieldOutcome[] = [];
    const f1s: number[] = [];
    let scoredFields = 0;
    let exactMatches = 0;
    let hallucinations = 0;
    let omissions = 0;
    let negationErrors = 0;

    for (const field of fields) {
      const bucket = stats.get(field);
      if (!bucket) continue;

      const extracted = readExtractedValue(extractedRecord?.fields ?? {}, field);
      const reference = readReferenceValue(referenceRow, columns[field]);
      const extractedMissing = isMissing(extracted);
      const referenceMissing = isMissing(reference);

      let exact = false;
      let f1: number | null = null;
      let hallucinated = false;
      let omitted = false;
      let negationError = false;

      if (referenceMissing) {
        bucket.refEmpty += 1;
        if (!extractedMissing) {
          hallucinated = true;
          bucket.hallucinations += 1;
          hallucinations += 1;
        }
      } else {
        bucket.scored += 1;
        scoredFields += 1;

        if (extractedMissing) {
          omitted = true;
          bucket.omissions += 1;
          omissions += 1;
          f1 = 0;
          bucket.f1.push(0);
          f1s.push(0);
        } else {
          exact = normaliseText(extracted) === normaliseText(reference);
          if (exact) {
            bucket.exact += 1;
            exactMatches += 1;
          }

          f1 = tokenF1(extracted, reference);
          bucket.f1.push(f1);
          f1s.push(f1);

          const ref = polarity(reference);
          const ext = polarity(extracted);
          const errors: Array<{ term: string; direction: NegationDirection }> = [];
          for (const term of ref.negated) {
            if (ext.asserted.has(term)) errors.push({ term, direction: 'asserted_a_denial' });
          }
          for (const term of ref.asserted) {
            if (ext.negated.has(term)) errors.push({ term, direction: 'denied_an_assertion' });
          }

          if (errors.length > 0) {
            negationError = true;
            bucket.negations += errors.length;
            negationErrors += errors.length;
            for (const error of errors) {
              if (negationExamples.length < 100) {
                negationExamples.push({
                  recordId: extractedRecord?.recordId ?? 'row-' + (index + 1),
                  field,
                  term: error.term,
                  direction: error.direction,
                  reference,
                  extracted,
                });
              }
            }
          }

          if (field === 'icd10') {
            const refCode = parseIcd10(reference);
            const extCode = parseIcd10(extracted);
            if (!refCode) {
              icd10.unparseable += 1;
            } else {
              icd10.scored += 1;
              if (extCode && extCode.code === refCode.code) icd10.exact += 1;
              if (extCode && extCode.category === refCode.category) icd10.category += 1;
            }
          }
        }
      }

      outcomes.push({
        field,
        label: DOC_LABELS[field] ?? field,
        extracted,
        reference,
        exact,
        f1,
        hallucinated,
        omitted,
        negationError,
      });
    }

    records.push({
      recordId: extractedRecord?.recordId ?? 'row-' + (index + 1),
      index,
      fields: outcomes,
      scoredFields,
      exactMatches,
      meanF1: mean(f1s),
      hallucinations,
      omissions,
      negationErrors,
    });
  }

  const fieldMetrics: FieldMetrics[] = fields.map((field) => {
    const bucket = stats.get(field) ?? {
      scored: 0, exact: 0, f1: [], refEmpty: 0, hallucinations: 0, omissions: 0, negations: 0,
    };
    return {
      field,
      label: DOC_LABELS[field] ?? field,
      column: columns[field] ?? '',
      scored: bucket.scored,
      exactMatches: bucket.exact,
      exactRate: rate(bucket.exact, bucket.scored),
      fuzzyF1: mean(bucket.f1),
      referenceEmpty: bucket.refEmpty,
      hallucinations: bucket.hallucinations,
      hallucinationRate: rate(bucket.hallucinations, bucket.refEmpty),
      omissions: bucket.omissions,
      omissionRate: rate(bucket.omissions, bucket.scored),
      negationErrors: bucket.negations,
    };
  });

  icd10.exactRate = rate(icd10.exact, icd10.scored);
  icd10.categoryRate = rate(icd10.category, icd10.scored);

  const scorable = fieldMetrics.filter((f) => f.scored > 0);
  const totalScored = fieldMetrics.reduce((s, f) => s + f.scored, 0);
  const totalExact = fieldMetrics.reduce((s, f) => s + f.exactMatches, 0);
  const totalRefEmpty = fieldMetrics.reduce((s, f) => s + f.referenceEmpty, 0);
  const totalHallucinations = fieldMetrics.reduce((s, f) => s + f.hallucinations, 0);
  const totalOmissions = fieldMetrics.reduce((s, f) => s + f.omissions, 0);
  const totalNegations = fieldMetrics.reduce((s, f) => s + f.negationErrors, 0);

  records.sort((a, b) => {
    const aScore = a.meanF1 ?? 1;
    const bScore = b.meanF1 ?? 1;
    if (aScore !== bScore) return aScore - bScore;
    if (a.hallucinations !== b.hallucinations) return b.hallucinations - a.hallucinations;
    return b.omissions - a.omissions;
  });

  return {
    fields: fieldMetrics,
    icd10,
    overall: {
      records: selected.length,
      fieldsEvaluated: fields.length,
      scoredPairs: totalScored,
      exactRate: mean(scorable.map((f) => f.exactRate ?? 0)),
      fuzzyF1: mean(scorable.map((f) => f.fuzzyF1 ?? 0)),
      microExactRate: rate(totalExact, totalScored),
      hallucinations: totalHallucinations,
      hallucinationRate: rate(totalHallucinations, totalRefEmpty),
      omissions: totalOmissions,
      omissionRate: rate(totalOmissions, totalScored),
      negationErrors: totalNegations,
    },
    negationExamples,
    records,
    split: {
      seed,
      pct,
      paired,
      testSize: selected.length,
      heldOutIds: selected.map((i) => extractedRecords[i]?.recordId ?? 'row-' + (i + 1)),
    },
    columns,
  };
}
