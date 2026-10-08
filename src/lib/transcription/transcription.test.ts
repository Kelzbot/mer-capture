import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildTranscriptRequest,
  normaliseTranscript,
  sanitiseKeyterms,
} from '../../../supabase/functions/_shared/assemblyai.ts';
import { MEDICAL_KEYTERMS } from '../../config/medicalKeyterms';
import { AssemblyAIProvider } from './assemblyai';
import { nextSpeaker, speakersIn, splitSentences, toLines, utterancesToTranscript } from './format';
import { startWithFallback } from './run';
import {
  PasscodeError,
  TranscriptionTimeoutError,
  type TranscriptionJob,
  type TranscriptionProvider,
} from './types';

// Shaped like GET /v2/transcript/{id} when speaker_labels is on: speaker letters,
// times in milliseconds, padding and stray whitespace left in on purpose.
const ASSEMBLYAI_FIXTURE = {
  id: 'fixture-transcript-1',
  status: 'completed',
  text: 'Good morning, what brings you in? I have had a cough for five days. Any fever? Yes, at night. She has not been eating well either. Let us start amoxicillin-clavulanate 625 mg.',
  utterances: [
    { speaker: 'A', text: ' Good morning, what brings you in? ', start: 240, end: 2100, confidence: 0.97, words: [] },
    { speaker: 'B', text: 'I have had a cough for five days.', start: 2400, end: 4800, confidence: 0.95, words: [] },
    { speaker: 'A', text: 'Any fever?', start: 5000, end: 5900, confidence: 0.98, words: [] },
    { speaker: 'B', text: 'Yes,   at night.', start: 6100, end: 7300, confidence: 0.94, words: [] },
    { speaker: 'C', text: 'She has not been eating well either.', start: 7500, end: 9800, confidence: 0.9, words: [] },
    { speaker: 'A', text: 'Let us start', start: 10100, end: 10900, confidence: 0.96, words: [] },
    { speaker: 'A', text: 'amoxicillin-clavulanate 625 mg.', start: 10900, end: 12700, confidence: 0.93, words: [] },
  ],
};

const SEED_KEYTERMS = [
  'TLD', 'dolutegravir', 'tenofovir', 'lamivudine', 'efavirenz', 'cotrimoxazole', 'isoniazid',
  'TPT', 'viral load', 'CD4', 'ART', 'PrEP', 'PMTCT', 'EAC', 'MMD', 'GeneXpert', 'TB LAM',
  'artemether-lumefantrine', 'malaria RDT', 'Widal', 'PCV', 'FBC', 'amlodipine', 'lisinopril',
  'metformin', 'ceftriaxone', 'ciprofloxacin', 'amoxicillin', 'paracetamol',
];

describe('AssemblyAI response to extraction input', () => {
  it('normalises utterances: trims, collapses whitespace, keeps milliseconds', () => {
    const { utterances } = normaliseTranscript(ASSEMBLYAI_FIXTURE);
    expect(utterances).toHaveLength(7);
    expect(utterances[0]).toEqual({
      speaker: 'A',
      text: 'Good morning, what brings you in?',
      start: 240,
      end: 2100,
    });
    expect(utterances[3].text).toBe('Yes, at night.');
    expect(Object.keys(utterances[0]).sort()).toEqual(['end', 'speaker', 'start', 'text']);
  });

  it('formats unassigned speakers as "Speaker X:" turns and merges consecutive utterances', () => {
    const { utterances } = normaliseTranscript(ASSEMBLYAI_FIXTURE);
    expect(utterancesToTranscript(utterances)).toBe(
      [
        'Speaker A: Good morning, what brings you in?',
        'Speaker B: I have had a cough for five days.',
        'Speaker A: Any fever?',
        'Speaker B: Yes, at night.',
        'Speaker C: She has not been eating well either.',
        'Speaker A: Let us start amoxicillin-clavulanate 625 mg.',
      ].join('\n'),
    );
  });

  it('applies assigned roles and passes an unassigned third speaker through as-is', () => {
    const { utterances } = normaliseTranscript(ASSEMBLYAI_FIXTURE);
    const transcript = utterancesToTranscript(utterances, { A: 'clinician', B: 'patient' });
    expect(transcript.split('\n')).toEqual([
      'Clinician: Good morning, what brings you in?',
      'Patient: I have had a cough for five days.',
      'Clinician: Any fever?',
      'Patient: Yes, at night.',
      'Speaker C: She has not been eating well either.',
      'Clinician: Let us start amoxicillin-clavulanate 625 mg.',
    ]);
  });

  it('labels a caregiver when assigned', () => {
    const { utterances } = normaliseTranscript(ASSEMBLYAI_FIXTURE);
    const transcript = utterancesToTranscript(utterances, { A: 'clinician', B: 'patient', C: 'caregiver' });
    expect(transcript).toContain('Caregiver: She has not been eating well either.');
  });

  it('sends a single-voice dictation through as plain text, as typed notes always were', () => {
    const dictation = normaliseTranscript({
      status: 'completed',
      text: 'Patient presents with cough.',
      utterances: [
        { speaker: 'A', text: 'Patient presents with cough.', start: 0, end: 1800 },
        { speaker: 'A', text: 'Plan: chest X-ray.', start: 1900, end: 3000 },
      ],
    });
    expect(utterancesToTranscript(dictation.utterances)).toBe(
      'Patient presents with cough. Plan: chest X-ray.',
    );
  });

  it('keeps the text as one speaker when no utterances come back', () => {
    const result = normaliseTranscript({ status: 'completed', text: 'Fever for two days.', utterances: null });
    expect(result.utterances).toEqual([{ speaker: 'A', text: 'Fever for two days.', start: 0, end: 0 }]);
  });
});

describe('correcting speakers line by line', () => {
  // Verbatim from the first smoke test against the live proxy (8 Oct 2026):
  // diarization returned six real turns as two blocks, with the patient's
  // answers merged into the clinician's opening block.
  const SMOKE_TEST_RESULT = normaliseTranscript({
    status: 'completed',
    text: '',
    utterances: [
      {
        speaker: 'A',
        text: 'Good morning. What brings you in today? I have had a cough for 5 days, with fever at night. Any blood in the sputum? Any chest pain? No blood. I think it is typhoid, my sister had the same thing.',
        start: 0,
        end: 14000,
      },
      {
        speaker: 'B',
        text: 'Your chest has crepitations on the right. I will send a full blood count and a malaria RDT. This looks like pneumonia. Start amoxicillin-clavulanate 625 mg, 3 times daily for 7 days, and paracetamol 1 gram as needed.',
        start: 14200,
        end: 30000,
      },
    ],
  });

  it('splits a merged block into sentences, each starting on its block’s speaker', () => {
    const lines = toLines(SMOKE_TEST_RESULT.utterances);
    expect(lines.map((l) => l.text)).toEqual([
      'Good morning.',
      'What brings you in today?',
      'I have had a cough for 5 days, with fever at night.',
      'Any blood in the sputum?',
      'Any chest pain?',
      'No blood.',
      'I think it is typhoid, my sister had the same thing.',
      'Your chest has crepitations on the right.',
      'I will send a full blood count and a malaria RDT.',
      'This looks like pneumonia.',
      'Start amoxicillin-clavulanate 625 mg, 3 times daily for 7 days, and paracetamol 1 gram as needed.',
    ]);
    expect(lines.slice(0, 7).every((l) => l.speaker === 'A')).toBe(true);
    expect(lines.slice(7).every((l) => l.speaker === 'B')).toBe(true);
  });

  it('repairs the smoke-test merge: the typhoid guess ends up as the patient’s line', () => {
    const lines = toLines(SMOKE_TEST_RESULT.utterances);
    // The clinician moves their own four questions from A to B.
    const corrected = lines.map((l, i) => ([0, 1, 3, 4].includes(i) ? { ...l, speaker: 'B' } : l));
    const transcript = utterancesToTranscript(corrected, { A: 'patient', B: 'clinician' });

    expect(transcript.split('\n')).toEqual([
      'Clinician: Good morning. What brings you in today?',
      'Patient: I have had a cough for 5 days, with fever at night.',
      'Clinician: Any blood in the sputum? Any chest pain?',
      'Patient: No blood. I think it is typhoid, my sister had the same thing.',
      'Clinician: Your chest has crepitations on the right. I will send a full blood count and a malaria RDT. This looks like pneumonia. Start amoxicillin-clavulanate 625 mg, 3 times daily for 7 days, and paracetamol 1 gram as needed.',
    ]);
    expect(transcript).toMatch(/^Patient: .*typhoid/m);
    expect(transcript).not.toMatch(/^Clinician: .*typhoid/m);
  });

  it('can split out a speaker the diarizer missed entirely', () => {
    const lines = toLines([{ speaker: 'A', text: 'Any fever? Yes, at night.', start: 0, end: 3000 }]);
    expect(speakersIn(lines)).toEqual(['A']);
    const added = nextSpeaker(speakersIn(lines));
    expect(added).toBe('B');
    const corrected = lines.map((l, i) => (i === 1 ? { ...l, speaker: added } : l));
    expect(utterancesToTranscript(corrected, { A: 'clinician', B: 'patient' })).toBe(
      'Clinician: Any fever?\nPatient: Yes, at night.',
    );
  });

  it('keeps a bare "No." as its own line, so a patient’s answer is never glued to the next question', () => {
    expect(splitSentences('Any fever? No. Any cough?')).toEqual(['Any fever?', 'No.', 'Any cough?']);
  });

  it('does not split on titles or decimals', () => {
    expect(splitSentences('Seen by Dr. Okafor today. Temperature 38.4 C, e.g. febrile.')).toEqual([
      'Seen by Dr. Okafor today.',
      'Temperature 38.4 C, e.g. febrile.',
    ]);
  });
});

describe('AssemblyAI request parameters', () => {
  it('uses medical mode, global English and a 2–3 speaker range for consultations', () => {
    const body = buildTranscriptRequest('https://example.test/a.webm', 'consultation', ['TLD']);
    expect(body).toMatchObject({
      audio_url: 'https://example.test/a.webm',
      speech_models: ['universal-3-5-pro'],
      domain: 'medical-v1',
      language_code: 'en',
      speaker_labels: true,
      speaker_options: { min_speakers_expected: 2, max_speakers_expected: 3 },
      keyterms_prompt: ['TLD'],
    });
    expect(body).not.toHaveProperty('speakers_expected');
    expect(body).not.toHaveProperty('language_detection');
  });

  it('expects one speaker for a dictated note rather than forcing two', () => {
    const body = buildTranscriptRequest('https://example.test/a.webm', 'dictation', []);
    expect(body.speakers_expected).toBe(1);
    expect(body).not.toHaveProperty('speaker_options');
    expect(body).not.toHaveProperty('keyterms_prompt');
  });

  it('keeps the keyterm list within the agreed size and the API limits', () => {
    expect(MEDICAL_KEYTERMS.length).toBeLessThanOrEqual(80);
    for (const seed of SEED_KEYTERMS) expect(MEDICAL_KEYTERMS).toContain(seed);
    expect(sanitiseKeyterms(MEDICAL_KEYTERMS)).toEqual(MEDICAL_KEYTERMS);
  });

  it('drops keyterms over six words, duplicates and non-strings', () => {
    expect(
      sanitiseKeyterms(['TLD', 'tld', 7, 'one two three four five six seven', '  viral   load ']),
    ).toEqual(['TLD', 'viral load']);
  });
});

function fakeOffline(): TranscriptionProvider & { received: Blob[] } {
  const received: Blob[] = [];
  return {
    id: 'offline',
    label: 'fake offline',
    onDevice: true,
    received,
    async start(audio, mode) {
      received.push(audio);
      return { provider: 'offline', id: 'offline-1', mode, blob: audio };
    },
    async wait() {
      return { text: 'offline text', utterances: [], engine: 'fake' };
    },
  };
}

describe('fallback to the offline engine', () => {
  afterEach(() => vi.unstubAllGlobals());

  const audio = new File([new Uint8Array(2048)], 'clinic.webm', { type: 'audio/webm' });

  it('falls back when the proxy URL points nowhere', async () => {
    const cloud = new AssemblyAIProvider({
      url: 'http://127.0.0.1:9/functions/v1/transcribe',
      getDemoKey: () => 'pass',
      keyterms: [],
    });
    const offline = fakeOffline();
    const started = await startWithFallback(cloud, offline, audio, 'consultation', () => {});
    expect(started.provider).toBe(offline);
    expect(started.fallbackReason).toMatch(/could not reach/i);
    // The uploaded file is what the offline engine receives.
    expect(offline.received[0]).toBe(audio);
  });

  it('falls back when no proxy URL is configured', async () => {
    const cloud = new AssemblyAIProvider({ url: undefined, getDemoKey: () => 'pass', keyterms: [] });
    const started = await startWithFallback(cloud, fakeOffline(), audio, 'consultation', () => {});
    expect(started.provider.id).toBe('offline');
    expect(started.fallbackReason).toMatch(/no transcription service/i);
  });

  it('falls back when the proxy URL is a wrong path on a real host (404)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"Not found"}', { status: 404 })));
    const cloud = new AssemblyAIProvider({ url: 'https://x.test/functions/v1/wrong', getDemoKey: () => 'pass', keyterms: [] });
    const started = await startWithFallback(cloud, fakeOffline(), audio, 'consultation', () => {});
    expect(started.provider.id).toBe('offline');
  });

  it('does not fall back on a wrong passcode — that is shown, not hidden', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"Wrong or missing demo passcode"}', { status: 401 })));
    const cloud = new AssemblyAIProvider({ url: 'https://x.test/fn', getDemoKey: () => 'nope', keyterms: [] });
    const offline = fakeOffline();
    await expect(startWithFallback(cloud, offline, audio, 'consultation', () => {})).rejects.toBeInstanceOf(PasscodeError);
    expect(offline.received).toHaveLength(0);
  });

  it('asks for the passcode before contacting anything when none is saved', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const cloud = new AssemblyAIProvider({ url: 'https://x.test/fn', getDemoKey: () => '', keyterms: [] });
    await expect(startWithFallback(cloud, fakeOffline(), audio, 'consultation', () => {})).rejects.toBeInstanceOf(PasscodeError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the uploaded file through sign → storage PUT → submit, carrying the passcode', async () => {
    const calls: Array<{ url: string; method: string; body: unknown; headers: Record<string, string> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const headers = (init.headers ?? {}) as Record<string, string>;
        calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body, headers });
        if (String(url).startsWith('https://storage.test/')) return new Response('{}', { status: 200 });
        const payload = JSON.parse(String(init.body));
        if (payload.action === 'sign') {
          return Response.json({ uploadUrl: 'https://storage.test/upload?token=t', path: 'encounters/x.webm' });
        }
        return Response.json({ id: 'job-123' });
      }),
    );
    const cloud = new AssemblyAIProvider({ url: 'https://x.test/fn', getDemoKey: () => 'pass', keyterms: ['TLD'] });
    const started = await startWithFallback(cloud, fakeOffline(), audio, 'consultation', () => {});

    expect(started.provider.id).toBe('assemblyai');
    expect(started.job).toMatchObject({ id: 'job-123', path: 'encounters/x.webm', mode: 'consultation' });
    expect(calls.map((c) => c.method)).toEqual(['POST', 'PUT', 'POST']);
    expect(JSON.parse(String(calls[0].body))).toEqual({ action: 'sign', contentType: 'audio/webm', size: 2048 });
    expect(calls[1].body).toBe(audio);
    expect(JSON.parse(String(calls[2].body))).toMatchObject({ action: 'submit', mode: 'consultation', keyterms: ['TLD'] });
    expect(calls[0].headers['x-demo-key']).toBe('pass');
  });
});

describe('polling', () => {
  afterEach(() => vi.unstubAllGlobals());

  const job: TranscriptionJob = { provider: 'assemblyai', id: 'job-123', path: 'encounters/x.webm', mode: 'consultation' };

  it('times out with the same job, and Retry resumes polling without resubmitting', async () => {
    const fetchSpy = vi.fn(async () => Response.json({ status: 'processing' }));
    vi.stubGlobal('fetch', fetchSpy);
    const cloud = new AssemblyAIProvider({
      url: 'https://x.test/fn',
      getDemoKey: () => 'pass',
      keyterms: [],
      pollIntervalMs: 5,
      timeoutMs: 40,
    });

    const timeout = await cloud.wait(job, () => {}).catch((e) => e);
    expect(timeout).toBeInstanceOf(TranscriptionTimeoutError);
    expect((timeout as TranscriptionTimeoutError).job).toBe(job);

    fetchSpy.mockImplementation(async () =>
      Response.json({ status: 'completed', ...normaliseTranscript(ASSEMBLYAI_FIXTURE) }),
    );
    const result = await cloud.wait((timeout as TranscriptionTimeoutError).job, () => {});
    expect(result.utterances).toHaveLength(7);

    const allCalls = fetchSpy.mock.calls as unknown as Array<[string, RequestInit]>;
    for (const [url, init] of allCalls) {
      expect(init.method).toBe('GET');
      expect(init.cache).toBe('no-store');
      expect(new URL(url).searchParams.get('id')).toBe('job-123');
    }
  });

  it('keeps polling through a dropped connection', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        n += 1;
        if (n === 1) throw new TypeError('Failed to fetch');
        return Response.json({ status: 'completed', text: 'ok', utterances: [] });
      }),
    );
    const cloud = new AssemblyAIProvider({ url: 'https://x.test/fn', getDemoKey: () => 'pass', keyterms: [], pollIntervalMs: 5 });
    const result = await cloud.wait(job, () => {});
    expect(result.text).toBe('ok');
    expect(n).toBe(2);
  });
});
