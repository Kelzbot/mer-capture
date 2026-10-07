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

// The string handed to extraction. One "Label: text" line per turn; a speaker
// with no assigned role passes through as "Speaker A". A single-voice transcript
// (a dictated note) goes through as plain text, exactly as typed notes always have.
export function utterancesToTranscript(utterances: Utterance[], roles: SpeakerRoles = {}): string {
  const turns = mergeTurns(utterances);
  if (speakersIn(turns).length <= 1) return turns.map((t) => t.text).join(' ').trim();
  return turns.map((t) => `${speakerLabel(t.speaker, roles)}: ${t.text}`).join('\n');
}
