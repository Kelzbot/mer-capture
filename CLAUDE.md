# MER Capture — handoff note

## Where we are (28 Oct 2026)

- Merged to `main` and live (commit f4f8b10, deployed 27 Oct 2026): the fixes from the ponytail audit:
  TX_ML "lost to follow-up" misclassified as transfer, phone numbers leaking past
  de-identification, stale consultation audio never deleted from Storage (sweep in
  `handleSign`), VL 999/9999 dropped as missing, "Not pregnant" read as unknown
  (now one `parsePregnant` in `normalise.ts`), TB screen "Not done" counted,
  "Inactive" read as active, age off by one on birthdays, unused 5 MB
  `eng.traineddata` removed, batch view memo.
- `src/lib/smoke.ts` (109 checks) now runs inside `npm test` via `smoke.test.ts`, and
  the deploy workflow runs `npm test` before building.
- The Supabase function change (`sweepStaleAudio`) is NOT deployed. A deploy attempt on 28 Oct got
  403 "account does not have the necessary privileges": the CLI is logged in as an account that
  isn't on project `cmistooufkxzxzmhsuds`. The Storage list call is untested against a live bucket.
- Orphaned AssemblyAI transcripts (tab closed mid-job) still can't be cleaned up:
  the proxy never learns their IDs.

- UI simplified (live): the app opens on one Consultation screen
  (`NoteExtract`). Batch notes and the HIV dataset workbench sit behind a
  "Programme tools…" menu with a "Back to consultation" button; the reporting period
  only shows in the dataset tool.
- Consultation type: TYPE dropdown (Auto-detect / General outpatient / Antenatal `anc` /
  Chronic follow-up `ncd` / HIV adult ART / HIV infant EID). `anc` and `ncd` (added 28 Oct) are the
  clinical SOAP fields plus their own measurements (`ANC_ALIASES`, `NCD_ALIASES` in `aliases.ts`) and get
  the doc-quality rules; only the HIV profiles get indicators (`isHiv` in `NoteExtract.tsx`).
  Samples for each type exist. Auto biases to General; a chosen type is forced through
  `extractNote(..., forced)` → prompt + `parseExtraction`. General notes get
  `docQuality.ts` flags instead of HIV indicators. Two general sample notes added.
- Kelvin chose: document the clinician's diagnosis only (no AI differentials).
- Demo: virtual meeting with Prof. Abimiku (IHVN ED, was a hackathon judge, asked for voice in V2),
  Mon 2 Nov 2026, 2:30pm. Advice given: lead with the HIV dataset tool, then one consultation end to end,
  use a pre-recorded audio file rather than recording live over the call, have a screen recording as backup.

## Next step

- Waiting on Kelvin: run `npx supabase login` with the account that owns the project, then
  `npx supabase functions deploy transcribe --project-ref cmistooufkxzxzmhsuds --no-verify-jwt --use-api`
  (keep `--no-verify-jwt`: the app calls the proxy without a Supabase JWT).
- ANC and NCD samples run through Gemini on the live site (28 Oct): both auto-detected, 23 and 17
  fields, flags sensible. Extraction took ~25 s with Gemini thinking on; `thinkingBudget: 0` added in
  `extract.ts`, speed-up not yet measured on the live site.
- Evaluation run (28 Oct) on a 20-note synthetic set I wrote (`eval_notes_synthetic.csv`, in Kelvin's
  Downloads and the session scratchpad; not in the repo): exact 61.8%, F1 0.847, ICD-10 exact 75% /
  category 100%, hallucination 2.6%, negation 0. Numbers are in the README. The real Track 2 dataset
  was not found on this machine; ask Kelvin where it is.
- Verified live after deploy: extraction 3–6 s (was ~25 s); two-diagnosis note returns "I10, E11.9".
- Visual polish pass (28 Oct, Kelvin asked): 12px base text in the consultation screen and Capture, teal
  primary button, softer cards with shadow, three-step empty state, larger headings. Structure unchanged.
  Not viewed visually (screenshots time out in this Chrome); Kelvin to eyeball.
- Prompt now asks for one ICD-10 code per diagnosis, comma-separated (a two-diagnosis NCD note returned
  no code and fired a critical flag). Fonts: IBM Plex Sans/Mono via Google Fonts; tab title "MER Capture".
- Possible next type: under-5 / immunisation clinic. Adding a type = a field list in `aliases.ts`,
  a `SECTIONS` + `PROFILE_LABELS` entry in `NoteExtract.tsx`, a line in the prompt in `extract.ts`.
- Live site clicked through via Chrome on 28 Oct (text checks; screenshots time out): TYPE options,
  ANC/NCD samples, sample-form OCR, Programme tools → dataset → indicators (TX_ML splits interruption
  vs transfer), Back to consultation, no console errors. Fixed then: the note box was lost on a trip to a
  tool (`NoteExtract` is now hidden, not unmounted, in `App.tsx`). Extraction itself not run (needs Kelvin's key).
- Demo data checked: sample CSVs use fictional facilities; no Abuja names in repo text. Submission PDFs not checked.
- README rewritten for the one-screen layout and the consultation types (28 Oct).

## Commands

`npm run dev` · `npm test` · `npm run build` · `npm run lint`
