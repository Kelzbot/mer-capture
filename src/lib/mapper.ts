import {
  ADULT_ALIASES,
  EID_ALIASES,
  EID_SIGNAL_FIELDS,
  PROFILE_ALIASES,
  headerTokens,
  normaliseHeader,
  type Profile,
} from './aliases';

export type MapResult = {
  mapping: Record<string, string | null>;
  confidence: Record<string, number>;
  unmapped: string[];
  profile: Profile;
};

const FUZZY_THRESHOLD = 0.6;

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared++;
  return shared / (setA.size + setB.size - shared);
}

function score(header: string, aliases: string[]): number {
  const hNorm = normaliseHeader(header);
  if (!hNorm) return 0;
  const hTokens = headerTokens(header);

  let best = 0;
  for (const alias of aliases) {
    const aNorm = normaliseHeader(alias);
    if (aNorm === hNorm) return 1;
    const aTokens = headerTokens(alias);
    let s = jaccard(hTokens, aTokens);
    if (aNorm.length >= 4 && hNorm.includes(aNorm)) s = Math.max(s, 0.9);
    else if (hNorm.length >= 4 && aNorm.includes(hNorm)) s = Math.max(s, 0.8);
    if (s > best) best = s;
  }
  return best;
}

function mapForProfile(headers: string[], profile: Profile): MapResult {
  const aliasSet = PROFILE_ALIASES[profile];
  const fields = Object.keys(aliasSet);

  const candidates: Array<{ field: string; header: string; s: number }> = [];
  for (const field of fields) {
    for (const header of headers) {
      const s = score(header, aliasSet[field]);
      if (s >= FUZZY_THRESHOLD) candidates.push({ field, header, s });
    }
  }
  candidates.sort((a, b) => b.s - a.s);

  const mapping: Record<string, string | null> = {};
  const confidence: Record<string, number> = {};
  for (const field of fields) {
    mapping[field] = null;
    confidence[field] = 0;
  }

  const usedHeaders = new Set<string>();
  for (const c of candidates) {
    if (mapping[c.field] !== null) continue;
    if (usedHeaders.has(c.header)) continue;
    mapping[c.field] = c.header;
    confidence[c.field] = Math.round(c.s * 100) / 100;
    usedHeaders.add(c.header);
  }

  return {
    mapping,
    confidence,
    unmapped: headers.filter((h) => !usedHeaders.has(h)),
    profile,
  };
}

const EID_ONLY_FIELDS = Object.keys(EID_ALIASES).filter((f) => !(f in ADULT_ALIASES));

export function autoMap(headers: string[]): MapResult {
  const clean = headers.map((h) => String(h ?? '').trim()).filter(Boolean);

  const eid = mapForProfile(clean, 'eid');
  const signals = EID_SIGNAL_FIELDS.filter((f) => eid.mapping[f] !== null).length;
  const eidOnly = EID_ONLY_FIELDS.filter((f) => eid.mapping[f] !== null).length;

  if (signals > 0 && eidOnly >= 3) return eid;
  return mapForProfile(clean, 'adult_art');
}

export function remap(
  current: MapResult,
  field: string,
  header: string | null,
  headers: string[],
): MapResult {
  const mapping: Record<string, string | null> = { ...current.mapping };
  const confidence: Record<string, number> = { ...current.confidence };

  if (header) {
    for (const f of Object.keys(mapping)) {
      if (f !== field && mapping[f] === header) {
        mapping[f] = null;
        confidence[f] = 0;
      }
    }
  }

  mapping[field] = header;
  confidence[field] = header ? 1 : 0;

  const used = new Set(Object.values(mapping).filter(Boolean) as string[]);
  return {
    mapping,
    confidence,
    unmapped: headers.filter((h) => !used.has(h)),
    profile: current.profile,
  };
}
