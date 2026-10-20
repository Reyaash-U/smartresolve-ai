# Classifier evaluation

Model `nb-r1-4677bcfb` — Naive Bayes (multinomial, Laplace smoothing) with tokenization, normalization and light stemming. Dataset revision 1: **synthetic**, human-reviewed.

Trained on 90 cases; evaluated on 30 held-out cases (10 per department). Max token-overlap (Jaccard) between any test case and any training case: 0.33.

**Overall accuracy: 93.3%** (28/30). A small synthetic set cannot support a real-world reliability claim.

| Department | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| Administration | 100.0% | 90.0% | 94.7% | 10 |
| Facilities | 83.3% | 100.0% | 90.9% | 10 |
| IT Support | 100.0% | 90.0% | 94.7% | 10 |

## Confusion matrix (rows = actual, columns = predicted)

| Actual \ Predicted | Administration | Facilities | IT Support |
|---|---|---|---|
| Administration | 9 | 1 | 0 |
| Facilities | 0 | 10 | 0 |
| IT Support | 0 | 1 | 9 |

## Manual-review threshold

At the starting confidence threshold of 0.65 (tunable, not calibrated), 8 of 30 held-out reports would go to manual review, and 0 would be confidently wrong.

## Misclassified held-out cases

- "The overhead projector displays a green tint and no sound comes out." — actual **IT Support**, predicted **Facilities** (45.7%)
- "Please reserve the seminar hall for the placement briefing next week." — actual **Administration**, predicted **Facilities** (40.6%)
