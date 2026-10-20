import { createHash } from 'node:crypto';
import dataset from './dataset.json';
import { NaiveBayes, type Prediction, type Sample } from './naiveBayes';

/** Starting value from the brief: tunable, and not claimed to be calibrated. */
export const DEFAULT_THRESHOLD = 0.65;

type Row = Sample & { split: 'train' | 'test' };
const rows = dataset.samples as Row[];

export const trainSet = rows.filter((r) => r.split === 'train');
export const testSet = rows.filter((r) => r.split === 'test');
export const MODEL_VERSION = `nb-r${dataset.meta.revision}-${createHash('sha1').update(JSON.stringify(trainSet)).digest('hex').slice(0, 8)}`;

let model: NaiveBayes | null = null;
/** Training takes milliseconds and is deterministic, so the model is rebuilt from the dataset at startup. */
export function getModel(): NaiveBayes {
  return (model ??= new NaiveBayes().train(trainSet));
}

export interface Classification {
  department: string | null;
  confidence: number;
  needsReview: boolean;
  reason: string;
  modelVersion: string;
  topTerms: string[];
}

export function decide(p: Prediction, threshold = DEFAULT_THRESHOLD): Classification {
  let reason = '';
  if (p.knownTokens < 2) reason = 'Too little recognizable detail in the description';
  else if (p.confidence < threshold) reason = `Confidence ${(p.confidence * 100).toFixed(0)}% is below the ${(threshold * 100).toFixed(0)}% review threshold`;
  else if (p.margin < 0.1) reason = 'Two departments are almost equally likely';
  const needsReview = reason !== '';
  return {
    department: needsReview ? null : p.label,
    confidence: Number(p.confidence.toFixed(3)),
    needsReview,
    reason,
    modelVersion: MODEL_VERSION,
    topTerms: p.topTerms,
  };
}

/** Classify an issue's text. When review is needed, the leading guess is kept in `guess` for admins. */
export function classifyIssue(title: string, description: string, threshold = DEFAULT_THRESHOLD) {
  const p = getModel().predict(`${title}. ${description}`);
  return { ...decide(p, threshold), guess: p.label };
}
