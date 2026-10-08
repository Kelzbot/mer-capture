import type { Utterance } from './types';

export type SpeakerRole = 'clinician' | 'patient' | 'caregiver';

export const SPEAKER_ROLES: SpeakerRole[] = ['clinician', 'patient', 'caregiver'];

export const ROLE_LABELS: Record<SpeakerRole, string> = {
  clinician: 'Clinician',
  patient: 'Patient',
  caregiver: 'Caregiver',
};

export type SpeakerRoles = Partial<Record<string, SpeakerRole>>;

export function speakersIn(utterances: Utterance[]): string[] {
  const seen: string[] = [];
  for (const u of utterances) if (!seen.includes(u.speaker)) seen.push(u.speaker);
  return seen;
}

export function speakerLabel(speaker: string, roles: SpeakerRoles): string {
  const role = roles[speaker];
  return role ? ROLE_LABELS[role] : `Speaker ${speaker}`;
}

// Consecutive utterances from the same speaker read as one turn.
export function mergeTurns(utterances: Utterance[]): Utterance[] {
  const turns: Utterance[] = [];
  for (const u of utterances) {
    const text = u.text.trim();
    if (!text) continue;
    const last = turns[turns.length - 1];
    if (last && last.speaker === u.speaker) {
      last.text = `${last.text} ${text}`;
      last.end = u.end;
    } else {
      turns.push({ ...u, text });
    }
  }
  return turns;
}

// "No." is deliberately absent: in a consultation it is almost always a whole
// answer ("Any fever?" "No."), and joining it to the next sentence would glue
// the patient's reply onto the clinician's next question.
const ABBREVIATION_END = /\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|vs|approx|e\.g|i\.e)\.$/i;

export function splitSentences(text: string): string[] {
  const pieces = text
    .split(/(?<=[.?!])\s+(?=\S)/)
    .map((s) => s.trim())
    .filter(Boolean);
  const sentences: string[] = [];
  for (const piece of pieces) {
    const last = sentences[sentences.length - 1];
    if (last && ABBREVIATION_END.test(last)) sentences[sentences.length - 1] = `${last} ${piece}`;
    else sentences.push(piece);
  }
  return sentences;
}

// One line per sentence. Diarization can return a single block holding several
// real turns — a clinician's question and the patient's answer under one
// speaker — and labelling whole speakers cannot undo that. Sentences can be
// reassigned one at a time.
export function toLines(utterances: Utterance[]): Utterance[] {
  const lines: Utterance[] = [];
  for (const u of utterances) {
    for (const sentence of splitSentences(u.text)) {
      lines.push({ speaker: u.speaker, text: sentence, start: u.start, end: u.end });
    }
  }
  return lines;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// The letter for a speaker the diarizer missed entirely, e.g. when everyone was
// merged into Speaker A.
export function nextSpeaker(speakers: string[]): string {
  return [...LETTERS].find((l) => !speakers.includes(l)) ?? `S${speakers.length + 1}`;
}

// The string handed to extraction. One "Label: text" line per turn; a speaker
// with no assigned role passes through as "Speaker A". A single-voice transcript
// (a dictated note) goes through as plain text, exactly as typed notes always have.
export function utterancesToTranscript(utterances: Utterance[], roles: SpeakerRoles = {}): string {
  const turns = mergeTurns(utterances);
  if (speakersIn(turns).length <= 1) return turns.map((t) => t.text).join(' ').trim();
  return turns.map((t) => `${speakerLabel(t.speaker, roles)}: ${t.text}`).join('\n');
}
