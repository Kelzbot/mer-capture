// Pure AssemblyAI request/response logic, shared by the Edge Function, the
// bake-off script and the unit tests. No Deno or Node APIs in this file, so it
// runs unchanged in all three.
//
// Parameter names checked against assemblyai.com/docs on 2026-10-07:
//   speech_models (array) — current models are universal-3-5-pro and universal-2;
//     Universal-3 Pro is no longer listed. Medical mode supports both.
//   domain "medical-v1" — Medical Mode; English, Spanish, German, French.
//   language_code "en" — Global English (en_us / en_uk / en_au are the regional codes).
//   speaker_labels + speaker_options.{min,max}_speakers_expected — a range; must not
//     be combined with speakers_expected.
//   keyterms_prompt — up to 1,000 words total on Universal-3.5 Pro, max 6 words per phrase.
//   utterances[].start / .end — milliseconds.
//   DELETE /v2/transcript/{id} — also deletes any file uploaded via /v2/upload.

export const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2';

export const SPEECH_MODEL = 'universal-3-5-pro';
export const MEDICAL_DOMAIN = 'medical-v1';
export const LANGUAGE_CODE = 'en';

export const MAX_KEYTERMS = 100;
export const MAX_KEYTERM_WORDS = 6;
export const MAX_KEYTERM_CHARS = 80;

export type TranscribeMode = 'consultation' | 'dictation';

export type Utterance = {
  speaker: string;
  text: string;
  start: number;
  end: number;
};

export type NormalisedTranscript = {
  text: string;
  utterances: Utterance[];
};

export type AssemblyAIStatus = 'queued' | 'processing' | 'completed' | 'error';

export function sanitiseKeyterms(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const term = item.replace(/\s+/g, ' ').trim();
    if (!term || term.length > MAX_KEYTERM_CHARS) continue;
    if (term.split(' ').length > MAX_KEYTERM_WORDS) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= MAX_KEYTERMS) break;
  }
  return out;
}

export function buildTranscriptRequest(
  audioUrl: string,
  mode: TranscribeMode,
  keyterms: string[],
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    audio_url: audioUrl,
    speech_models: [SPEECH_MODEL],
    domain: MEDICAL_DOMAIN,
    language_code: LANGUAGE_CODE,
    speaker_labels: true,
  };

  // A clinic encounter is clinician and patient, sometimes a caregiver or
  // interpreter. A dictated note is one voice: forcing a minimum of two there
  // would make the model invent a second speaker.
  if (mode === 'consultation') {
    body.speaker_options = { min_speakers_expected: 2, max_speakers_expected: 3 };
  } else {
    body.speakers_expected = 1;
  }

  const terms = sanitiseKeyterms(keyterms);
  if (terms.length > 0) body.keyterms_prompt = terms;

  return body;
}

type RawUtterance = { speaker?: unknown; text?: unknown; start?: unknown; end?: unknown };

function toMs(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

export function normaliseTranscript(json: unknown): NormalisedTranscript {
  const body = (json && typeof json === 'object' ? json : {}) as {
    text?: unknown;
    utterances?: unknown;
  };

  const text = typeof body.text === 'string' ? body.text.trim() : '';

  const utterances: Utterance[] = Array.isArray(body.utterances)
    ? (body.utterances as RawUtterance[])
        .map((u) => ({
          speaker: typeof u.speaker === 'string' && u.speaker.trim() ? u.speaker.trim() : 'A',
          text: typeof u.text === 'string' ? u.text.replace(/\s+/g, ' ').trim() : '',
          start: toMs(u.start),
          end: toMs(u.end),
        }))
        .filter((u) => u.text.length > 0)
    : [];

  // Diarization off or nothing segmented: keep the text as one speaker so the
  // downstream shape is always the same.
  if (utterances.length === 0 && text) {
    return { text, utterances: [{ speaker: 'A', text, start: 0, end: 0 }] };
  }

  return { text: text || utterances.map((u) => u.text).join(' '), utterances };
}

// AssemblyAI keeps returning a deleted transcript, with its text replaced. Seeing
// that on a poll means the result was already delivered and removed.
export function isDeletedTranscript(json: unknown): boolean {
  const text = (json as { text?: unknown } | null)?.text;
  return typeof text === 'string' && /^deleted by user/i.test(text.trim());
}
