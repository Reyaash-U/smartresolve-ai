/**
 * Reproducible training + evaluation: `npm run train`
 * Trains Naive Bayes on the train split, evaluates on the held-out test split,
 * and writes src/ml/metrics.json plus docs/ml-evaluation.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import dataset from './dataset.json';
import { MODEL_VERSION, getModel, testSet, trainSet, decide } from './classifier';
import { evaluate, maxLeakage } from './evaluate';

const model = getModel();
const ev = evaluate(model, testSet);
const leak = maxLeakage(trainSet, testSet);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// How many held-out reports would go to manual review at the starting 0.65 threshold?
const decisions = testSet.map((s) => ({ s, d: decide(model.predict(s.text)) }));
const review = decisions.filter((x) => x.d.needsReview).length;
const confidentWrong = decisions.filter((x) => !x.d.needsReview && x.d.department !== x.s.label).length;

const metrics = {
  modelVersion: MODEL_VERSION,
  datasetRevision: dataset.meta.revision,
  trainedOn: trainSet.length,
  testedOn: testSet.length,
  accuracy: ev.accuracy,
  perClass: ev.perClass,
  confusion: ev.confusion,
  maxTrainTestJaccard: leak.max,
  reviewQueueAtThreshold: { threshold: 0.65, sentToReview: review, confidentButWrong: confidentWrong },
  errors: ev.errors,
};
writeFileSync(path.join(__dirname, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n');

const L = ev.labels;
const md = [
  '# Classifier evaluation',
  '',
  `Model \`${MODEL_VERSION}\` — Naive Bayes (multinomial, Laplace smoothing) with tokenization, normalization and light stemming. Dataset revision ${dataset.meta.revision}: **synthetic**, human-reviewed.`,
  '',
  `Trained on ${trainSet.length} cases; evaluated on ${testSet.length} held-out cases (${ev.total / L.length} per department). Max token-overlap (Jaccard) between any test case and any training case: ${leak.max.toFixed(2)}.`,
  '',
  `**Overall accuracy: ${pct(ev.accuracy)}** (${Math.round(ev.accuracy * ev.total)}/${ev.total}). A small synthetic set cannot support a real-world reliability claim.`,
  '',
  '| Department | Precision | Recall | F1 | Support |',
  '|---|---|---|---|---|',
  ...L.map((l) => `| ${l} | ${pct(ev.perClass[l].precision)} | ${pct(ev.perClass[l].recall)} | ${pct(ev.perClass[l].f1)} | ${ev.perClass[l].support} |`),
  '',
  '## Confusion matrix (rows = actual, columns = predicted)',
  '',
  `| Actual \\ Predicted | ${L.join(' | ')} |`,
  `|---|${L.map(() => '---').join('|')}|`,
  ...L.map((a) => `| ${a} | ${L.map((p) => ev.confusion[a][p]).join(' | ')} |`),
  '',
  '## Manual-review threshold',
  '',
  `At the starting confidence threshold of 0.65 (tunable, not calibrated), ${review} of ${testSet.length} held-out reports would go to manual review, and ${confidentWrong} would be confidently wrong.`,
  '',
  '## Misclassified held-out cases',
  '',
  ...(ev.errors.length ? ev.errors.map((e) => `- "${e.text}" — actual **${e.actual}**, predicted **${e.predicted}** (${pct(e.confidence)})`) : ['None.']),
  '',
].join('\n');
mkdirSync(path.join(__dirname, '../../../docs'), { recursive: true });
writeFileSync(path.join(__dirname, '../../../docs/ml-evaluation.md'), md);

console.log(md);
