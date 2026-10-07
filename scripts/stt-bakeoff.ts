// Speech-to-text bake-off: runs every audio file in a folder through AssemblyAI
// with exactly the app's request parameters, and through Deepgram Nova-3 Medical
// when DEEPGRAM_API_KEY is set, then writes the transcripts side by side.
//
//   npx tsx scripts/stt-bakeoff.ts <audio-folder> [--mode consultation|dictation] [--out bakeoff/results.md]
//
// Keys come from .env.local (gitignored via *.local):
//   ASSEMBLYAI_API_KEY=...      required
//   DEEPGRAM_API_KEY=...        optional
//
// Calls the providers directly, not through the proxy. AssemblyAI transcripts
// (and the uploaded audio) are deleted after each run; Deepgram is called with
// mip_opt_out=true. bakeoff/ is gitignored: results may quote real patients.

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import {
  ASSEMBLYAI_BASE,
  buildTranscriptRequest,
  LANGUAGE_CODE,
  MEDICAL_DOMAIN,
  normaliseTranscript,
  SPEECH_MODEL,
  type TranscribeMode,
  type Utterance,
} from '../supabase/functions/_shared/assemblyai.ts';
import { MEDICAL_KEYTERMS } from '../src/config/medicalKeyterms.ts';
import { mergeTurns, speakersIn } from '../src/lib/transcription/format.ts';

const CONTENT_TYPES: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
};

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';
const ASSEMBLYAI_POLL_MS = 3000;
const ASSEMBLYAI_TIMEOUT_MS = 15 * 60 * 1000;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

type EngineRun = {
  engine: string;
  seconds: number | null;
  utterances: Utterance[];
  error?: string;
};

function parseArgs(argv: string[]) {
  const args = { folder: '', mode: 'consultation' as TranscribeMode, out: 'bakeoff/results.md' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--mode') args.mode = argv[++i] === 'dictation' ? 'dictation' : 'consultation';
    else if (a === '--out') args.out = argv[++i] ?? args.out;
    else if (!a.startsWith('--')) args.folder = a;
  }
  return args;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const body = JSON.parse(text) as { error?: string; err_msg?: string; message?: string };
    return `${res.status}: ${body.error ?? body.err_msg ?? body.message ?? text.slice(0, 200)}`;
  } catch {
    return `${res.status}: ${text.slice(0, 200) || res.statusText}`;
  }
}

async function runAssemblyAI(bytes: Uint8Array<ArrayBuffer>, mode: TranscribeMode, key: string): Promise<EngineRun> {
  const engine = 'AssemblyAI';
  const started = Date.now();
  let id: string | null = null;
  try {
    const up = await fetch(`${ASSEMBLYAI_BASE}/upload`, {
      method: 'POST',
      headers: { authorization: key, 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    if (!up.ok) throw new Error(`upload ${await readError(up)}`);
    const { upload_url } = (await up.json()) as { upload_url: string };

    // The app's exact request body, from the same builder the proxy uses.
    const submit = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
      method: 'POST',
      headers: { authorization: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildTranscriptRequest(upload_url, mode, MEDICAL_KEYTERMS)),
    });
    if (!submit.ok) throw new Error(`submit ${await readError(submit)}`);
    id = ((await submit.json()) as { id: string }).id;

    for (;;) {
      if (Date.now() - started > ASSEMBLYAI_TIMEOUT_MS) throw new Error('timed out after 15 minutes');
      await sleep(ASSEMBLYAI_POLL_MS);
      const res = await fetch(`${ASSEMBLYAI_BASE}/transcript/${id}`, { headers: { authorization: key } });
      if (!res.ok) throw new Error(`poll ${await readError(res)}`);
      const data = (await res.json()) as { status: string; error?: string };
      if (data.status === 'completed') {
        return { engine, seconds: (Date.now() - started) / 1000, utterances: normaliseTranscript(data).utterances };
      }
      if (data.status === 'error') throw new Error(data.error ?? 'transcription failed');
    }
  } catch (e) {
    return { engine, seconds: null, utterances: [], error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (id) {
      await fetch(`${ASSEMBLYAI_BASE}/transcript/${id}`, {
        method: 'DELETE',
        headers: { authorization: key },
      }).catch(() => undefined);
    }
  }
}

type DeepgramUtterance = { speaker?: number; transcript?: string; start?: number; end?: number };

async function runDeepgram(
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string,
  mode: TranscribeMode,
  key: string,
): Promise<EngineRun> {
  const engine = 'Deepgram';
  const started = Date.now();
  const params = new URLSearchParams({
    model: 'nova-3-medical',
    language: 'en',
    smart_format: 'true',
    punctuate: 'true',
    utterances: 'true',
    mip_opt_out: 'true',
  });
  // diarize=true is deprecated in favour of diarize_model.
  if (mode === 'consultation') params.set('diarize_model', 'latest');
  for (const term of MEDICAL_KEYTERMS) params.append('keyterm', term);

  try {
    const res = await fetch(`${DEEPGRAM_URL}?${params}`, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': contentType },
      body: bytes,
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = (await res.json()) as {
      results?: {
        utterances?: DeepgramUtterance[];
        channels?: Array<{ alternatives?: Array<{ transcript?: string }> }>;
      };
    };

    let utterances: Utterance[] = (data.results?.utterances ?? [])
      .map((u) => ({
        speaker: LETTERS[u.speaker ?? 0] ?? String(u.speaker),
        text: (u.transcript ?? '').trim(),
        start: Math.round((u.start ?? 0) * 1000),
        end: Math.round((u.end ?? 0) * 1000),
      }))
      .filter((u) => u.text.length > 0);

    if (utterances.length === 0) {
      const text = data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';
      if (text) utterances = [{ speaker: 'A', text, start: 0, end: 0 }];
    }

    return { engine, seconds: (Date.now() - started) / 1000, utterances };
  } catch (e) {
    return { engine, seconds: null, utterances: [], error: e instanceof Error ? e.message : String(e) };
  }
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || '—';
}

// Which listed terms appear in the output. Presence, not correctness: a term can
// appear in the wrong place, so read the turns before trusting the count.
function keytermsIn(utterances: Utterance[]): Set<string> {
  const text = ` ${utterances.map((u) => u.text).join(' ').toLowerCase()} `;
  const found = new Set<string>();
  for (const term of MEDICAL_KEYTERMS) {
    const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(text)) found.add(term);
  }
  return found;
}

function section(file: string, runs: EngineRun[]): string {
  const lines: string[] = [`## ${file}`, ''];
  const header = `| | ${runs.map((r) => r.engine).join(' | ')} |`;
  const rule = `|---|${runs.map(() => '---').join('|')}|`;
  const found = runs.map((r) => keytermsIn(r.utterances));

  lines.push(header, rule);
  lines.push(`| Time | ${runs.map((r) => (r.seconds === null ? '—' : `${r.seconds.toFixed(1)} s`)).join(' | ')} |`);
  lines.push(`| Speakers | ${runs.map((r) => (r.error ? '—' : String(speakersIn(r.utterances).length))).join(' | ')} |`);
  lines.push(`| Keyterms present in output | ${runs.map((r, i) => (r.error ? '—' : String(found[i].size))).join(' | ')} |`);
  lines.push(`| Error | ${runs.map((r) => cell(r.error ?? '')).join(' | ')} |`);
  lines.push('');

  if (runs.length === 2 && !runs[0].error && !runs[1].error) {
    const onlyA = [...found[0]].filter((t) => !found[1].has(t));
    const onlyB = [...found[1]].filter((t) => !found[0].has(t));
    if (onlyA.length || onlyB.length) {
      lines.push(`Keyterms only in ${runs[0].engine}: ${onlyA.join(', ') || 'none'}  `);
      lines.push(`Keyterms only in ${runs[1].engine}: ${onlyB.join(', ') || 'none'}`);
      lines.push('');
    }
  }

  const turns = runs.map((r) => mergeTurns(r.utterances));
  const rows = Math.max(0, ...turns.map((t) => t.length));
  if (rows > 0) {
    lines.push(`| # | ${runs.map((r) => r.engine).join(' | ')} |`);
    lines.push(`|---|${runs.map(() => '---').join('|')}|`);
    for (let i = 0; i < rows; i += 1) {
      const cells = turns.map((t) => (t[i] ? `**${t[i].speaker}:** ${cell(t[i].text)}` : ''));
      lines.push(`| ${i + 1} | ${cells.join(' | ')} |`);
    }
    lines.push('');
    lines.push('Turns are aligned by position, not time: a split or merged turn shifts every row after it.');
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');

  const args = parseArgs(process.argv.slice(2));
  if (!args.folder) {
    console.error('Usage: npx tsx scripts/stt-bakeoff.ts <audio-folder> [--mode consultation|dictation] [--out bakeoff/results.md]');
    process.exit(2);
  }

  const assemblyKey = process.env.ASSEMBLYAI_API_KEY ?? '';
  const deepgramKey = process.env.DEEPGRAM_API_KEY ?? '';
  if (!assemblyKey) {
    console.error('ASSEMBLYAI_API_KEY is not set. Put it in .env.local (gitignored).');
    process.exit(2);
  }

  const folder = resolve(args.folder);
  if (!existsSync(folder) || !(await stat(folder)).isDirectory()) {
    console.error(`Not a folder: ${folder}`);
    process.exit(2);
  }

  const files = (await readdir(folder))
    .filter((f) => CONTENT_TYPES[extname(f).toLowerCase()])
    .sort();
  if (files.length === 0) {
    console.error(`No audio files in ${folder} (${Object.keys(CONTENT_TYPES).join(' ')})`);
    process.exit(2);
  }

  const sections: string[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await readFile(join(folder, file)));
    const contentType = CONTENT_TYPES[extname(file).toLowerCase()];
    console.log(`${file} (${(bytes.byteLength / 1048576).toFixed(1)} MB)`);

    const tasks: Array<Promise<EngineRun>> = [runAssemblyAI(bytes, args.mode, assemblyKey)];
    if (deepgramKey) tasks.push(runDeepgram(bytes, contentType, args.mode, deepgramKey));
    const runs = await Promise.all(tasks);

    for (const r of runs) {
      console.log(`  ${r.engine.padEnd(10)} ${r.error ? `error — ${r.error}` : `${r.seconds?.toFixed(1)} s, ${speakersIn(r.utterances).length} speakers`}`);
    }
    sections.push(section(file, runs));
  }

  const header = [
    '# Speech-to-text bake-off',
    '',
    `Generated ${new Date().toISOString()} · mode: ${args.mode} · ${files.length} file(s) · ${MEDICAL_KEYTERMS.length} keyterms`,
    '',
    `- **AssemblyAI** — the app's exact request: \`${SPEECH_MODEL}\`, domain \`${MEDICAL_DOMAIN}\`, language \`${LANGUAGE_CODE}\`, speaker labels (${args.mode === 'consultation' ? '2–3 expected' : '1 expected'}), keyterms. Transcript and upload deleted after each file.`,
    deepgramKey
      ? `- **Deepgram** — \`nova-3-medical\`, language \`en\`, ${args.mode === 'consultation' ? '`diarize_model=latest`, ' : ''}utterances, smart_format, punctuate, the same keyterms, \`mip_opt_out=true\`.`
      : '- **Deepgram** — skipped: DEEPGRAM_API_KEY not set.',
    '',
    '"Keyterms present in output" counts listed terms that appear anywhere in the transcript. It is a quick signal for drug and lab names, not an accuracy score.',
    '',
  ].join('\n');

  const out = resolve(args.out);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${header}\n${sections.join('\n')}`, 'utf8');
  console.log(`\nWrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
