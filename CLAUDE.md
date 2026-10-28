# MER Capture — handoff note

This repo is public. Keep this note technical: no meeting details, personal paths, accounts or credentials.

## Where we are (28 Oct 2026)

- Live at https://kelzbot.github.io/mer-capture/ (GitHub Pages, deployed from `main` by `.github/workflows/deploy.yml`, which runs `npm test` first).
- Audit fixes merged: TX_ML "lost to follow-up" no longer read as transfer; phone numbers no longer
  leak past de-identification; stale consultation audio is swept from Storage in `handleSign`;
  VL 999/9999 kept as real results; "Not pregnant" and "Inactive" read correctly (`parsePregnant` in
  `normalise.ts`); TB screen "Not done" not counted; age correct on birthdays; unused 5 MB
  `eng.traineddata` removed; batch view memoised.
- `src/lib/smoke.ts` runs inside `npm test` via `smoke.test.ts`.
- UI: one Consultation screen (`NoteExtract`). Batch notes and the HIV dataset tool sit behind the
  "Programme tools…" menu with a "Back to consultation" button; the consultation stays mounted (hidden)
  while a tool is open so a note in progress survives. Reporting period shows only in the dataset tool.
  Visual pass: IBM Plex Sans/Mono, 12px base text, teal primary button, soft cards, three-step empty state.
- Consultation types (TYPE dropdown, default Auto-detect): General outpatient `clinical`, Antenatal `anc`,
  Chronic follow-up `ncd`, HIV adult ART `adult_art`, HIV infant EID `eid`. `anc` and `ncd` are the
  clinical SOAP fields plus their own measurements (`ANC_ALIASES`, `NCD_ALIASES` in `aliases.ts`). Only
  the HIV profiles get programme indicators (`isHiv` in `NoteExtract.tsx`); the rest get `docQuality.ts`
  flags. A chosen type is forced through `extractNote(..., forced)`. The app documents the clinician's
  diagnosis only; it does not suggest one.
- Extraction: Gemini runs with thinking off (`thinkingBudget: 0`), about 3–6 s per note. The prompt asks
  for one ICD-10 code per stated diagnosis, comma-separated.
- Evaluation: first run on a 20-note synthetic set (exact 61.8%, token F1 0.847, ICD-10 exact 75% /
  category 100%, hallucination 2.6%, negation errors 0). Numbers and caveats are in the README. The
  organiser's Track 2 dataset has not been run.
- Live site checked in Chrome (text and DOM checks; screenshots time out there): TYPE options, ANC/NCD
  samples with real extraction, sample-form OCR, dataset tool and indicators, Back to consultation,
  no console errors.
- Sample data uses fictional facilities and people. Submission PDFs checked: nothing identifying.

## Next step

- Waiting on Kelvin: deploy the Supabase function (`sweepStaleAudio` is not live). Needs a CLI login
  with access to the project: `npx supabase functions deploy transcribe --project-ref cmistooufkxzxzmhsuds --no-verify-jwt --use-api`
  (keep `--no-verify-jwt`: the app calls the proxy without a Supabase JWT). The Storage list call is
  untested against a live bucket.
- Orphaned AssemblyAI transcripts (tab closed mid-job) still can't be cleaned up: the proxy never
  learns their IDs.
- Run the real Track 2 dataset through Programme tools → Batch notes for the headline accuracy numbers.
- Possible next type: under-5 / immunisation clinic. A type = a field list in `aliases.ts`, a `SECTIONS`
  and `PROFILE_LABELS` entry in `NoteExtract.tsx`, and a line in the prompt in `extract.ts`.

## Commands

`npm run dev` · `npm test` · `npm run build` · `npm run lint`
