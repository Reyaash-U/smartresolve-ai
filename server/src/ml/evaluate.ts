import { NaiveBayes, type Sample } from './naiveBayes';
import { tokenize } from './text';

export interface ClassMetrics {
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface Evaluation {
  accuracy: number;
  total: number;
  labels: string[];
  perClass: Record<string, ClassMetrics>;
  /** confusion[actual][predicted] */
  confusion: Record<string, Record<string, number>>;
  errors: { text: string; actual: string; predicted: string; confidence: number }[];
}

export function evaluate(model: NaiveBayes, test: Sample[]): Evaluation {
  const labels = [...new Set(test.map((s) => s.label))].sort();
  const confusion = Object.fromEntries(labels.map((a) => [a, Object.fromEntries(labels.map((p) => [p, 0]))]));
  const errors: Evaluation['errors'] = [];
  let correct = 0;
  for (const s of test) {
    const p = model.predict(s.text);
    confusion[s.label][p.label]++;
    if (p.label === s.label) correct++;
    else errors.push({ text: s.text, actual: s.label, predicted: p.label, confidence: Number(p.confidence.toFixed(3)) });
  }
  const perClass: Record<string, ClassMetrics> = {};
  for (const l of labels) {
    const tp = confusion[l][l];
    const fp = labels.reduce((s, o) => s + (o === l ? 0 : confusion[o][l]), 0);
    const fn = labels.reduce((s, p) => s + (p === l ? 0 : confusion[l][p]), 0);
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    perClass[l] = { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0, support: tp + fn };
  }
  return { accuracy: correct / test.length, total: test.length, labels, perClass, confusion, errors };
}

/** Largest Jaccard overlap between each test text and any training text; guards against near-duplicate leakage. */
export function maxLeakage(train: Sample[], test: Sample[]): { max: number; worst?: { test: string; train: string } } {
  const sets = train.map((s) => ({ text: s.text, set: new Set(tokenize(s.text)) }));
  let max = 0;
  let worst: { test: string; train: string } | undefined;
  for (const t of test) {
    const ts = new Set(tokenize(t.text));
    for (const tr of sets) {
      const inter = [...ts].filter((x) => tr.set.has(x)).length;
      const j = inter / (ts.size + tr.set.size - inter || 1);
      if (j > max) {
        max = j;
        worst = { test: t.text, train: tr.text };
      }
    }
  }
  return { max, worst };
}
