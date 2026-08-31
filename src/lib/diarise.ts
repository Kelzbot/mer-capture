import type { CaptureProgress, ProgressFn } from './capture';

const SEGMENTATION_MODEL = 'onnx-community/pyannote-segmentation-3.0';
const EMBEDDING_MODEL = 'onnx-community/wespeaker-voxceleb-resnet34-LM';

const SAMPLE_RATE = 16000;

// Below this, WeSpeaker has too little signal to produce a usable embedding.
const MIN_EMBED_SECONDS = 0.6;

export type SpeakerTurn = { start: number; end: number; speaker: number };

export type TranscriptChunk = { text: string; timestamp: [number, number | null] };

export type LabelledLine = { speaker: number; text: string; start: number; end: number };

export type Role = 'clinician' | 'patient';

type Vec = Float32Array;

function cosine(a: Vec, b: Vec): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function meanVec(vectors: Vec[]): Vec {
  const out = new Float32Array(vectors[0].length);
  for (const v of vectors) for (let i = 0; i < v.length; i += 1) out[i] += v[i];
  for (let i = 0; i < out.length; i += 1) out[i] /= vectors.length;
  return out;
}

/**
 * Two-speaker clustering. Seeds on the least similar pair — in a consultation the
 * two most acoustically distant turns are almost always the two different people —
 * then runs a few assignment/centroid passes.
 */
function clusterTwo(vectors: Vec[]): number[] {
  if (vectors.length < 2) return vectors.map(() => 0);

  let seedA = 0;
  let seedB = 1;
  let worst = Infinity;
  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      const sim = cosine(vectors[i], vectors[j]);
      if (sim < worst) {
        worst = sim;
        seedA = i;
        seedB = j;
      }
    }
  }

  // Everything sounds like one person: a solo dictation, not a conversation.
  if (worst > 0.82) return vectors.map(() => 0);

  let centroidA = vectors[seedA];
  let centroidB = vectors[seedB];
  let assignment = vectors.map(() => 0);

  for (let pass = 0; pass < 6; pass += 1) {
    assignment = vectors.map((v) => (cosine(v, centroidA) >= cosine(v, centroidB) ? 0 : 1));
    const groupA = vectors.filter((_, i) => assignment[i] === 0);
    const groupB = vectors.filter((_, i) => assignment[i] === 1);
    if (groupA.length === 0 || groupB.length === 0) break;
    centroidA = meanVec(groupA);
    centroidB = meanVec(groupB);
  }

  return assignment;
}

function mergeTurns(turns: SpeakerTurn[]): SpeakerTurn[] {
  const sorted = [...turns].sort((a, b) => a.start - b.start);
  const out: SpeakerTurn[] = [];
  for (const t of sorted) {
    const last = out[out.length - 1];
    if (last && last.speaker === t.speaker && t.start - last.end < 0.75) {
      last.end = Math.max(last.end, t.end);
    } else {
      out.push({ ...t });
    }
  }
  return out;
}

export async function diariseAudio(
  audio: Float32Array,
  onProgress: ProgressFn,
): Promise<SpeakerTurn[]> {
  const { AutoModel, AutoModelForAudioFrameClassification, AutoProcessor } = await import(
    '@huggingface/transformers'
  );

  onProgress({ stage: 'loading the speaker segmenter', pct: null });
  const segProcessor = await AutoProcessor.from_pretrained(SEGMENTATION_MODEL);
  const segModel = await AutoModelForAudioFrameClassification.from_pretrained(SEGMENTATION_MODEL);

  onProgress({ stage: 'finding who speaks when', pct: null });
  const segInputs = await segProcessor(audio);
  const { logits } = await segModel(segInputs);

  const extractor = (segProcessor as unknown as {
    feature_extractor?: { post_process_speaker_diarization: PostProcess };
    post_process_speaker_diarization?: PostProcess;
  });
  const post =
    extractor.feature_extractor?.post_process_speaker_diarization ??
    extractor.post_process_speaker_diarization;
  if (!post) throw new Error('This build of transformers.js cannot post-process diarisation');

  const owner = extractor.feature_extractor ?? extractor;
  // In pyannote's powerset encoding, class 0 is non-speech. Clustering without
  // dropping it separates speech from silence rather than one person from another.
  const batches = post.call(owner, logits, audio.length);
  const raw = (batches?.[0] ?? []).filter((s) => s.id !== 0 && s.end > s.start);

  if (raw.length === 0) return [];

  onProgress({ stage: 'loading the voice-fingerprint model', pct: null });
  const embProcessor = await AutoProcessor.from_pretrained(EMBEDDING_MODEL);
  const embModel = await AutoModel.from_pretrained(EMBEDDING_MODEL);

  const usable: Array<{ segment: (typeof raw)[number]; index: number }> = [];
  raw.forEach((segment, index) => {
    if (segment.end - segment.start >= MIN_EMBED_SECONDS) usable.push({ segment, index });
  });

  if (usable.length < 2) {
    return mergeTurns(raw.map((s) => ({ start: s.start, end: s.end, speaker: 0 })));
  }

  const vectors: Vec[] = [];
  for (let i = 0; i < usable.length; i += 1) {
    onProgress({ stage: 'fingerprinting voices', pct: i / usable.length });
    const { segment } = usable[i];
    const from = Math.max(0, Math.floor(segment.start * SAMPLE_RATE));
    const to = Math.min(audio.length, Math.ceil(segment.end * SAMPLE_RATE));
    const slice = audio.slice(from, to);
    const inputs = await embProcessor(slice);
    const output = await embModel(inputs);
    const tensor =
      (output as Record<string, { data?: Float32Array }>).embeddings ??
      Object.values(output as Record<string, { data?: Float32Array }>)[0];
    const data = tensor?.data;
    if (!data) throw new Error('The voice-fingerprint model returned no embedding');
    vectors.push(data instanceof Float32Array ? data : new Float32Array(data));
  }

  const labels = clusterTwo(vectors);

  const speakerOf = new Map<number, number>();
  usable.forEach((u, i) => speakerOf.set(u.index, labels[i]));

  // Segments too short to fingerprint inherit the nearest labelled segment.
  const turns: SpeakerTurn[] = raw.map((s, index) => {
    let speaker = speakerOf.get(index);
    if (speaker === undefined) {
      let best = Infinity;
      for (const [otherIndex, otherSpeaker] of speakerOf) {
        const distance = Math.abs(otherIndex - index);
        if (distance < best) {
          best = distance;
          speaker = otherSpeaker;
        }
      }
    }
    return { start: s.start, end: s.end, speaker: speaker ?? 0 };
  });

  return mergeTurns(turns);
}

type PostProcess = (
  logits: unknown,
  numSamples: number,
) => Array<Array<{ id: number; start: number; end: number; confidence: number }>>;

function overlap(a: [number, number], b: [number, number]): number {
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
}

export function labelChunks(chunks: TranscriptChunk[], turns: SpeakerTurn[]): LabelledLine[] {
  if (turns.length === 0) return [];

  const lines: LabelledLine[] = [];

  for (const chunk of chunks) {
    const text = (chunk.text ?? '').trim();
    if (!text) continue;

    const start = chunk.timestamp?.[0] ?? 0;
    const end = chunk.timestamp?.[1] ?? start + 1;

    let speaker = turns[0].speaker;
    let best = 0;
    for (const turn of turns) {
      const shared = overlap([start, end], [turn.start, turn.end]);
      if (shared > best) {
        best = shared;
        speaker = turn.speaker;
      }
    }

    const last = lines[lines.length - 1];
    if (last && last.speaker === speaker) {
      last.text = `${last.text} ${text}`.replace(/\s+/g, ' ');
      last.end = end;
    } else {
      lines.push({ speaker, text, start, end });
    }
  }

  return lines;
}

export function countSpeakers(turns: SpeakerTurn[]): number {
  return new Set(turns.map((t) => t.speaker)).size;
}

export function renderTranscript(lines: LabelledLine[], roles: Record<number, Role>): string {
  return lines
    .map((line) => `${(roles[line.speaker] ?? 'clinician').toUpperCase()}: ${line.text}`)
    .join('\n');
}

export type { CaptureProgress };
