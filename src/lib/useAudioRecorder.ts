import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AUDIO_BITRATE,
  audioConstraints,
  pickRecorderMimeType,
  RECORDING_LIMIT_SECONDS,
} from '../config/audioCapture';

export type RecordedAudio = {
  blob: Blob;
  mime: string;
  raw: boolean;
  seconds: number;
};

type WakeLockSentinelLike = { release: () => Promise<void> };
type WakeLockLike = { request: (type: 'screen') => Promise<WakeLockSentinelLike> };

function wakeLockApi(): WakeLockLike | null {
  const api = (navigator as unknown as { wakeLock?: WakeLockLike }).wakeLock;
  return api && typeof api.request === 'function' ? api : null;
}

export function useAudioRecorder(onComplete: (audio: RecordedAudio) => void) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [wakeLockHeld, setWakeLockHeld] = useState(false);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const wakeLock = useRef<WakeLockSentinelLike | null>(null);
  const wantWakeLock = useRef(false);
  const completeRef = useRef(onComplete);

  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  const acquireWakeLock = useCallback(async () => {
    const api = wakeLockApi();
    if (!api) return;
    try {
      wakeLock.current = await api.request('screen');
      setWakeLockHeld(true);
    } catch {
      // Refused (battery saver, iframe, unsupported). Recording carries on; the
      // screen may sleep, which is why the hint below the timer says so.
      setWakeLockHeld(false);
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    wantWakeLock.current = false;
    const lock = wakeLock.current;
    wakeLock.current = null;
    setWakeLockHeld(false);
    if (lock) await lock.release().catch(() => undefined);
  }, []);

  // A wake lock is dropped whenever the tab is hidden; take it back on return.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && wantWakeLock.current && !wakeLock.current) {
        void acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [acquireWakeLock]);

  const stop = useCallback(() => {
    const rec = recorder.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  }, []);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      const seconds = (Date.now() - startedAt.current) / 1000;
      setElapsed(seconds);
      if (seconds >= RECORDING_LIMIT_SECONDS) stop();
    }, 250);
    return () => clearInterval(id);
  }, [recording, stop]);

  useEffect(
    () => () => {
      const rec = recorder.current;
      if (rec && rec.state !== 'inactive') {
        rec.onstop = null;
        rec.stop();
      }
      stream.current?.getTracks().forEach((t) => t.stop());
      void releaseWakeLock();
    },
    [releaseWakeLock],
  );

  const start = useCallback(
    async (raw: boolean) => {
      setError(null);
      try {
        const media = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(raw) });
        stream.current = media;

        const mimeType = pickRecorderMimeType();
        const options: MediaRecorderOptions = { audioBitsPerSecond: AUDIO_BITRATE };
        if (mimeType) options.mimeType = mimeType;

        const rec = new MediaRecorder(media, options);
        chunks.current = [];

        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.current.push(e.data);
        };

        rec.onstop = () => {
          media.getTracks().forEach((t) => t.stop());
          stream.current = null;
          recorder.current = null;
          setRecording(false);
          void releaseWakeLock();

          const seconds = (Date.now() - startedAt.current) / 1000;
          const mime = rec.mimeType || mimeType || 'audio/webm';
          const blob = new Blob(chunks.current, { type: mime });
          chunks.current = [];

          if (blob.size === 0) {
            setError('The recording came back empty. Check the microphone and try again.');
            return;
          }
          completeRef.current({ blob, mime, raw, seconds });
        };

        // No timeslice: the whole encounter is one continuous file, never a run of
        // short chunks transcribed independently.
        rec.start();
        recorder.current = rec;
        startedAt.current = Date.now();
        setElapsed(0);
        setRecording(true);

        wantWakeLock.current = true;
        await acquireWakeLock();
      } catch (e) {
        stream.current?.getTracks().forEach((t) => t.stop());
        stream.current = null;
        setError(
          e instanceof Error && e.name === 'NotAllowedError'
            ? 'Microphone access was refused by the browser'
            : e instanceof Error
              ? e.message
              : String(e),
        );
      }
    },
    [acquireWakeLock, releaseWakeLock],
  );

  return { recording, elapsed, error, wakeLockHeld, start, stop };
}
