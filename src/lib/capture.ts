export type CaptureProgress = { stage: string; pct: number | null };

export type ProgressFn = (p: CaptureProgress) => void;

export type WhisperChoice = 'base.en' | 'small.en' | 'base' | 'small';

export type WhisperModel = {
  id: string;
  label: string;
  size: string;
  multilingual: boolean;
  note: string;
};

export const WHISPER_MODELS: Record<WhisperChoice, WhisperModel> = {
  'base.en': {
    id: 'Xenova/whisper-base.en',
    label: 'English · faster',
    size: '~80MB',
    multilingual: false,
    note: 'Misreads some drug names and doses. Fine for a quick demo.',
  },
  'small.en': {
    id: 'Xenova/whisper-small.en',
    label: 'English · accurate',
    size: '~250MB',
    multilingual: false,
    note: 'Markedly better on drug names and doses. Use this for anything clinical.',
  },
  base: {
    id: 'Xenova/whisper-base',
    label: 'Multilingual · faster',
    size: '~80MB',
    multilingual: true,
    note: 'Attempts Hausa, Yoruba, Igbo. Weak on all three — treat output as a draft.',
  },
  small: {
    id: 'Xenova/whisper-small',
    label: 'Multilingual · accurate',
    size: '~250MB',
    multilingual: true,
    note: 'Best available here for mixed-language consultations. Still untested on Pidgin.',
  },
};

export const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'auto', label: 'Detect automatically' },
  { code: 'en', label: 'English' },
  { code: 'ha', label: 'Hausa' },
  { code: 'yo', label: 'Yoruba' },
  { code: 'ig', label: 'Igbo' },
];

export type TranscriptResult = {
  text: string;
  device: 'webgpu' | 'wasm';
  audioSeconds: number;
  elapsedSeconds: number;
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

type Loaded = { asr: AsrPipeline; device: 'webgpu' | 'wasm' };

const asrCache = new Map<string, Loaded>();

export async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

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

async function loadAsr(choice: WhisperChoice, onProgress: ProgressFn): Promise<Loaded> {
  const cached = asrCache.get(choice);
  if (cached) return cached;

  const model = WHISPER_MODELS[choice];
  const { pipeline } = await import('@huggingface/transformers');

  const progress_callback = (p: { status?: string; progress?: number }) => {
    onProgress({ stage: p.status ?? 'loading', pct: clampPct(p.progress) });
  };

  // WebGPU is the difference between roughly realtime and several times slower
  // than realtime, so it is worth attempting and falling back from.
  if (await hasWebGpu()) {
    try {
      onProgress({ stage: `loading ${model.size} model onto the GPU`, pct: null });
      const built = await pipeline('automatic-speech-recognition', model.id, {
        device: 'webgpu',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        progress_callback,
      });
      const loaded: Loaded = { asr: built as unknown as AsrPipeline, device: 'webgpu' };
      asrCache.set(choice, loaded);
      return loaded;
    } catch {
      onProgress({ stage: 'GPU unavailable, falling back to CPU', pct: null });
    }
  }

  onProgress({ stage: `loading ${model.size} model (CPU)`, pct: null });
  const built = await pipeline('automatic-speech-recognition', model.id, {
    dtype: 'q8',
    progress_callback,
  });
  const loaded: Loaded = { asr: built as unknown as AsrPipeline, device: 'wasm' };
  asrCache.set(choice, loaded);
  return loaded;
}

export async function transcribeAudio(
  blob: Blob,
  onProgress: ProgressFn,
  choice: WhisperChoice = 'base.en',
  language = 'auto',
): Promise<TranscriptResult> {
  const { asr, device } = await loadAsr(choice, onProgress);

  onProgress({ stage: 'decoding the recording', pct: null });
  const audio = await decodeToMono16k(blob);
  const audioSeconds = audio.length / 16000;

  onProgress({
    stage: `transcribing ${Math.round(audioSeconds)}s of audio on the ${
      device === 'webgpu' ? 'GPU' : 'CPU'
    }`,
    pct: null,
  });

  const options: Record<string, unknown> = { chunk_length_s: 30, stride_length_s: 5 };
  if (WHISPER_MODELS[choice].multilingual) {
    options.task = 'transcribe';
    if (language !== 'auto') options.language = language;
  }

  const started = Date.now();
  const output = await asr(audio, options);
  const text = Array.isArray(output) ? output.map((o) => o.text ?? '').join(' ') : output.text ?? '';

  return {
    text: text.trim(),
    device,
    audioSeconds,
    elapsedSeconds: (Date.now() - started) / 1000,
  };
}

export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof window.MediaRecorder === 'function'
  );
}
