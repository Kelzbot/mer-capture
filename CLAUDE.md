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

## Next step

- Waiting on Kelvin: run `npx supabase login` with the account that owns the project, then
  `npx supabase functions deploy transcribe --project-ref cmistooufkxzxzmhsuds --no-verify-jwt --use-api`
  (keep `--no-verify-jwt`: the app calls the proxy without a Supabase JWT).
- ANC/NCD extraction not yet run against a live model; check the two new samples.
- Possible next type: under-5 / immunisation clinic. Adding a type = a field list in `aliases.ts`,
  a `SECTIONS` + `PROFILE_LABELS` entry in `NoteExtract.tsx`, a line in the prompt in `extract.ts`.
- Not yet clicked through in a browser (Chrome stopped responding during the session).
- README rewritten for the one-screen layout and the consultation types (28 Oct).

## Commands

`npm run dev` · `npm test` · `npm run build` · `npm run lint`
