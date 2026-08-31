import { useRef, useState } from 'react';
import { Camera, CircleX, FileImage, Loader, Mic, Square } from 'lucide-react';
import {
  isRecordingSupported,
  ocrImage,
  transcribeAudio,
  WHISPER_MODELS,
  type CaptureProgress,
  type WhisperSize,
} from '../lib/capture';

type Props = {
  onText: (text: string, source: 'photo' | 'voice') => void;
  disabled?: boolean;
};

type Mode = 'photo' | 'voice';

export default function Capture({ onText, disabled }: Props) {
  const [busy, setBusy] = useState<Mode | null>(null);
  const [progress, setProgress] = useState<CaptureProgress | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ text: string; source: Mode } | null>(null);
  const [size, setSize] = useState<WhisperSize>('base');

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const canRecord = isRecordingSupported();

  async function runOcr(file: File) {
    setError(null);
    setPreview(null);
    setBusy('photo');
    try {
      const text = await ocrImage(file, setProgress);
      if (!text.trim()) throw new Error('No readable text was found in that image');
      setPreview({ text, source: 'photo' });
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
          const text = await transcribeAudio(blob, setProgress, size);
          if (!text.trim()) throw new Error('Nothing audible was transcribed from that recording');
          setPreview({ text, source: 'voice' });
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

  const working = busy !== null;

  return (
    <div className="mt-3 rounded border border-slate-300 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-[10px] uppercase tracking-wide text-slate-500">
          Capture instead of typing
        </span>

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

        {canRecord &&
          (recording ? (
            <button
              type="button"
              onClick={stopRecording}
              className="flex items-center gap-1.5 rounded border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-[11px] font-medium text-rose-700 hover:bg-rose-100"
            >
              <Square size={13} />
              Stop and transcribe
              <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-rose-600" />
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              disabled={working || disabled}
              className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:border-teal-500 hover:text-teal-700 disabled:opacity-40"
            >
              <Mic size={13} />
              Dictate note
            </button>
          ))}
      </div>

      {canRecord && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-slate-500">
            Speech model
          </span>
          {(Object.keys(WHISPER_MODELS) as WhisperSize[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSize(key)}
              disabled={working || recording}
              className={`rounded border px-2 py-1 font-mono text-[10px] disabled:opacity-40 ${
                size === key
                  ? 'border-teal-500 bg-teal-50 text-teal-800'
                  : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
              }`}
            >
              {WHISPER_MODELS[key].label}
            </button>
          ))}
          <span className="font-mono text-[10px] text-slate-500">{WHISPER_MODELS[size].note}</span>
        </div>
      )}

      <p className="mt-2 font-mono text-[10px] leading-4 text-slate-500">
        Both run inside this browser. The photo and the audio never leave the device — only the
        recogniser files are downloaded, once. Handwriting is unreliable; printed and typed forms
        read best.
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
            {preview.source === 'photo' ? 'Read from the image' : 'Transcribed from the recording'}
            <span className="ml-2 normal-case tracking-normal text-slate-400">
              check it against the original before extracting
            </span>
          </p>
          <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-4 text-slate-800">
            {preview.text}
          </pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onText(preview.text, preview.source);
                setPreview(null);
              }}
              className="rounded bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-700"
            >
              Replace the note with this
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
