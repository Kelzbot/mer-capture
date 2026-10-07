// Transcription proxy. The AssemblyAI key lives only here, as a Supabase secret.
//
// Audio never passes through this function. Supabase does not document an
// incoming request-body limit for Edge Functions, and a 15-minute encounter at
// 64 kbps is ~7 MB, so the browser uploads straight to private Storage with a
// single-use signed URL and AssemblyAI fetches it from a short-lived signed URL.
//
//   POST {action:"sign", contentType, size}           -> {uploadUrl, path}
//   PUT  <uploadUrl>  (browser -> Storage, raw audio)
//   POST {action:"submit", path, mode, keyterms}      -> {id}
//   GET  ?id=...&path=...                             -> {status} | completed result
//
// On completion (or failure) the transcript is deleted at AssemblyAI and the
// audio deleted from Storage, so neither keeps a copy.
//
// Secrets: ASSEMBLYAI_API_KEY, DEMO_ACCESS_KEY (supabase secrets set).
// Injected by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Optional: ALLOWED_ORIGINS (comma-separated), STORAGE_SERVICE_KEY.

import {
  ASSEMBLYAI_BASE,
  buildTranscriptRequest,
  isDeletedTranscript,
  normaliseTranscript,
  sanitiseKeyterms,
  type TranscribeMode,
} from '../_shared/assemblyai.ts';

const BUCKET = 'stt-audio';
const MAX_BYTES = 25 * 1024 * 1024;
const SIGNED_READ_SECONDS = 60 * 60;
const PATH_PATTERN = /^encounters\/[0-9a-f-]{36}\.(webm|m4a|ogg|wav|mp3|aac|flac|audio)$/;

const DEFAULT_ORIGINS = [
  'https://kelzbot.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const ORIGINS = new Set(allowedOrigins.length > 0 ? allowedOrigins : DEFAULT_ORIGINS);

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const STORAGE = `${SUPABASE_URL}/storage/v1`;
const SERVICE_KEY =
  Deno.env.get('STORAGE_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ASSEMBLYAI_KEY = Deno.env.get('ASSEMBLYAI_API_KEY') ?? '';
const DEMO_KEY = Deno.env.get('DEMO_ACCESS_KEY') ?? '';

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-demo-key',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (origin && ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length || x.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

function storageHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...extra };
}

function extensionFor(contentType: string): string {
  const base = contentType.split(';')[0].trim().toLowerCase();
  if (base === 'audio/webm') return 'webm';
  if (base === 'audio/mp4' || base === 'audio/x-m4a' || base === 'audio/m4a') return 'm4a';
  if (base === 'audio/aac') return 'aac';
  if (base === 'audio/ogg') return 'ogg';
  if (base === 'audio/wav' || base === 'audio/x-wav' || base === 'audio/wave') return 'wav';
  if (base === 'audio/mpeg' || base === 'audio/mp3') return 'mp3';
  if (base === 'audio/flac' || base === 'audio/x-flac') return 'flac';
  return 'audio';
}

async function ensureBucket(): Promise<void> {
  const res = await fetch(`${STORAGE}/bucket`, {
    method: 'POST',
    headers: storageHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: false,
      file_size_limit: MAX_BYTES,
      allowed_mime_types: ['audio/*'],
    }),
  });
  // 409 / "already exists" is the normal case after the first request.
  if (!res.ok && res.status !== 409) {
    const detail = await res.text().catch(() => '');
    if (!/already exists|duplicate/i.test(detail)) {
      throw new Error(`Could not create storage bucket (${res.status}): ${detail.slice(0, 200)}`);
    }
  }
}

async function signUpload(path: string): Promise<string> {
  const attempt = () =>
    fetch(`${STORAGE}/object/upload/sign/${BUCKET}/${path}`, {
      method: 'POST',
      headers: storageHeaders({ 'Content-Type': 'application/json' }),
      body: '{}',
    });

  // A missing bucket is reported in more than one wording ("Bucket not found",
  // "The related resource does not exist"), so don't match on the text: on any
  // refusal, make sure the bucket exists (a no-op if it does) and try once more.
  let res = await attempt();
  if (!res.ok) {
    await res.body?.cancel();
    await ensureBucket();
    res = await attempt();
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Storage refused the upload URL (${res.status}): ${detail.slice(0, 200)}`);
    }
  }

  const data = (await res.json()) as { url?: string };
  if (!data.url) throw new Error('Storage returned no upload URL');
  return `${STORAGE}${data.url}`;
}

async function signRead(path: string): Promise<string> {
  const res = await fetch(`${STORAGE}/object/sign/${BUCKET}/${path}`, {
    method: 'POST',
    headers: storageHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ expiresIn: SIGNED_READ_SECONDS }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Audio not found in storage (${res.status}): ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { signedURL?: string; signedUrl?: string };
  const signed = data.signedURL ?? data.signedUrl;
  if (!signed) throw new Error('Storage returned no signed URL');
  return `${STORAGE}${signed}`;
}

async function deleteAudio(path: string | null): Promise<void> {
  if (!path || !PATH_PATTERN.test(path)) return;
  const res = await fetch(`${STORAGE}/object/${BUCKET}`, {
    method: 'DELETE',
    headers: storageHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: [path] }),
  }).catch(() => null);
  if (!res || !res.ok) console.warn(`storage delete failed for ${path}`);
}

async function deleteTranscript(id: string): Promise<void> {
  const res = await fetch(`${ASSEMBLYAI_BASE}/transcript/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { authorization: ASSEMBLYAI_KEY },
  }).catch(() => null);
  if (!res || !res.ok) console.warn(`assemblyai delete failed for ${id}`);
}

async function handleSign(body: Record<string, unknown>, origin: string | null): Promise<Response> {
  const contentType = typeof body.contentType === 'string' ? body.contentType : '';
  const size = typeof body.size === 'number' ? body.size : Number.NaN;

  if (!Number.isFinite(size) || size <= 0) return json({ error: 'size is required' }, 400, origin);
  if (size > MAX_BYTES) {
    return json({ error: `Audio is ${(size / 1048576).toFixed(1)} MB; the limit is 25 MB` }, 413, origin);
  }
  if (!contentType.toLowerCase().startsWith('audio/')) {
    return json({ error: `Not an audio file (${contentType || 'no type'})` }, 415, origin);
  }

  const path = `encounters/${crypto.randomUUID()}.${extensionFor(contentType)}`;
  const uploadUrl = await signUpload(path);
  return json({ uploadUrl, path }, 200, origin);
}

async function handleSubmit(body: Record<string, unknown>, origin: string | null): Promise<Response> {
  const path = typeof body.path === 'string' ? body.path : '';
  if (!PATH_PATTERN.test(path)) return json({ error: 'Invalid audio path' }, 400, origin);

  const mode: TranscribeMode = body.mode === 'dictation' ? 'dictation' : 'consultation';
  const keyterms = sanitiseKeyterms(body.keyterms);

  let audioUrl: string;
  try {
    audioUrl = await signRead(path);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 404, origin);
  }

  const res = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
    method: 'POST',
    headers: { authorization: ASSEMBLYAI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildTranscriptRequest(audioUrl, mode, keyterms)),
  });

  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !data.id) {
    await deleteAudio(path);
    return json(
      { error: `Transcription service rejected the job (${res.status}): ${data.error ?? 'no detail'}` },
      502,
      origin,
    );
  }

  return json({ id: data.id }, 200, origin);
}

async function handleStatus(url: URL, origin: string | null): Promise<Response> {
  const id = url.searchParams.get('id') ?? '';
  const path = url.searchParams.get('path');
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(id)) return json({ error: 'Invalid id' }, 400, origin);

  const res = await fetch(`${ASSEMBLYAI_BASE}/transcript/${encodeURIComponent(id)}`, {
    headers: { authorization: ASSEMBLYAI_KEY },
  });

  if (res.status === 404) return json({ status: 'deleted' }, 200, origin);
  if (!res.ok) return json({ error: `Status check failed (${res.status})` }, 502, origin);

  const data = (await res.json()) as { status?: string; error?: string };

  if (data.status === 'queued' || data.status === 'processing') {
    return json({ status: data.status }, 200, origin);
  }

  if (data.status === 'completed') {
    if (isDeletedTranscript(data)) return json({ status: 'deleted' }, 200, origin);
    const result = normaliseTranscript(data);
    // Build the response first, then remove both copies.
    await Promise.all([deleteTranscript(id), deleteAudio(path)]);
    return json({ status: 'completed', ...result }, 200, origin);
  }

  await Promise.all([deleteTranscript(id), deleteAudio(path)]);
  return json({ status: 'error', error: data.error ?? 'Transcription failed' }, 200, origin);
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // Browsers always send Origin on these cross-site calls; curl smoke tests don't.
  if (origin && !ORIGINS.has(origin)) return json({ error: 'Origin not allowed' }, 403, origin);

  if (!ASSEMBLYAI_KEY || !DEMO_KEY || !SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'Transcription proxy is not configured' }, 500, origin);
  }

  if (!safeEqual(req.headers.get('x-demo-key') ?? '', DEMO_KEY)) {
    return json({ error: 'Wrong or missing demo passcode' }, 401, origin);
  }

  try {
    if (req.method === 'GET') return await handleStatus(new URL(req.url), origin);

    if (req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) return json({ error: 'Expected a JSON body' }, 400, origin);
      if (body.action === 'sign') return await handleSign(body, origin);
      if (body.action === 'submit') return await handleSubmit(body, origin);
      return json({ error: 'Unknown action' }, 400, origin);
    }

    return json({ error: 'Method not allowed' }, 405, origin);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500, origin);
  }
});
