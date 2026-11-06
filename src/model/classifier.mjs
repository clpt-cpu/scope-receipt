export function features(text) {
  const words = String(text).normalize('NFKC').toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
  const terms = [...words, ...words.slice(0, -1).map((word, index) => `${word} ${words[index + 1]}`)];
  return new Map(terms.map(term => [term, 1]));
}

export function trainClassifier(examples) {
  const labels = [...new Set(examples.map(([label]) => label))].sort();
  const vocabulary = [...new Set(examples.flatMap(([, text]) => [...features(text).keys()]))].sort();
  const weights = {}, priors = {}, documentCounts = {};
  for (const label of labels) {
    const documents = examples.filter(([category]) => category === label);
    documentCounts[label] = documents.length;
    const counts = new Map(); let total = 0;
    documents.forEach(([, text]) => features(text).forEach((n, term) => { counts.set(term, (counts.get(term) || 0) + n); total += n; }));
    priors[label] = Math.log(documents.length / examples.length);
    weights[label] = Object.fromEntries(vocabulary.map(term => [term, Math.log(((counts.get(term) || 0) + 1) / (total + vocabulary.length))]));
  }
  return { version: 1, method: 'multinomial-naive-bayes', provenance: 'authored synthetic English examples', labels, vocabulary, weights, priors, documentCounts };
}

export function classify(model, text) {
  const terms = features(text), known = [...terms.keys()].filter(term => model.vocabulary.includes(term));
  const scores = model.labels.map(label => ({ label, value: model.priors[label] + known.reduce((sum, term) => sum + model.weights[label][term], 0) }));
  scores.sort((a, b) => b.value - a.value);
  const normalizer = scores.reduce((sum, item) => sum + Math.exp(item.value - scores[0].value), 0);
  const topShare = 1 / normalizer;
  const margin = scores[0].value - scores[1].value;
  const winner = scores[0].label, words = known.filter(term => !term.includes(' ')).length;
  // Proposing billable work is the costly mistake, so that one suggestion needs stronger evidence than the other two.
  const unknown = words < 3 || topShare < .60 || margin < .6 || (winner === 'extra' && (words < 4 || margin < 3));
  const signals = known.filter(term => !term.includes(' ')).map(term => ({ term, contribution: model.weights[winner][term] - Math.max(...model.labels.filter(l => l !== winner).map(l => model.weights[l][term])) })).filter(signal => signal.contribution > .15).sort((a, b) => b.contribution - a.contribution).slice(0, 4).map(signal => signal.term);
  return { label: unknown ? 'uncertain' : winner, modelLabel: winner, margin: Number(margin.toFixed(3)), signals, needsReview: true };
}
