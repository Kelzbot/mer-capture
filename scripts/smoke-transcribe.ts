// End-to-end check of the deployed transcription proxy, using the app's own
// AssemblyAIProvider: sign -> upload to Storage -> submit -> poll -> result, then
// a final poll to confirm the transcript was deleted at AssemblyAI.
//
//   npx tsx scripts/smoke-transcribe.ts [audio-file]
//
// Asks for the demo passcode (or reads DEMO_KEY). The function URL defaults to
// the deployed project; override with TRANSCRIBE_URL.

import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { AssemblyAIProvider } from '../src/lib/transcription/assemblyai.ts';
import { speakersIn, utterancesToTranscript } from '../src/lib/transcription/format.ts';
import { PasscodeError } from '../src/lib/transcription/types.ts';
import { MEDICAL_KEYTERMS } from '../src/config/medicalKeyterms.ts';

const FUNCTION_URL =
  process.env.TRANSCRIBE_URL ?? 'https://cmistooufkxzxzmhsuds.supabase.co/functions/v1/transcribe';

const TYPES: Record<string, string> = {
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

async function passcode(): Promise<string> {
  if (process.env.DEMO_KEY) return process.env.DEMO_KEY;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Demo passcode: ');
  rl.close();
  return answer.trim();
}

async function main() {
  const path = process.argv[2] ?? 'bakeoff/smoke-consultation.wav';
  const type = TYPES[extname(path).toLowerCase()] ?? 'audio/mpeg';
  const bytes = await readFile(path);
  const audio = new File([bytes], basename(path), { type });
  const key = await passcode();

  const started = Date.now();
  const log = (stage: string) =>
    console.log(`  ${((Date.now() - started) / 1000).toFixed(1).padStart(5)} s  ${stage}`);

  const provider = new AssemblyAIProvider({
    url: FUNCTION_URL,
    getDemoKey: () => key,
    keyterms: MEDICAL_KEYTERMS,
    timeoutMs: 5 * 60 * 1000,
  });

  console.log(`\n${basename(path)} · ${(audio.size / 1048576).toFixed(1)} MB · ${type}`);
  console.log(`${FUNCTION_URL}\n`);

  const job = await provider.start(audio, 'consultation', log);
  log(`job ${job.id}`);
  const result = await provider.wait(job, log);
  log('completed');

  console.log(`\n${result.engine}`);
  console.log(`${speakersIn(result.utterances).length} speakers, ${result.utterances.length} utterances\n`);
  console.log(utterancesToTranscript(result.utterances));

  // The proxy deletes the transcript and the audio once it has delivered them.
  // Polling again should now report it as gone.
  try {
    await provider.wait(job, () => undefined);
    console.log('\nDELETION CHECK: FAILED — the transcript is still retrievable at AssemblyAI');
    process.exitCode = 1;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(
      /already delivered and deleted/i.test(msg)
        ? '\nDELETION CHECK: passed — transcript deleted at AssemblyAI after delivery'
        : `\nDELETION CHECK: unexpected response — ${msg}`,
    );
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`\nFAILED: ${msg}`);
  if (e instanceof PasscodeError) console.error('-> the passcode does not match DEMO_ACCESS_KEY');
  else if (/domain|medical/i.test(msg)) {
    console.error('-> AssemblyAI refused Medical Mode, probably not on this plan. Remove the "domain" line');
    console.error('   in supabase/functions/_shared/assemblyai.ts and redeploy.');
  } else if (/keyterm/i.test(msg)) {
    console.error('-> AssemblyAI refused the keyterms in this combination.');
  }
  process.exitCode = 1;
});
