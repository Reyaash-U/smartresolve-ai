import { similarityTokens } from '../ml/text';

export interface DupDoc {
  id: string;
  title: string;
  description: string;
  building: string;
  room: string;
  department: string | null;
}

export interface DupCandidate {
  id: string;
  score: number;
  textSimilarity: number;
  reasons: string[];
}

export const DEFAULT_DUP_THRESHOLD = 0.55;
const SAME_BUILDING = 0.1;
const SAME_ROOM = 0.1;
const SAME_DEPARTMENT = 0.05;

const normRoom = (r: string) => r.toLowerCase().replace(/[^a-z0-9]/g, '');

function vectorize(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return new Map([...tf].map(([t, c]) => [t, c * (idf.get(t) ?? 0)]));
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  for (const [t, w] of a) dot += w * (b.get(t) ?? 0);
  const norm = (v: Map<string, number>) => Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0));
  const d = norm(a) * norm(b);
  return d ? dot / d : 0;
}

/**
 * TF-IDF cosine similarity over normalized, stemmed, synonym-collapsed text, plus small additive
 * evidence for same building / room / department. A candidate in a *different* known department
 * is skipped (not compatible). Suggestions only: nothing is merged or hidden.
 */
export function findDuplicates(target: DupDoc, candidates: DupDoc[], threshold = DEFAULT_DUP_THRESHOLD, max = 3): DupCandidate[] {
  const text = (d: DupDoc) => similarityTokens(`${d.title} ${d.description}`);
  const pool = candidates.filter((c) => c.id !== target.id);
  const docs = [target, ...pool].map((d) => ({ d, tokens: text(d) }));

  const df = new Map<string, number>();
  for (const { tokens } of docs) for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  const idf = new Map([...df].map(([t, n]) => [t, Math.log((N + 1) / (n + 1)) + 1]));

  const targetVec = vectorize(docs[0].tokens, idf);
  const out: DupCandidate[] = [];

  for (const { d, tokens } of docs.slice(1)) {
    if (target.department && d.department && target.department !== d.department) continue;
    const sim = cosine(targetVec, vectorize(tokens, idf));
    let score = sim;
    const reasons: string[] = [`Similar wording (${Math.round(sim * 100)}% text match)`];
    if (d.building === target.building) {
      score += SAME_BUILDING;
      reasons.push(`Same building (${d.building})`);
      if (normRoom(d.room) === normRoom(target.room)) {
        score += SAME_ROOM;
        reasons.push(`Same room/location (${d.room})`);
      }
    }
    if (target.department && d.department === target.department) {
      score += SAME_DEPARTMENT;
      reasons.push(`Same department (${d.department})`);
    }
    score = Math.min(1, score);
    if (score >= threshold) out.push({ id: d.id, score: Number(score.toFixed(3)), textSimilarity: Number(sim.toFixed(3)), reasons });
  }
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, max);
}
