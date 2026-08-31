export type CaptureProgress = { stage: string; pct: number | null };

export type ProgressFn = (p: CaptureProgress) => void;

export type WhisperSize = 'base' | 'small';

export const WHISPER_MODELS: Record<WhisperSize, { id: string; label: string; note: string }> = {
  base: {
    id: 'Xenova/whisper-base.en',
    label: 'Faster',
    note: '~80MB once. Misreads some drug names and doses.',
  },
  small: {
    id: 'Xenova/whisper-small.en',
    label: 'More accurate',
    note: '~250MB once. Markedly better on drug names and doses.',
  },
};

function clampPct(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!isFinite(n)) return null;
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
}

export function tidyOcrText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, i, all) => line.length > 0 || (i > 0 && all[i - 1].length > 0))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function ocrImage(file: Blob, onProgress: ProgressFn): Promise<string> {
  const { createWorker } = await import('tesseract.js');

  onProgress({ stage: 'loading the recogniser', pct: null });

  const worker = await createWorker('eng', 1, {
    logger: (m: { status?: string; progress?: number }) => {
      onProgress({ stage: m.status ?? 'working', pct: clampPct(m.progress) });
    },
  });

  try {
    const { data } = await worker.recognize(file);
    return tidyOcrText(data.text ?? '');
  } finally {
    await worker.terminate();
  }
}

type AsrPipeline = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ text?: string } | Array<{ text?: string }>>;

const asrCache = new Map<WhisperSize, AsrPipeline>();

async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer();
  const Ctor: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  const ctx = new Ctor({ sampleRate: 16000 });
  try {
    const decoded = await ctx.decodeAudioData(bytes);
    if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);

    const left = decoded.getChannelData(0);
    const right = decoded.getChannelData(1);
    const mixed = new Float32Array(left.length);
    for (let i = 0; i < left.length; i += 1) mixed[i] = (left[i] + right[i]) / 2;
    return mixed;
  } finally {
    await ctx.close();
  }
}

export async function transcribeAudio(
  blob: Blob,
  onProgress: ProgressFn,
  size: WhisperSize = 'base',
): Promise<string> {
  let asr = asrCache.get(size);

  if (!asr) {
    onProgress({ stage: `downloading the ${size} speech model, one time`, pct: null });
    const { pipeline } = await import('@huggingface/transformers');
    const built = await pipeline('automatic-speech-recognition', WHISPER_MODELS[size].id, {
      dtype: 'q8',
      progress_callback: (p: { status?: string; progress?: number }) => {
        onProgress({ stage: p.status ?? 'loading', pct: clampPct(p.progress) });
      },
    });
    asr = built as unknown as AsrPipeline;
    asrCache.set(size, asr);
  }

  onProgress({ stage: 'decoding the recording', pct: null });
  const audio = await decodeToMono16k(blob);

  onProgress({ stage: 'transcribing', pct: null });
  const output = await asr(audio, { chunk_length_s: 30, stride_length_s: 5 });
  const text = Array.isArray(output) ? output.map((o) => o.text ?? '').join(' ') : output.text ?? '';
  return text.trim();
}

export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof window.MediaRecorder === 'function'
  );
}
