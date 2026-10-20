const STOPWORDS = new Set(
  ('a an and are as at be been but by can cannot do does for from has have had i in is it its my of on or our so that the their there this to was we were will with ' +
    'not no please need needs kindly since also very all any some one two near next more than when who what which').split(' '),
);

/** Very small suffix stemmer: deterministic, no dependencies. Applied identically at train and predict time. */
export function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('es') && !w.endsWith('ses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Lowercase, unify wi-fi spellings, strip punctuation, drop stopwords, stem. */
export function tokenize(text: string, opts: { keepNumbers?: boolean } = {}): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/wi[\s-]?fi/g, 'wifi')
    .replace(/[^a-z0-9\s]/g, ' ');
  return cleaned
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w) && (opts.keepNumbers || !/^\d+$/.test(w)))
    .map(stem);
}

/** Collapse near-synonyms for similarity matching only ("wifi" ~ "internet" ~ "network"). */
const SYNONYMS: Record<string, string> = {
  wifi: 'network',
  internet: 'network',
  wireless: 'network',
  connectivity: 'network',
  connection: 'network',
  online: 'network',
  broken: 'fault',
  damaged: 'fault',
  down: 'fault',
  outage: 'fault',
  fail: 'fault',
  working: 'fault',
  leak: 'leakage',
  leakag: 'leakage',
};

export function similarityTokens(text: string): string[] {
  return tokenize(text, { keepNumbers: true }).map((t) => SYNONYMS[t] ?? t);
}
