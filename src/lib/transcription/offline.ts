import { transcribeAudio, WHISPER_MODELS, type WhisperChoice } from '../capture';
import { countSpeakers, diariseAudio, labelChunks } from '../diarise';
import type {
  StatusFn,
  TranscribeMode,
  TranscriptionJob,
  TranscriptionProvider,
  TranscriptionResult,
  Utterance,
} from './types';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// The original V2 engine: Whisper plus on-device diarisation, all in the browser.
// Kept as the fallback when the proxy can't be reached, and for offline use.
export class OfflineProvider implements TranscriptionProvider {
  readonly id = 'offline' as const;
  readonly label = 'Offline (basic) — on this device';
  readonly onDevice = true;

  private readonly choice: WhisperChoice;
  private readonly language: string;

  constructor(options: { choice: WhisperChoice; language: string }) {
    this.choice = options.choice;
    this.language = options.language;
  }

  async start(audio: Blob, mode: TranscribeMode): Promise<TranscriptionJob> {
    return { provider: 'offline', id: `offline-${Date.now()}`, mode, blob: audio };
  }

  async wait(job: TranscriptionJob, onStatus: StatusFn): Promise<TranscriptionResult> {
    if (!job.blob) throw new Error('No audio to transcribe');

    const stats = await transcribeAudio(
      job.blob,
      (p) => onStatus(p.stage, p.pct),
      this.choice,
      this.language,
    );
    if (!stats.text.trim()) throw new Error('Nothing audible was transcribed from that recording');

    let utterances: Utterance[] = [
      { speaker: 'A', text: stats.text, start: 0, end: Math.round(stats.audioSeconds * 1000) },
    ];

    if (job.mode === 'consultation' && stats.chunks.length > 0) {
      try {
        const turns = await diariseAudio(stats.audio, (p) => onStatus(p.stage, p.pct));
        if (countSpeakers(turns) > 1) {
          const lines = labelChunks(stats.chunks, turns);
          if (lines.length > 0) {
            utterances = lines.map((l) => ({
              speaker: LETTERS[l.speaker] ?? String(l.speaker),
              text: l.text,
              start: Math.round(l.start * 1000),
              end: Math.round(l.end * 1000),
            }));
          }
        }
      } catch (e) {
        // Diarisation is an enhancement: a failure must not lose the transcript.
        console.warn('Diarisation failed, keeping the plain transcript', e);
      }
    }

    return {
      text: stats.text,
      utterances,
      engine: `Offline · ${WHISPER_MODELS[this.choice].label} · ${stats.device === 'webgpu' ? 'GPU' : 'CPU'}`,
      detail: `${Math.round(stats.audioSeconds)}s of audio in ${Math.round(stats.elapsedSeconds)}s`,
    };
  }
}
