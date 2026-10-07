import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CircleX,
  Download,
  FileAudio,
  FileImage,
  Loader,
  Mic,
  RotateCw,
  Square,
  TriangleAlert,
} from 'lucide-react';
import {
  isRecordingSupported,
  LANGUAGES,
  ocrImage,
  WHISPER_MODELS,
  type CaptureProgress,
  type WhisperChoice,
} from '../lib/capture';
import type { SourceKind } from '../lib/extract';
import { useAudioRecorder, type RecordedAudio } from '../lib/useAudioRecorder';
import {
  audioDebugEnabled,
  extensionForMime,
  RECORDING_LIMIT_SECONDS,
  RECORDING_WARN_SECONDS,
} from '../config/audioCapture';
import { MEDICAL_KEYTERMS } from '../config/medicalKeyterms';
import { AssemblyAIProvider } from '../lib/transcription/assemblyai';
import { OfflineProvider } from '../lib/transcription/offline';
import { startWithFallback } from '../lib/transcription/run';
import { readDemoKey, writeDemoKey } from '../lib/transcription/demoKey';
import {
  mergeTurns,
  ROLE_LABELS,
  SPEAKER_ROLES,
  speakerLabel,
  speakersIn,
  utterancesToTranscript,
  type SpeakerRole,
  type SpeakerRoles,
} from '../lib/transcription/format';
import {
  PasscodeError,
  TranscriptionTimeoutError,
  type ProviderId,
  type StatusFn,
  type TranscriptionJob,
  type TranscriptionProvider,
  type TranscriptionResult,
} from '../lib/transcription/types';

type Props = {
  onText: (text: string, meta: { source: 'photo' | 'voice'; kind: SourceKind }) => void;
  disabled?: boolean;
};

type AudioClip = {
  blob: Blob;
  url: string;
  mime: string;
  origin: 'recording' | 'upload';
  raw: boolean;
  fileName: string;
};

type Pending = { job: TranscriptionJob; provider: TranscriptionProvider; kind: SourceKind };

const CLOUD_URL = ((import.meta.env.VITE_TRANSCRIBE_URL as string | undefined) ?? '').trim();

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

export default function Capture({ onText, disabled }: Props) {
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<CaptureProgress | null>(null);
  const [photoText, setPhotoText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<SourceKind>('consultation');
  const [engine, setEngine] = useState<ProviderId>(CLOUD_URL ? 'assemblyai' : 'offline');
  const [choice, setChoice] = useState<WhisperChoice>('small.en');
  const [language, setLanguage] = useState('auto');
  const [consented, setConsented] = useState(false);
  const [raw, setRaw] = useState(false);
  const [clip, setClip] = useState<AudioClip | null>(null);

  const [demoKey, setDemoKey] = useState(readDemoKey);
  const [keyDraft, setKeyDraft] = useState('');
  const [editingKey, setEditingKey] = useState(false);

  const [transcribing, setTranscribing] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [voice, setVoice] = useState<{
    result: TranscriptionResult;
    kind: SourceKind;
    onDevice: boolean;
  } | null>(null);
  const [roles, setRoles] = useState<SpeakerRoles>({});

  const abortRef = useRef<AbortController | null>(null);

  const canRecord = isRecordingSupported();
  const showAudioDebug = audioDebugEnabled();
  const model = WHISPER_MODELS[choice];
  const cloudSelected = engine === 'assemblyai';

  useEffect(() => () => {
    if (clip) URL.revokeObjectURL(clip.url);
  }, [clip]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!transcribing) return;
    const id = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 500);
    return () => clearInterval(id);
  }, [transcribing, startedAt]);

  const onStatus: StatusFn = useCallback((s) => setStage(s), []);

  const finishWith = useCallback(
    async (next: Pending) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setPending(next);
      setTimedOut(false);
      setTranscribing(true);
      setStartedAt(Date.now());
      setElapsed(0);

      try {
        const result = await next.provider.wait(next.job, onStatus, controller.signal);
        setVoice({ result, kind: next.kind, onDevice: next.provider.onDevice });
        setRoles({});
        setPending(null);
      } catch (e) {
        if (isAbort(e)) return;
        if (e instanceof TranscriptionTimeoutError) {
          setTimedOut(true);
        } else {
          if (e instanceof PasscodeError) setEditingKey(true);
          setError(e instanceof Error ? e.message : String(e));
          setPending(null);
        }
      } finally {
        if (abortRef.current === controller) {
          setTranscribing(false);
          setStage(null);
        }
      }
    },
    [onStatus],
  );

  const processAudio = useCallback(
    async (blob: Blob, forKind: SourceKind) => {
      abortRef.current?.abort();
      setError(null);
      setVoice(null);
      setPhotoText(null);
      setFallbackNotice(null);
      setTimedOut(false);
      setPending(null);
      setTranscribing(true);
      setStartedAt(Date.now());
      setElapsed(0);
      setStage(null);

      const mode = forKind === 'note' ? 'dictation' : 'consultation';
      const offline = new OfflineProvider({ choice, language });
      const cloud = new AssemblyAIProvider({
        url: CLOUD_URL,
        getDemoKey: readDemoKey,
        keyterms: MEDICAL_KEYTERMS,
      });
      const primary = engine === 'assemblyai' ? cloud : offline;

      try {
        const started = await startWithFallback(
          primary,
          primary === cloud ? offline : null,
          blob,
          mode,
          onStatus,
        );
        if (started.fallbackReason) setFallbackNotice(started.fallbackReason);
        await finishWith({ job: started.job, provider: started.provider, kind: forKind });
      } catch (e) {
        if (isAbort(e)) return;
        if (e instanceof PasscodeError) setEditingKey(true);
        setError(e instanceof Error ? e.message : String(e));
        setTranscribing(false);
        setStage(null);
      }
    },
    [choice, language, engine, onStatus, finishWith],
  );

  const onRecorded = useCallback(
    (audio: RecordedAudio) => {
      const ext = extensionForMime(audio.mime);
      setClip({
        blob: audio.blob,
        url: URL.createObjectURL(audio.blob),
        mime: audio.mime,
        origin: 'recording',
        raw: audio.raw,
        fileName: `encounter-${stamp()}-${audio.raw ? 'raw' : 'processed'}.${ext}`,
      });
      void processAudio(audio.blob, kind);
    },
    [processAudio, kind],
  );

  const recorder = useAudioRecorder(onRecorded);

  function onAudioFile(file: File) {
    setClip({
      blob: file,
      url: URL.createObjectURL(file),
      mime: file.type || 'audio/*',
      origin: 'upload',
      raw: false,
      fileName: file.name,
    });
    void processAudio(file, kind);
  }

  function saveKey() {
    const value = keyDraft.trim();
    writeDemoKey(value);
    setDemoKey(value);
    setKeyDraft('');
    setEditingKey(false);
    setError(null);
  }

  function toggleRole(speaker: string, role: SpeakerRole) {
    setRoles((current) => ({ ...current, [speaker]: current[speaker] === role ? undefined : role }));
  }

  async function runOcr(file: File) {
    setError(null);
    setPhotoText(null);
    setVoice(null);
    setOcrBusy(true);
    try {
      const text = await ocrImage(file, setOcrProgress);
      if (!text.trim()) throw new Error('No readable text was found in that image');
      setPhotoText(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcrBusy(false);
      setOcrProgress(null);
    }
  }

  async function runSample() {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/printed_note_sample.png`);
      if (!res.ok) throw new Error(`Could not load the sample form (${res.status})`);
      const blob = await res.blob();
      await runOcr(new File([blob], 'printed_note_sample.png', { type: blob.type }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const recording = recorder.recording;
  const working = ocrBusy || transcribing;
  const recordBlocked = kind === 'consultation' && !consented;
  const needsKey = cloudSelected && !demoKey;
  const nearLimit = recording && recorder.elapsed >= RECORDING_WARN_SECONDS;
  const shownError = error ?? recorder.error;
  const speakers = voice ? speakersIn(voice.result.utterances) : [];
  const turns = voice ? mergeTurns(voice.result.utterances) : [];

  return (
    <div className="mt-3 rounded border border-slate-300 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-[10px] uppercase tracking-wide text-slate-500">
          Capture instead of typing
        </span>

        {(['consultation', 'note'] as SourceKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            disabled={working || recording}
            className={`rounded border px-2.5 py-1 font-mono text-[10px] disabled:opacity-40 ${
              kind === k
                ? 'border-teal-500 bg-teal-50 text-teal-800'
                : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
            }`}
          >
            {k === 'consultation' ? 'Live consultation' : 'Dictated note'}
          </button>
        ))}
      </div>

      <p className="mt-2 font-mono text-[10px] leading-4 text-slate-600">
        {kind === 'consultation'
          ? 'Records the conversation between clinician and patient. The note is derived from what was actually said — nothing the clinician did not say aloud is filled in.'
          : 'You dictate a summary yourself. Cleaner input, fewer errors, but it happens after the consultation rather than during it.'}
      </p>

      {canRecord && (
        <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-slate-500">
              Transcription
            </span>
            <select
              value={engine}
              onChange={(e) => setEngine(e.target.value as ProviderId)}
              disabled={working || recording}
              className="rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[10px] text-slate-800 disabled:opacity-40"
            >
              <option value="assemblyai">
                Cloud — medical{CLOUD_URL ? '' : ' (not configured in this build)'}
              </option>
              <option value="offline">Offline (basic) — on this device</option>
            </select>

            {!cloudSelected && (
              <>
                <select
                  value={choice}
                  onChange={(e) => setChoice(e.target.value as WhisperChoice)}
                  disabled={working || recording}
                  className="rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[10px] text-slate-800 disabled:opacity-40"
                >
                  {(Object.keys(WHISPER_MODELS) as WhisperChoice[]).map((key) => (
                    <option key={key} value={key}>
                      {WHISPER_MODELS[key].label} · {WHISPER_MODELS[key].size}
                    </option>
                  ))}
                </select>
                {model.multilingual && (
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    disabled={working || recording}
                    className="rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[10px] text-slate-800 disabled:opacity-40"
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}
          </div>

          {cloudSelected ? (
            demoKey && !editingKey ? (
              <p className="font-mono text-[10px] text-slate-500">
                Speaker labels and medical vocabulary. Passcode saved on this device ·{' '}
                <button
                  type="button"
                  onClick={() => setEditingKey(true)}
                  className="text-teal-700 underline"
                >
                  change
                </button>
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && keyDraft.trim()) saveKey();
                  }}
                  placeholder="Transcription passcode"
                  className="w-48 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[10px] text-slate-800"
                />
                <button
                  type="button"
                  onClick={saveKey}
                  disabled={!keyDraft.trim()}
                  className="rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[10px] text-slate-700 hover:border-teal-500 disabled:opacity-40"
                >
                  Save
                </button>
                <span className="font-mono text-[10px] text-slate-500">
                  Asked once, kept on this device.
                </span>
              </div>
            )
          ) : (
            <p className="font-mono text-[10px] text-slate-500">{model.note}</p>
          )}

          {showAudioDebug && (
            <label className="flex items-center gap-2 font-mono text-[10px] text-slate-600">
              <input
                type="checkbox"
                checked={raw}
                onChange={(e) => setRaw(e.target.checked)}
                disabled={recording}
              />
              Raw audio — echo cancellation, noise suppression and gain control all off
              <span className="text-slate-400">(audio debug)</span>
            </label>
          )}

          {kind === 'consultation' && (
            <label className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2">
              <input
                type="checkbox"
                checked={consented}
                onChange={(e) => setConsented(e.target.checked)}
                disabled={recording}
                className="mt-0.5"
              />
              <span className="font-mono text-[10px] leading-4 text-amber-900">
                {cloudSelected
                  ? 'The patient has been told this consultation will be recorded and sent to an external service to be transcribed, and has agreed.'
                  : 'The patient has been told this consultation will be recorded and has agreed.'}{' '}
                Recording without consent is not lawful under the Nigeria Data Protection Act.
              </span>
            </label>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
        {canRecord &&
          (recording ? (
            <button
              type="button"
              onClick={recorder.stop}
              className="flex items-center gap-2 rounded border border-rose-300 bg-rose-50 px-3 py-1.5 text-[11px] font-medium text-rose-700 hover:bg-rose-100"
            >
              <Square size={13} />
              Stop and transcribe
              <span className="font-mono tabular-nums">
                {clock(recorder.elapsed)} / {clock(RECORDING_LIMIT_SECONDS)}
              </span>
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-rose-600" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void recorder.start(raw)}
              disabled={working || disabled || recordBlocked || needsKey}
              className="flex items-center gap-2 rounded bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-700 disabled:opacity-40"
            >
              <Mic size={13} />
              {kind === 'consultation' ? 'Record consultation' : 'Dictate note'}
            </button>
          ))}

        <label
          className={`flex cursor-pointer items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700 ${
            working || disabled || recording || recordBlocked || needsKey
              ? 'pointer-events-none opacity-40'
              : ''
          }`}
        >
          <FileAudio size={13} />
          Upload audio file
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onAudioFile(f);
            }}
          />
        </label>

        <span className="mx-1 font-mono text-[10px] text-slate-400">or</span>

        <label
          className={`flex cursor-pointer items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700 ${
            working || disabled ? 'pointer-events-none opacity-40' : ''
          }`}
        >
          <Camera size={13} />
          Take photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) runOcr(f);
            }}
          />
        </label>

        <label
          className={`flex cursor-pointer items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700 ${
            working || disabled ? 'pointer-events-none opacity-40' : ''
          }`}
        >
          <FileImage size={13} />
          Upload image
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) runOcr(f);
            }}
          />
        </label>

        <button
          type="button"
          onClick={runSample}
          disabled={working || disabled}
          className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-[10px] text-slate-600 hover:border-teal-500 hover:text-teal-700 disabled:opacity-40"
        >
          try a sample form
        </button>
      </div>

      {recording && (
        <p className={`mt-2 font-mono text-[10px] ${nearLimit ? 'text-rose-700' : 'text-slate-500'}`}>
          {nearLimit
            ? `Recording stops automatically at ${clock(RECORDING_LIMIT_SECONDS)}.`
            : recorder.wakeLockHeld
              ? 'Screen kept awake while recording.'
              : 'This browser would not keep the screen awake — keep the device unlocked while recording.'}
        </p>
      )}

      {recordBlocked && !recording && (
        <p className="mt-2 font-mono text-[10px] text-amber-700">
          Confirm consent above before recording or uploading a consultation.
        </p>
      )}

      {needsKey && !recording && (
        <p className="mt-2 font-mono text-[10px] text-amber-700">
          Enter the transcription passcode above, or switch to Offline (basic).
        </p>
      )}

      <p className="mt-2 font-mono text-[10px] leading-4 text-slate-500">
        {cloudSelected
          ? 'Audio is uploaded to a private, temporary store and transcribed by AssemblyAI, an external service. Both copies are deleted as soon as the transcript comes back. Photos are still read on this device.'
          : 'Everything here runs inside this browser. The audio and the photo never leave the device — only the recogniser files are downloaded, once, and cached.'}{' '}
        Handwriting is unreliable; printed forms read best.
      </p>

      {clip && !recording && (
        <div className="mt-3 rounded border border-slate-200 bg-white px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-wide text-slate-500">
            {clip.origin === 'recording' ? 'Recorded audio' : 'Uploaded audio'}
            <span className="ml-2 normal-case tracking-normal text-slate-400">
              {(clip.blob.size / 1024 / 1024).toFixed(1)} MB · {clip.mime}
              {clip.origin === 'recording' && ` · ${clip.raw ? 'raw' : 'processed'}`}
            </span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <audio controls src={clip.url} className="h-8 max-w-full" />
            <a
              href={clip.url}
              download={clip.fileName}
              className="flex items-center gap-1.5 rounded border border-slate-300 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700"
            >
              <Download size={13} />
              Download audio
            </a>
          </div>
        </div>
      )}

      {fallbackNotice && (
        <p className="mt-3 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 font-mono text-[11px] leading-4 text-amber-900">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          <span>
            Cloud transcription unavailable — {fallbackNotice}. Transcribed with Offline (basic) on
            this device instead; expect lower accuracy and less reliable speaker labels.
          </span>
        </p>
      )}

      {ocrBusy && (
        <div className="mt-3 flex items-center gap-2 font-mono text-[11px] text-slate-700">
          <Loader size={13} className="animate-spin text-teal-600" />
          <span>
            Reading the image{ocrProgress?.stage ? ` — ${ocrProgress.stage}` : ''}
          </span>
          {ocrProgress?.pct !== null && ocrProgress?.pct !== undefined && (
            <span className="text-slate-500">{Math.round(ocrProgress.pct * 100)}%</span>
          )}
        </div>
      )}

      {transcribing && (
        <div className="mt-3 flex items-center gap-2 font-mono text-[11px] text-slate-700">
          <Loader size={13} className="animate-spin text-teal-600" />
          <span className="tabular-nums">Transcribing… {clock(elapsed)}</span>
          {stage && <span className="text-slate-500">— {stage}</span>}
        </div>
      )}

      {timedOut && pending && !transcribing && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2">
          <span className="font-mono text-[11px] text-amber-900">
            Still transcribing after 3 minutes — the job is still running at the service.
          </span>
          <button
            type="button"
            onClick={() => void finishWith(pending)}
            className="flex items-center gap-1.5 rounded border border-amber-400 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
          >
            <RotateCw size={12} />
            Retry
          </button>
          <span className="font-mono text-[10px] text-amber-800">
            Checks the same job again; nothing is re-uploaded.
          </span>
        </div>
      )}

      {shownError && (
        <p className="mt-3 flex items-start gap-2 rounded border border-rose-300 bg-rose-50 px-3 py-2 font-mono text-[11px] text-rose-700">
          <CircleX size={13} className="mt-0.5 shrink-0" />
          {shownError}
        </p>
      )}

      {photoText && (
        <div className="mt-3 rounded border border-teal-300 bg-white p-3">
          <p className="font-mono text-[10px] uppercase tracking-wide text-slate-500">
            Read from the image
            <span className="ml-2 normal-case tracking-normal text-slate-400">
              check it before extracting — recognition errors are expected
            </span>
          </p>
          <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-4 text-slate-800">
            {photoText}
          </pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onText(photoText, { source: 'photo', kind: 'note' });
                setPhotoText(null);
              }}
              className="rounded bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-700"
            >
              Use this
            </button>
            <button
              type="button"
              onClick={() => setPhotoText(null)}
              className="rounded border border-slate-300 px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:border-slate-400"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {voice && (
        <div className="mt-3 rounded border border-teal-300 bg-white p-3">
          <p className="font-mono text-[10px] uppercase tracking-wide text-slate-500">
            {voice.kind === 'consultation' ? 'Consultation transcript' : 'Dictation transcript'}
            <span className="ml-2 normal-case tracking-normal text-slate-400">
              check it before extracting — recognition errors are expected
            </span>
          </p>
          <p className="mt-1 font-mono text-[10px] text-slate-500">
            {voice.result.engine}
            {voice.result.detail ? ` · ${voice.result.detail}` : ''}
          </p>

          {speakers.length > 1 ? (
            <div className="mt-2 space-y-1.5 rounded border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-wide text-slate-500">
                {speakers.length} voices — tap who each one is
                <span className="ml-2 normal-case tracking-normal text-slate-400">
                  unassigned speakers stay as “Speaker A”, “Speaker B”…
                </span>
              </p>
              {voice.onDevice && (
                <p className="font-mono text-[10px] text-amber-700">
                  On-device speaker separation is provisional — read the lines below before using
                  them.
                </p>
              )}
              {speakers.map((speaker) => (
                <div key={speaker} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-20 font-mono text-[10px] text-slate-700">Speaker {speaker}</span>
                  {SPEAKER_ROLES.map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => toggleRole(speaker, role)}
                      className={`rounded border px-2 py-0.5 font-mono text-[10px] ${
                        roles[speaker] === role
                          ? 'border-teal-500 bg-teal-50 text-teal-800'
                          : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
                      }`}
                    >
                      {ROLE_LABELS[role]}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            voice.kind === 'consultation' && (
              <p className="mt-1 font-mono text-[10px] text-amber-700">
                Only one voice was distinguishable — speakers are not separated.
              </p>
            )
          )}

          {speakers.length > 1 ? (
            <div className="mt-2 max-h-60 space-y-1.5 overflow-y-auto">
              {turns.map((turn, i) => (
                <div key={`${turn.start}-${i}`} className="flex gap-2">
                  <span
                    className={`w-24 shrink-0 font-mono text-[9px] uppercase tracking-wide ${
                      roles[turn.speaker] === 'clinician' ? 'text-teal-700' : 'text-slate-500'
                    }`}
                  >
                    {speakerLabel(turn.speaker, roles)}
                  </span>
                  <span className="font-mono text-[11px] leading-4 text-slate-800">{turn.text}</span>
                </div>
              ))}
            </div>
          ) : (
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-4 text-slate-800">
              {voice.result.text}
            </pre>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onText(utterancesToTranscript(voice.result.utterances, roles), {
                  source: 'voice',
                  kind: voice.kind,
                });
                setVoice(null);
              }}
              className="rounded bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-700"
            >
              Use this
            </button>
            <button
              type="button"
              onClick={() => setVoice(null)}
              className="rounded border border-slate-300 px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:border-slate-400"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
