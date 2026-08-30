# MER Capture

**A PEPFAR indicator and data-quality workbench for Nigerian HIV programme data. Runs entirely in the browser.**

Live demo: https://kelzbot.github.io/mer-capture/

---

## The problem

Nigeria runs one of the largest HIV treatment programmes in the world, and every facility in it reports the same PEPFAR MER indicators every quarter — TX_CURR, TX_NEW, TX_ML, TX_PVLS, TB_STAT, PMTCT, EID.

The reporting itself is the bottleneck:

- **The data arrives dirty.** One export mixes `14/08/2023` and `14-Aug-23` in the same column. Viral loads come back as `TND`, `<20`, `1,450`, `Not Detected`, `LDL`, or blank. Missing values are spelled `NA`, `-`, `999`, `NIL`, `Unknown`, or nothing at all. Every M&E officer writes the same Excel cleanup by hand, differently.
- **Every facility names its columns differently.** `Patient ID`, `Hosp No`, `PEPID`, `UID` are the same field. Mapping them is manual work repeated for every site, every quarter.
- **Indicator definitions get applied inconsistently.** TX_CURR is defined on `next_pickup_date + 28 days`, not last visit date — a common shortcut that silently inflates or deflates the number. Nobody downstream can see which rule was used.
- **Errors are found after submission, not before.** ART start dates before HIV confirmation, pregnancy recorded for male patients, EID results dated before the assay ran, samples stuck at the lab for 60 days — these surface in a DQA months later, when they can't be fixed.
- **Much of the source data isn't tabular at all.** It's a clinic note, a DBS request form, a scanned register — and it has to be typed into a spreadsheet before any of the above can even begin.

The consequence: the numbers a facility reports are only loosely connected to the care it actually delivered, and nobody can audit the gap.

## What this does

Four things, in one page, with no server and no data leaving the machine.

**1. Ingests messy real-world files.** CSV and XLSX. Excel date serials, day-first ambiguity, long-format visit logs reduced to one row per patient. 14 date formats, 12 flavours of missing, viral-load qualitatives normalised to a real suppression flag.

**2. Auto-maps columns.** An alias dictionary plus fuzzy token matching maps site-specific headers onto canonical fields, scores its own confidence, detects whether the file is adult ART or EID, and hands every mapping back to the user as an editable dropdown.

**3. Computes indicators deterministically — no LLM in the numbers, ever.** Every indicator is a pure function returning `met` / `not_met` / `insufficient` **plus a mandatory `reason` string**. That reason is the audit trail: you can see exactly why a patient counted, or why the data couldn't support a verdict. Disaggregated by sex and age band. EID turnaround times (transport / lab / return / total) reported as medians.

**4. Flags data quality before submission.** 25+ rules across both profiles, split critical vs warning, with a per-facility score: the percentage of records with zero critical flags. Exportable as CSV.

**And for the non-tabular half of the problem:** a note-extraction mode that turns a free-text clinic note or DBS form into a structured record. Text is de-identified locally first — names, phone numbers and hospital numbers are replaced with tokens before anything is transmitted — the model returns per-field values with confidence scores and the source span it read them from, and identifiers are re-hydrated client-side. You can inspect the exact payload that left the browser. The extracted record then flows into the same deterministic indicator and DQ engine as everything else.

## Design commitments

- **The LLM extracts; it never counts.** Indicator arithmetic is pure TypeScript, testable and auditable. An LLM is used only to read prose into fields, and every field it produces is shown with its confidence and its source text.
- **No data leaves the browser unless you send a note for extraction** — and then only after local de-identification, to an endpoint and payload you can see.
- **No storage.** No localStorage, no sessionStorage, no backend. Close the tab and it's gone.
- **Every verdict carries its reason.** An indicator result without an explanation is not usable in a programme that gets audited.

## Running it

```bash
npm install
npm run dev
```

Two dirty sample datasets are bundled and loadable from the Upload step: `public/samples/adult_art_sample.csv` (60 adult ART records) and `public/samples/eid_sample.csv` (40 EID records). Both contain deliberate errors so the DQ engine has something to find.

Note extraction needs an API key (Google Gemini or Anthropic Claude), entered in the header. It is held in memory only.

```bash
npm run build          # typecheck + production build
npx tsx src/lib/smoke.ts   # parser and indicator assertions
```

## Stack

React 19 · TypeScript · Vite · Tailwind · papaparse · SheetJS · lucide-react. No charting library — the bars are CSS.

## Layout

```
src/lib/normalise.ts    parsers: dates, viral loads, regimens, missing values
src/lib/aliases.ts      canonical field dictionary for both profiles
src/lib/mapper.ts       header auto-mapping + profile detection
src/lib/indicators.ts   PEPFAR MER indicator logic (pure)
src/lib/dq.ts           data quality rules + facility scoring
src/lib/ingest.ts       CSV/XLSX parsing, long-format reduction
src/lib/deidentify.ts   local PII redaction and re-hydration
src/lib/extract.ts      note → structured record via Gemini or Claude
src/lib/docQuality.ts   completeness and confidence scoring for extracted notes
src/lib/smoke.ts        assertions
```
