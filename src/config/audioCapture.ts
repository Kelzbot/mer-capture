// Browser-side audio processing for the microphone. All three default on: in a
// clinic room they remove fan hum, echo off hard walls and the volume gap between
// a clinician near the device and a patient across the desk. The audio-debug
// toggle turns them all off together so the same scene can be recorded raw and
// processed and the two files compared.
export const AUDIO_PROCESSING = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export const AUDIO_BITRATE = 64_000;

export const RECORDING_LIMIT_SECONDS = 15 * 60;

export const RECORDING_WARN_SECONDS = 14 * 60;

// The transcription proxy refuses anything larger; checked client-side first so
// the user hears about it before an upload starts.
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export function audioConstraints(raw: boolean): MediaTrackConstraints {
  return {
    channelCount: { ideal: 1 },
    echoCancellation: !raw && AUDIO_PROCESSING.echoCancellation,
    noiseSuppression: !raw && AUDIO_PROCESSING.noiseSuppression,
    autoGainControl: !raw && AUDIO_PROCESSING.autoGainControl,
  };
}

// Opus in WebM everywhere it is supported; iOS Safari only records MP4/AAC.
const RECORDER_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/mp4'];

export function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  return RECORDER_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

export function extensionForMime(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase();
  if (base === 'audio/webm') return 'webm';
  if (base === 'audio/mp4' || base === 'audio/x-m4a' || base === 'audio/aac') return 'm4a';
  if (base === 'audio/ogg') return 'ogg';
  if (base === 'audio/wav' || base === 'audio/x-wav' || base === 'audio/wave') return 'wav';
  if (base === 'audio/mpeg' || base === 'audio/mp3') return 'mp3';
  return 'audio';
}

// Off by default in production. `?audiodebug=1` reveals the raw/processed switch on
// a real device, where a dev build is not available.
export function audioDebugEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return new URLSearchParams(window.location.search).get('audiodebug') === '1';
  } catch {
    return false;
  }
}
