import { tokenize } from './text';

export interface Sample {
  text: string;
  label: string;
}

export interface Prediction {
  label: string;
  /** Posterior probability of the top class. NOT calibrated; only a relative signal. */
  confidence: number;
  probabilities: Record<string, number>;
  knownTokens: number;
  /** Gap between the top two posteriors; small means a near tie. */
  margin: number;
  /** Terms that pushed the prediction toward the chosen class, for plain-language explanation. */
  topTerms: string[];
}

/** Multinomial Naive Bayes with Laplace smoothing, trained from scratch (no external ML service). */
export class NaiveBayes {
  private labels: string[] = [];
  private logPrior: Record<string, number> = {};
  private counts: Record<string, Map<string, number>> = {};
  private totals: Record<string, number> = {};
  private vocab = new Set<string>();

  train(samples: Sample[]): this {
    this.labels = [...new Set(samples.map((s) => s.label))].sort();
    for (const l of this.labels) {
      this.counts[l] = new Map();
      this.totals[l] = 0;
    }
    for (const s of samples) {
      for (const t of tokenize(s.text)) {
        this.vocab.add(t);
        this.counts[s.label].set(t, (this.counts[s.label].get(t) ?? 0) + 1);
        this.totals[s.label]++;
      }
    }
    for (const l of this.labels) this.logPrior[l] = Math.log(samples.filter((s) => s.label === l).length / samples.length);
    return this;
  }

  private logLik(label: string, token: string): number {
    return Math.log(((this.counts[label].get(token) ?? 0) + 1) / (this.totals[label] + this.vocab.size));
  }

  predict(text: string): Prediction {
    // Unseen words carry no evidence; ignoring them keeps an uninformative text near the prior.
    const tokens = tokenize(text).filter((t) => this.vocab.has(t));
    const scores: Record<string, number> = {};
    for (const l of this.labels) scores[l] = this.logPrior[l] + tokens.reduce((s, t) => s + this.logLik(l, t), 0);

    const max = Math.max(...Object.values(scores));
    const exp = Object.fromEntries(this.labels.map((l) => [l, Math.exp(scores[l] - max)]));
    const sum = Object.values(exp).reduce((a, b) => a + b, 0);
    const probabilities = Object.fromEntries(this.labels.map((l) => [l, exp[l] / sum]));

    const ranked = [...this.labels].sort((a, b) => probabilities[b] - probabilities[a] || a.localeCompare(b));
    const label = ranked[0];
    const others = ranked.slice(1);
    const topTerms = [...new Set(tokens)]
      .map((t) => ({ t, lift: this.logLik(label, t) - Math.max(...others.map((o) => this.logLik(o, t))) }))
      .filter((x) => x.lift > 0)
      .sort((a, b) => b.lift - a.lift || a.t.localeCompare(b.t))
      .slice(0, 3)
      .map((x) => x.t);

    return { label, confidence: probabilities[label], probabilities, knownTokens: tokens.length, margin: probabilities[label] - probabilities[ranked[1]], topTerms };
  }
}
