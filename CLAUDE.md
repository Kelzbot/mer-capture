# MER Capture — handoff note

## Where we are (27 Oct 2026)

- Branch `audit-fixes` (not committed yet) holds the fixes from the ponytail audit:
  TX_ML "lost to follow-up" misclassified as transfer, phone numbers leaking past
  de-identification, stale consultation audio never deleted from Storage (sweep in
  `handleSign`), VL 999/9999 dropped as missing, "Not pregnant" read as unknown
  (now one `parsePregnant` in `normalise.ts`), TB screen "Not done" counted,
  "Inactive" read as active, age off by one on birthdays, unused 5 MB
  `eng.traineddata` removed, batch view memo.
- `src/lib/smoke.ts` (109 checks) now runs inside `npm test` via `smoke.test.ts`, and
  the deploy workflow runs `npm test` before building.
- The Supabase function change is not deployed and the Storage list call in
  `sweepStaleAudio` was not tested against a live bucket.
- Orphaned AssemblyAI transcripts (tab closed mid-job) still can't be cleaned up:
  the proxy never learns their IDs.

- UI simplified (same branch, uncommitted): the app opens on one Consultation screen
  (`NoteExtract`). Batch notes and the HIV dataset workbench sit behind a
  "Programme tools…" menu with a "Back to consultation" button; the reporting period
  only shows in the dataset tool.
- Consultation type: TYPE dropdown (Auto-detect / General outpatient / HIV adult ART /
  HIV infant EID). Auto biases to General; a chosen type is forced through
  `extractNote(..., forced)` → prompt + `parseExtraction`. General notes get
  `docQuality.ts` flags instead of HIV indicators. Two general sample notes added.
- Kelvin chose: document the clinician's diagnosis only (no AI differentials).

## Next step

- Waiting on Kelvin: which extra consultation types he meant by "Other" (e.g.
  antenatal, chronic follow-up). Each is a field list in `aliases.ts` plus a
  `SECTIONS` entry in `NoteExtract.tsx` and a profile in the prompt.
- Not yet checked in a browser (Chrome stopped responding); run `npm run dev` and click through.
- README still describes the old three-mode layout and HIV-first framing.
- Commit when Kelvin approves.

## Commands

`npm run dev` · `npm test` · `npm run build` · `npm run lint`
