export type RedactionKind = 'NAME' | 'PHONE' | 'ID';

export type RedactionEntry = { token: string; original: string; kind: RedactionKind };

export type RedactionMap = Record<string, string>;

export type DeidResult = {
  redacted: string;
  map: RedactionMap;
  entries: RedactionEntry[];
};

const TOKEN_PATTERN = /\[(?:NAME|PHONE|ID)_\d+\]/g;

const PHONE_CANDIDATE = /(?:\+?234|0)[\d\s-]{9,16}/g;
const PHONE_DIGITS = [/^234\d{10}$/, /^0[789][01]\d{8}$/];

const LABELLED_ID =
  /\b(hosp(?:ital)?\.?\s*(?:number|num|no)|file\s*(?:number|num|no)|folder\s*(?:number|num|no)|patient\s*id|pid)(\s*[:\-]?\s*)([A-Za-z0-9][A-Za-z0-9/\-]*)/gi;

const SLASH_CODE = /\b[A-Za-z0-9]+(?:\/[A-Za-z0-9]+){2,}\b/g;

const NAME_FIELD =
  /(^|[\n;,.]\s*)((?:first\s+|sur|last\s+|other\s+)?name)(\s*[:\-]\s*)([^\n,;]+)/gim;

const TITLE_NAME =
  /\b(Mr|Mrs|Miss|Ms|Mallam|Malam|Alhaji|Hajia|Chief|Dr|Prof|Baby)(\.?\s+)([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,2})/g;

const NOT_A_NAME = /^(?:Girl|Boy|Male|Female|Twin|Of|Baby|Infant|Boys|Girls)\b/i;

const TRAILING_LABEL = /\s+[A-Za-z]+(?: [A-Za-z]+)?\s*:/;

export function deidentify(text: string): DeidResult {
  const map: RedactionMap = {};
  const entries: RedactionEntry[] = [];
  const assigned = new Map<string, string>();
  const counters: Record<RedactionKind, number> = { NAME: 0, PHONE: 0, ID: 0 };

  const tokenFor = (original: string, kind: RedactionKind): string => {
    const key = `${kind}:${original.toLowerCase()}`;
    const existing = assigned.get(key);
    if (existing) return existing;
    counters[kind] += 1;
    const token = `[${kind}_${counters[kind]}]`;
    assigned.set(key, token);
    map[token] = original;
    entries.push({ token, original, kind });
    return token;
  };

  let out = text;

  out = out.replace(PHONE_CANDIDATE, (match) => {
    const trimmed = match.trimEnd();
    const tail = match.slice(trimmed.length);
    const digits = trimmed.replace(/\D/g, '');
    if (!PHONE_DIGITS.some((re) => re.test(digits))) return match;
    return tokenFor(trimmed, 'PHONE') + tail;
  });

  out = out.replace(LABELLED_ID, (_m, label: string, sep: string, value: string) =>
    `${label}${sep}${tokenFor(value, 'ID')}`,
  );

  out = out.replace(SLASH_CODE, (match) => {
    const slashes = (match.match(/\//g) ?? []).length;
    if (/^[\d/]+$/.test(match) && slashes < 3) return match;
    return tokenFor(match, 'ID');
  });

  out = out.replace(
    NAME_FIELD,
    (_m, pre: string, label: string, sep: string, value: string) => {
      const cut = value.search(TRAILING_LABEL);
      const name = (cut >= 0 ? value.slice(0, cut) : value).trim();
      const rest = cut >= 0 ? value.slice(cut) : '';
      if (!name || TOKEN_PATTERN.test(name)) {
        TOKEN_PATTERN.lastIndex = 0;
        return `${pre}${label}${sep}${value}`;
      }
      return `${pre}${label}${sep}${tokenFor(name, 'NAME')}${rest}`;
    },
  );

  out = out.replace(TITLE_NAME, (match, title: string, sep: string, name: string) => {
    if (NOT_A_NAME.test(name)) return match;
    return `${title}${sep}${tokenFor(name, 'NAME')}`;
  });

  return { redacted: out, map, entries };
}

export function rehydrate(span: string, map: RedactionMap): string {
  if (!span) return span;
  return span.replace(TOKEN_PATTERN, (token) => map[token] ?? token);
}

export function redactionCounts(entries: RedactionEntry[]): Record<RedactionKind, number> {
  return entries.reduce(
    (acc, e) => ({ ...acc, [e.kind]: acc[e.kind] + 1 }),
    { NAME: 0, PHONE: 0, ID: 0 } as Record<RedactionKind, number>,
  );
}
