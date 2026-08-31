import Anthropic from '@anthropic-ai/sdk';
import { ADULT_ALIASES, CLINICAL_ALIASES, EID_ALIASES, FIELD_LABELS, type Profile } from './aliases';
import { deidentify, rehydrate, type RedactionEntry, type RedactionMap } from './deidentify';
import type { Row } from './indicators';

export type Provider = 'gemini' | 'anthropic';

export const PROVIDER_MODELS: Record<Provider, string> = {
  gemini: 'gemini-2.5-flash',
  anthropic: 'claude-sonnet-4-6',
};

export const PROVIDER_LABELS: Record<Provider, string> = {
  gemini: 'Google Gemini',
  anthropic: 'Anthropic Claude',
};

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';

export type FieldExtraction = {
  value: string;
  confidence: number;
  source_span: string;
  span: { start: number; end: number } | null;
};

export type Transmitted = {
  provider: Provider;
  model: string;
  endpoint: string;
  prompt: string;
  redacted: string;
  entries: RedactionEntry[];
};

export type ExtractionResult = {
  profile: Profile;
  fields: Record<string, FieldExtraction>;
  row: Row;
  transmitted: Transmitted;
  raw: string;
  warnings: string[];
};

function fieldCatalogue(aliases: Record<string, string[]>): string {
  return Object.keys(aliases)
    .map((f) => `    ${f} — ${FIELD_LABELS[f] ?? f}`)
    .join('\n');
}

export type SourceKind = 'note' | 'consultation';

const CONSULTATION_RULES = `
10. CONSULTATION TRANSCRIPT MODE. This input is an automatic transcript of a spoken consultation, not a written note. It contains dialogue between clinician and patient, false starts, repetition, and speech-recognition errors.
   - Attribute correctly. What the patient describes is history (hpi, pmh) — never examination. What the clinician states aloud as a finding is exam. A patient speculating about their own illness is NOT a diagnosis and must never populate final_diagnosis or differential.
   - Record only what was actually said. If the clinician never states an assessment or a plan aloud, omit those fields. Do not complete the consultation on their behalf.
   - source_span must quote the transcript verbatim, including its errors. Do not tidy the quote.
   - Speech recognition corrupts drug names, doses and numbers badly. If a medication name or a dose is not clearly recoverable from the transcript, OMIT it. Do not repair it to the drug you think was meant, and never guess a dose. A missing dose is safe; a wrong one is not.
   - Negation survives transcription errors poorly. If you cannot tell whether a symptom was affirmed or denied, omit it rather than choosing.`;

export function buildPrompt(redacted: string, kind: SourceKind = 'note'): string {
  return `You are a clinical data extraction tool for Nigerian HIV programme records. You read one clinic note and return structured JSON.

PROFILES — decide which single profile this note belongs to:
  adult_art — an adolescent or adult on antiretroviral treatment
  eid — early infant diagnosis: an infant HIV DNA PCR / DBS record
  clinical — a general outpatient consultation note, any presenting complaint, not HIV-programme specific

FIELD NAMES for adult_art (use these exact keys):
${fieldCatalogue(ADULT_ALIASES)}

FIELD NAMES for eid (use these exact keys):
${fieldCatalogue(EID_ALIASES)}

FIELD NAMES for clinical (use these exact keys):
${fieldCatalogue(CLINICAL_ALIASES)}

RULES
1. Return JSON and nothing else. No prose, no explanation, no markdown code fences.
2. Exact output shape:
{"profile":"adult_art","fields":{"<field_name>":{"value":"<verbatim value>","confidence":0.0,"source_span":"<verbatim quote from the note>"}}}
3. Include a field ONLY if this note actually states it. Absence is a valid and expected result — omit the field entirely rather than guessing. Never infer, never invent, never fill in a typical or default clinical value. A note that states almost nothing must return almost no fields.
4. For the adult_art and eid profiles, "value" must be copied verbatim from the note. Do NOT reformat, normalise or convert anything — dates such as "14-Aug-25" or "03/04/2026", results such as "TND", "<20" or "1,450", and units must be returned exactly as they appear. Downstream software does all parsing.
5. "source_span" must be a verbatim substring of the note, at most 12 words, containing the evidence for that value.
6. "confidence" is a number from 0 to 1 describing how clearly the note states this value.
7. This note has been de-identified. Tokens of the form [NAME_1], [PHONE_2], [ID_3] are placeholders for removed identifiers. Never treat them as clinical data, never return one as a value, and never comment on them.
8. Use only field names from the list for the profile you selected.
9. CLINICAL PROFILE ONLY. Sectioning is allowed; invention is not. Each section value is the note's own wording for that section, lightly joined into a clause — never new clinical content, never a typical presentation, never a finding the note does not state. Specifically:
   - chief_complaint: the stated reason for the visit, in the note's words, one short line.
   - hpi, pmh, exam, investigations: the note's own statements for that section. Preserve every negation exactly as written — "no fever", "denies cough", "chest clear" must stay negative. Reversing a negation is the most serious error you can make.
   - differential: only diagnoses the note itself considers or rules out. If the note lists none, omit the field.
   - final_diagnosis: only if the note states a diagnosis or impression. Never infer one from symptoms.
   - icd10: the standard ICD-10 code for the diagnosis the note states, formatted like J45.9 or A09. This is a coding of a stated diagnosis, not a new clinical fact — so omit it entirely when final_diagnosis is absent or too vague to code. Return the code alone, no description.
   - medications, treatment_plan: only drugs and actions the note records. Never add a standard regimen.
   - soap_note: the note reorganised into S:, O:, A:, P: on four lines, using only content already in the note. Leave a heading empty rather than filling it.
   For every clinical field, source_span must still be a verbatim substring of the note.
${kind === 'consultation' ? CONSULTATION_RULES : ''}

NOTE:
"""
${redacted}
"""`;
}

export function stripFences(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:json)?[ \t]*\r?\n?/i, '').replace(/\r?\n?```$/, '').trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  return t.trim();
}

export function locateSpan(text: string, span: string): { start: number; end: number } | null {
  if (!span) return null;
  const direct = text.indexOf(span);
  if (direct >= 0) return { start: direct, end: direct + span.length };

  const trimmed = span.trim();
  if (trimmed && trimmed !== span) {
    const i = text.indexOf(trimmed);
    if (i >= 0) return { start: i, end: i + trimmed.length };
  }

  const lower = text.toLowerCase().indexOf(trimmed.toLowerCase());
  if (lower >= 0) return { start: lower, end: lower + trimmed.length };

  const collapsed = trimmed.replace(/\s+/g, ' ');
  const words = collapsed.split(' ');
  if (words.length > 3) {
    const head = words.slice(0, 3).join(' ');
    const i = text.toLowerCase().indexOf(head.toLowerCase());
    if (i >= 0) return { start: i, end: i + head.length };
  }
  return null;
}

export function toRow(fields: Record<string, FieldExtraction>): Row {
  const row: Row = {};
  for (const [field, extraction] of Object.entries(fields)) {
    if (extraction.value !== '' && extraction.value !== null) row[field] = extraction.value;
  }
  return row;
}

function coerceValue(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return '';
}

function coerceConfidence(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!isFinite(n)) return 0;
  if (n > 1 && n <= 100) return Math.min(1, n / 100);
  return Math.max(0, Math.min(1, n));
}

async function callGemini(
  prompt: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(`${GEMINI_ENDPOINT}/${PROVIDER_MODELS.gemini}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
    signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gemini API ${res.status}: ${detail.slice(0, 240) || res.statusText}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.map((p: { text?: string }) => p?.text ?? '').join('')
    : '';
  if (!text) throw new Error('Gemini returned an empty response');
  return text;
}

async function callAnthropic(
  prompt: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  try {
    const message = await client.messages.create(
      {
        model: PROVIDER_MODELS.anthropic,
        max_tokens: 8192,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal },
    );
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    if (!text) throw new Error('Claude returned an empty response');
    return text;
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      throw new Error(`Anthropic API ${error.status ?? ''}: ${error.message}`.trim());
    }
    throw error;
  }
}

export async function extractNote(
  text: string,
  apiKey: string,
  provider: Provider,
  signal?: AbortSignal,
  kind: SourceKind = 'note',
): Promise<ExtractionResult> {
  if (!text.trim()) throw new Error('The note is empty');
  if (!apiKey.trim()) throw new Error('No API key entered');

  const { redacted, map, entries } = deidentify(text);
  const prompt = buildPrompt(redacted, kind);

  const raw =
    provider === 'anthropic'
      ? await callAnthropic(prompt, apiKey, signal)
      : await callGemini(prompt, apiKey, signal);

  const transmitted: Transmitted = {
    provider,
    model: PROVIDER_MODELS[provider],
    endpoint:
      provider === 'anthropic'
        ? ANTHROPIC_ENDPOINT
        : `${GEMINI_ENDPOINT}/${PROVIDER_MODELS.gemini}:generateContent`,
    prompt,
    redacted,
    entries,
  };

  return parseExtraction(raw, text, map, transmitted);
}

export function parseExtraction(
  raw: string,
  originalText: string,
  map: RedactionMap,
  transmitted: Transmitted,
): ExtractionResult {
  const cleaned = stripFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `The model did not return valid JSON. First 200 characters received: ${cleaned.slice(0, 200)}`,
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('The model returned JSON that is not an object');
  }

  const body = parsed as { profile?: unknown; fields?: unknown };
  const rawFields =
    body.fields && typeof body.fields === 'object' ? (body.fields as Record<string, unknown>) : {};

  const warnings: string[] = [];
  const adultKeys = new Set(Object.keys(ADULT_ALIASES));
  const eidKeys = new Set(Object.keys(EID_ALIASES));
  const clinicalKeys = new Set(Object.keys(CLINICAL_ALIASES));

  const declared = body.profile;
  const isProfile = declared === 'eid' || declared === 'adult_art' || declared === 'clinical';

  let profile: Profile = isProfile ? declared : 'adult_art';
  if (!isProfile) {
    const returned = Object.keys(rawFields);
    const clinicalHits = returned.filter((k) => clinicalKeys.has(k)).length;
    const eidHits = returned.filter((k) => eidKeys.has(k) && !adultKeys.has(k)).length;
    if (clinicalHits > eidHits) profile = 'clinical';
    else if (eidHits > 0) profile = 'eid';
    else profile = 'adult_art';
    warnings.push(`Model did not return a valid profile; inferred "${profile}" from the field names`);
  }

  const keysByProfile: Record<Profile, Set<string>> = {
    adult_art: adultKeys,
    eid: eidKeys,
    clinical: clinicalKeys,
  };
  const allowed = keysByProfile[profile];
  const fields: Record<string, FieldExtraction> = {};

  for (const [name, payload] of Object.entries(rawFields)) {
    if (!allowed.has(name)) {
      warnings.push(`Ignored unknown field "${name}"`);
      continue;
    }
    if (!payload || typeof payload !== 'object') {
      warnings.push(`Ignored malformed field "${name}"`);
      continue;
    }

    const entry = payload as { value?: unknown; confidence?: unknown; source_span?: unknown };
    const value = rehydrate(coerceValue(entry.value), map);
    if (!value) continue;

    const span = rehydrate(coerceValue(entry.source_span), map);
    fields[name] = {
      value,
      confidence: coerceConfidence(entry.confidence),
      source_span: span,
      span: locateSpan(originalText, span),
    };
  }

  return { profile, fields, row: toRow(fields), transmitted, raw, warnings };
}
