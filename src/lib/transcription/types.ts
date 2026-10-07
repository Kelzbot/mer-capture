// Kept structurally identical to supabase/functions/_shared/assemblyai.ts so the
// proxy's response drops straight in. Times are milliseconds.
export type Utterance = {
  speaker: string;
  text: string;
  start: number;
  end: number;
};

export type TranscribeMode = 'consultation' | 'dictation';

export type ProviderId = 'assemblyai' | 'offline';

export type TranscriptionResult = {
  text: string;
  utterances: Utterance[];
  engine: string;
  detail?: string;
};

export type TranscriptionJob = {
  provider: ProviderId;
  id: string;
  mode: TranscribeMode;
  path?: string;
  blob?: Blob;
};

export type StatusFn = (stage: string, pct?: number | null) => void;

// Two phases so a timed-out job can be resumed: Retry calls wait() again on the
// same job and never re-uploads or resubmits.
export interface TranscriptionProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly onDevice: boolean;
  start(audio: Blob, mode: TranscribeMode, onStatus: StatusFn): Promise<TranscriptionJob>;
  wait(job: TranscriptionJob, onStatus: StatusFn, signal?: AbortSignal): Promise<TranscriptionResult>;
}

// The only error that triggers the automatic fallback to the offline engine.
export class ProxyUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProxyUnreachableError';
  }
}

export class PasscodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasscodeError';
  }
}

export class TranscriptionTimeoutError extends Error {
  readonly job: TranscriptionJob;

  constructor(job: TranscriptionJob, message: string) {
    super(message);
    this.name = 'TranscriptionTimeoutError';
    this.job = job;
  }
}
