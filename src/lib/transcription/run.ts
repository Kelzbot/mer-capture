import {
  ProxyUnreachableError,
  type StatusFn,
  type TranscribeMode,
  type TranscriptionJob,
  type TranscriptionProvider,
} from './types';

export type Started = {
  job: TranscriptionJob;
  provider: TranscriptionProvider;
  fallbackReason?: string;
};

// Start on the primary provider; if, and only if, it can't be reached, start the
// same audio on the fallback and say why. Passcode, size and validation errors
// are not outages and are thrown as they are.
export async function startWithFallback(
  primary: TranscriptionProvider,
  fallback: TranscriptionProvider | null,
  audio: Blob,
  mode: TranscribeMode,
  onStatus: StatusFn,
): Promise<Started> {
  try {
    return { job: await primary.start(audio, mode, onStatus), provider: primary };
  } catch (e) {
    if (!(e instanceof ProxyUnreachableError) || !fallback || fallback === primary) throw e;
    const job = await fallback.start(audio, mode, onStatus);
    return { job, provider: fallback, fallbackReason: e.message };
  }
}
