import { writeFile } from 'node:fs/promises';
import { trainingExamples, evaluationExamples, challengeExamples, freshExamples } from '../src/model/training.mjs';
import { trainClassifier, classify } from '../src/model/classifier.mjs';
const model = trainClassifier(trainingExamples);
const unique = new Set(trainingExamples.map(([, text]) => text.trim().toLowerCase()));
if (unique.size !== trainingExamples.length) throw new Error('Duplicate training examples.');
for (const list of [evaluationExamples, challengeExamples, freshExamples]) if (list.some(([, text]) => unique.has(text.trim().toLowerCase()))) throw new Error('Evaluation data overlaps training.');
const run = examples => examples.map(([expected, text]) => ({ text, expected, prediction: classify(model, text).label }));
const summary = rows => ({ examples: rows.length, correct: rows.filter(row => row.expected === row.prediction).length, abstained: rows.filter(row => row.prediction === 'uncertain').length, wrongBillable: rows.filter(row => row.prediction === 'extra' && row.expected !== 'extra').length });
const results = run(evaluationExamples), challenge = run(challengeExamples), fresh = run(freshExamples);
const report = {
  modelVersion: model.version, source: model.provenance,
  trainingExamples: trainingExamples.length, evaluationExamples: results.length,
  correct: results.filter(row => row.expected === row.prediction).length,
  abstained: results.filter(row => row.prediction === 'uncertain').length,
  limitation: 'Small synthetic English holdout. These results do not establish accuracy on client records or billing suitability.', results,
  challenge: { ...summary(challenge), limitation: 'Written after the first model failed them and used to choose new training examples, so this is a regression list, not a blind test.', results: challenge },
  fresh: { ...summary(fresh), limitation: 'Written by the same author after the model was frozen. Small and synthetic, so it is a sanity check, not an accuracy figure.', results: fresh },
};
await writeFile(new URL('../src/model/model.json', import.meta.url), JSON.stringify(model) + '\n', 'utf8');
await writeFile(new URL('../MODEL-EVALUATION.json', import.meta.url), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ training: report.trainingExamples, holdout: report.evaluationExamples, correct: report.correct, abstained: report.abstained, challenge: summary(challenge), fresh: summary(fresh), fieldAccuracy: 'not measured' }));
