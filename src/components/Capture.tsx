import { useEffect, useRef, useState } from 'react';
import { Camera, CircleX, FileImage, Loader, Mic, Square } from 'lucide-react';
import {
  isRecordingSupported,
  LANGUAGES,
  ocrImage,
  transcribeAudio,
  WHISPER_MODELS,
  type CaptureProgress,
  type TranscriptResult,
  type WhisperChoice,
} from '../lib/capture';
import {
  countSpeakers,
  diariseAudio,
  labelChunks,
  renderTranscript,
  type LabelledLine,
  type Role,
} from '../lib/diarise';
import type { SourceKind } from '../lib/extract';

type Props = {
  onText: (text: string, meta: { source: 'photo' | 'voice'; kind: SourceKind }) => void;
  disabled?: boolean;
};

type Busy = 'photo' | 'voice' | null;

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function Capture({ onText, disabled }: Props) {
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState<CaptureProgress | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    text: string;
    source: 'photo' | 'voice';
    kind: SourceKind;
    stats?: TranscriptResult;
    lines?: LabelledLine[];
  } | null>(null);
  const [roles, setRoles] = useState<Record<number, Role>>({ 0: 'clinician', 1: 'patient' });

  const [kind, setKind] = useState<SourceKind>('consultation');
  const [choice, setChoice] = useState<WhisperChoice>('small.en');
  const [language, setLanguage] = useState('auto');
  const [consented, setConsented] = useState(false);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const kindAtStart = useRef<SourceKind>('consultation');

  const canRecord = isRecordingSupported();
  const model = WHISPER_MODELS[choice];
  const working = busy !== null;

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed((Date.now() - started) / 1000), 500);
    return () => clearInterval(id);
  }, [recording]);

  async function runOcr(file: File) {
    setError(null);
    setPreview(null);
    setBusy('photo');
    try {
      const text = await ocrImage(file, setProgress);
      if (!text.trim()) throw new Error('No readable text was found in that image');
      setPreview({ text, source: 'photo', kind: 'note' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setProgress(null);
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

  async function startRecording() {
    setError(null);
    setPreview(null);
    kindAtStart.current = kind;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
        setBusy('voice');
        try {
          const stats = await transcribeAudio(blob, setProgress, choice, language);
          if (!stats.text.trim()) {
            throw new Error('Nothing audible was transcribed from that recording');
          }

          let lines: LabelledLine[] | undefined;
          if (kindAtStart.current === 'consultation' && stats.chunks.length > 0) {
            try {
              const turns = await diariseAudio(stats.audio, setProgress);
              if (countSpeakers(turns) > 1) {
                const labelled = labelChunks(stats.chunks, turns);
                if (labelled.length > 0) lines = labelled;
              }
            } catch (e) {
              // Diarisation is an enhancement: a failure must not lose the transcript.
              console.warn('Diarisation failed, keeping the plain transcript', e);
            }
          }

          setPreview({
            text: stats.text,
            source: 'voice',
            kind: kindAtStart.current,
            stats,
            lines,
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(null);
          setProgress(null);
        }
      };

      rec.start();
      recorder.current = rec;
      setRecording(true);
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Microphone access was refused by the browser'
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
  }

  function stopRecording() {
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
  }

  const recordBlocked = kind === 'consultation' && !consented;

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
              Speech model
            </span>
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
          </div>

          <p className="font-mono text-[10px] text-slate-500">{model.note}</p>

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
                The patient has been told this consultation will be recorded and has agreed.
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
              onClick={stopRecording}
              className="flex items-center gap-2 rounded border border-rose-300 bg-rose-50 px-3 py-1.5 text-[11px] font-medium text-rose-700 hover:bg-rose-100"
            >
              <Square size={13} />
              Stop and transcribe
              <span className="font-mono tabular-nums">{clock(elapsed)}</span>
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-rose-600" />
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              disabled={working || disabled || recordBlocked}
              className="flex items-center gap-2 rounded bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-700 disabled:opacity-40"
            >
              <Mic size={13} />
              {kind === 'consultation' ? 'Record consultation' : 'Dictate note'}
            </button>
          ))}

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

      {recordBlocked && !recording && (
        <p className="mt-2 font-mono text-[10px] text-amber-700">
          Confirm consent above before recording a consultation.
        </p>
      )}

      <p className="mt-2 font-mono text-[10px] leading-4 text-slate-500">
        Everything here runs inside this browser. The audio and the photo never leave the device —
        only the recogniser files are downloaded, once, and cached. Handwriting is unreliable;
        printed forms read best.
      </p>

      {working && (
        <div className="mt-3 flex items-center gap-2 font-mono text-[11px] text-slate-700">
          <Loader size={13} className="animate-spin text-teal-600" />
          <span>
            {busy === 'photo' ? 'Reading the image' : 'Transcribing'}
            {progress?.stage ? ` — ${progress.stage}` : ''}
          </span>
          {progress?.pct !== null && progress?.pct !== undefined && (
            <span className="text-slate-500">{Math.round(progress.pct * 100)}%</span>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded border border-rose-300 bg-rose-50 px-3 py-2 font-mono text-[11px] text-rose-700">
          <CircleX size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {preview && (
        <div className="mt-3 rounded border border-teal-300 bg-white p-3">
          <p className="font-mono text-[10px] uppercase tracking-wide text-slate-500">
            {preview.source === 'photo'
              ? 'Read from the image'
              : preview.kind === 'consultation'
                ? 'Consultation transcript'
                : 'Dictation transcript'}
            <span className="ml-2 normal-case tracking-normal text-slate-400">
              check it before extracting — recognition errors are expected
            </span>
            {preview.kind === 'consultation' && preview.source === 'voice' && !preview.lines && (
              <span className="ml-2 normal-case tracking-normal text-amber-700">
                only one voice was distinguishable — speakers are not separated
              </span>
            )}
          </p>

          {preview.stats && (
            <p className="mt-1 font-mono text-[10px] text-slate-500">
              {Math.round(preview.stats.audioSeconds)}s of audio in{' '}
              {Math.round(preview.stats.elapsedSeconds)}s on the{' '}
              {preview.stats.device === 'webgpu' ? 'GPU' : 'CPU'} —{' '}
              {(preview.stats.elapsedSeconds / Math.max(1, preview.stats.audioSeconds)).toFixed(1)}×
              realtime
            </p>
          )}

          {preview.lines ? (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="font-mono text-[10px] uppercase tracking-wide text-slate-500">
                  Two voices found — which one is the clinician?
                </span>
                <span className="w-full font-mono text-[10px] text-amber-700">
                  Speaker separation is provisional and not yet validated on real consultations.
                  Read the lines below before using them.
                </span>
                {[0, 1].map((speaker) => (
                  <button
                    key={speaker}
                    type="button"
                    onClick={() =>
                      setRoles({
                        [speaker]: 'clinician',
                        [speaker === 0 ? 1 : 0]: 'patient',
                      })
                    }
                    className={`rounded border px-2 py-1 font-mono text-[10px] ${
                      roles[speaker] === 'clinician'
                        ? 'border-teal-500 bg-teal-50 text-teal-800'
                        : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    Voice {speaker + 1} {roles[speaker] === 'clinician' ? 'is the clinician' : ''}
                  </button>
                ))}
              </div>

              <div className="mt-2 max-h-52 space-y-1.5 overflow-y-auto">
                {preview.lines.map((line, i) => (
                  <div key={`${line.start}-${i}`} className="flex gap-2">
                    <span
                      className={`w-20 shrink-0 font-mono text-[9px] uppercase tracking-wide ${
                        roles[line.speaker] === 'clinician' ? 'text-teal-700' : 'text-slate-500'
                      }`}
                    >
                      {roles[line.speaker] ?? 'clinician'}
                    </span>
                    <span className="font-mono text-[11px] leading-4 text-slate-800">
                      {line.text}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-4 text-slate-800">
              {preview.text}
            </pre>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                const text = preview.lines
                  ? renderTranscript(preview.lines, roles)
                  : preview.text;
                onText(text, { source: preview.source, kind: preview.kind });
                setPreview(null);
              }}
              className="rounded bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-700"
            >
              Use this
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
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
