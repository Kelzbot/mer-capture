import { MAX_AUDIO_BYTES } from '../../config/audioCapture';
import {
  PasscodeError,
  ProxyUnreachableError,
  TranscriptionTimeoutError,
  type StatusFn,
  type TranscribeMode,
  type TranscriptionJob,
  type TranscriptionProvider,
  type TranscriptionResult,
  type Utterance,
} from './types';

export const POLL_INTERVAL_MS = 2500;
export const POLL_TIMEOUT_MS = 3 * 60 * 1000;

type Options = {
  url: string | undefined;
  getDemoKey: () => string;
  keyterms: string[];
  pollIntervalMs?: number;
  timeoutMs?: number;
};

const EXTENSION_TYPES: Record<string, string> = {
  webm: 'audio/webm',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
};

// Some browsers hand over picked files with an empty type; Storage only accepts
// audio/*, so infer it from the extension.
export function audioContentType(audio: Blob): string {
  if (audio.type && audio.type.startsWith('audio/')) return audio.type;
  const name = (audio as File).name ?? '';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return EXTENSION_TYPES[ext] ?? 'audio/mpeg';
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `${res.status} ${res.statusText}`.trim();
}

export class AssemblyAIProvider implements TranscriptionProvider {
  readonly id = 'assemblyai' as const;
  readonly label = 'Cloud — medical transcription';
  readonly onDevice = false;

  private readonly url: string;
  private readonly getDemoKey: () => string;
  private readonly keyterms: string[];
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(options: Options) {
    this.url = (options.url ?? '').trim();
    this.getDemoKey = options.getDemoKey;
    this.keyterms = options.keyterms;
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? POLL_TIMEOUT_MS;
  }

  private endpoint(query?: Record<string, string>): string {
    const url = new URL(this.url);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return url.toString();
  }

  private async call(init: RequestInit, query?: Record<string, string>): Promise<Response> {
    if (!this.url) {
      throw new ProxyUnreachableError('No transcription service is configured for this build');
    }
    let target: string;
    try {
      target = this.endpoint(query);
    } catch {
      throw new ProxyUnreachableError(`The transcription service URL is not valid: ${this.url}`);
    }
    try {
      return await fetch(target, {
        ...init,
        cache: 'no-store',
        headers: { ...(init.headers ?? {}), 'x-demo-key': this.getDemoKey() },
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new ProxyUnreachableError(
        `Could not reach the transcription service (${e instanceof Error ? e.message : String(e)})`,
      );
    }
  }

  // 401 is a passcode problem, not an outage; 404 and 5xx mean the proxy is
  // wrong or down, which is what the offline fallback exists for.
  private async failure(res: Response, during: string): Promise<Error> {
    const detail = await errorText(res);
    if (res.status === 401) return new PasscodeError(detail);
    if (res.status === 404 || res.status >= 500) {
      return new ProxyUnreachableError(`Transcription service failed while ${during} (${detail})`);
    }
    return new Error(detail);
  }

  private async postJson<T>(payload: Record<string, unknown>, during: string): Promise<T> {
    const res = await this.call({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await this.failure(res, during);
    return (await res.json()) as T;
  }

  async start(audio: Blob, mode: TranscribeMode, onStatus: StatusFn): Promise<TranscriptionJob> {
    if (!this.getDemoKey()) {
      throw new PasscodeError('Enter the transcription passcode to use cloud transcription');
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      throw new Error(
        `Audio is ${(audio.size / 1048576).toFixed(1)} MB; cloud transcription accepts up to 25 MB`,
      );
    }

    const contentType = audioContentType(audio);

    onStatus('requesting an upload slot');
    const { uploadUrl, path } = await this.postJson<{ uploadUrl: string; path: string }>(
      { action: 'sign', contentType, size: audio.size },
      'preparing the upload',
    );

    onStatus(`uploading ${(audio.size / 1048576).toFixed(1)} MB`);
    let put: Response;
    try {
      put = await fetch(uploadUrl, {
        method: 'PUT',
        body: audio,
        cache: 'no-store',
        headers: { 'Content-Type': contentType, 'x-upsert': 'false' },
      });
    } catch (e) {
      throw new ProxyUnreachableError(
        `Upload failed (${e instanceof Error ? e.message : String(e)})`,
      );
    }
    if (!put.ok) throw new Error(`Upload was refused (${await errorText(put)})`);

    onStatus('submitting');
    const { id } = await this.postJson<{ id: string }>(
      { action: 'submit', path, mode, keyterms: this.keyterms },
      'submitting the job',
    );

    return { provider: 'assemblyai', id, path, mode };
  }

  async wait(
    job: TranscriptionJob,
    onStatus: StatusFn,
    signal?: AbortSignal,
  ): Promise<TranscriptionResult> {
    const startedAt = Date.now();
    const query: Record<string, string> = { id: job.id };
    if (job.path) query.path = job.path;

    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (Date.now() - startedAt >= this.timeoutMs) {
        throw new TranscriptionTimeoutError(
          job,
          'Still transcribing after 3 minutes. The job is still running at the service.',
        );
      }

      let res: Response | null = null;
      try {
        res = await this.call({ method: 'GET', signal }, query);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        // A dropped poll on clinic Wi-Fi is not a failed job. Keep polling until
        // the timeout; Retry picks the same job up again.
        onStatus('connection dropped, retrying');
      }

      if (res) {
        if (res.status === 401) throw new PasscodeError(await errorText(res));
        if (res.ok) {
          const data = (await res.json()) as {
            status?: string;
            error?: string;
            text?: string;
            utterances?: Utterance[];
          };
          if (data.status === 'completed') {
            return {
              text: data.text ?? '',
              utterances: data.utterances ?? [],
              engine: 'Cloud · AssemblyAI Universal-3.5 Pro · medical mode',
            };
          }
          if (data.status === 'error') throw new Error(data.error ?? 'Transcription failed');
          if (data.status === 'deleted') {
            throw new Error(
              'This transcript was already delivered and deleted at the service. Record or upload the audio again.',
            );
          }
          onStatus(data.status === 'queued' ? 'queued' : 'processing');
        } else if (res.status !== 404 && res.status < 500) {
          throw new Error(await errorText(res));
        } else {
          onStatus('service busy, retrying');
        }
      }

      await sleep(this.pollIntervalMs, signal);
    }
  }
}
