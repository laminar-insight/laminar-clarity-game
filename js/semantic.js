// Embedding-based grading of the player's free-text reframe (v1.5).
// Pure math only: the vectors come from js/embedder.js in the browser (or
// scripts/calibrate.mjs in Node), so this module is unit-testable without a model.

// Cosine-similarity thresholds for all-MiniLM-L6-v2. A scenario can override
// them with a top-level "grading" object. Tune with scripts/calibrate.mjs.
export const DEFAULT_THRESHOLDS = {
  floor: 0.35, // similarity to the best reference at or below this scores 0
  ceiling: 0.8, // ...at or above this scores 100
  flawMin: 0.55, // a flaw pattern must be at least this similar to be flagged
  flawMargin: 0.05, // ...and beat the best reference by this much
};

// A flagged flaw halves the written score.
export const FLAW_MULTIPLIER = 0.5;

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Texts to compare against: the authored reference frames plus the best
 * multiple-choice option, and each flaw tag's patterns plus the wrong options
 * carrying that tag.
 */
export function buildCorpus(scenario) {
  const best = scenario.reframe_options.filter((o) => o.is_best).map((o) => o.text);
  const references = [...new Set([...(scenario.reference_frames || []), ...best])];
  const flaws = [];
  const seen = new Set();
  const add = (tag, text) => {
    if (seen.has(`${tag}\n${text}`)) return;
    seen.add(`${tag}\n${text}`);
    flaws.push({ tag, text });
  };
  for (const [tag, list] of Object.entries(scenario.flaw_patterns || {})) list.forEach((t) => add(tag, t));
  for (const o of scenario.reframe_options) if (!o.is_best) (o.flaw_tags || []).forEach((tag) => add(tag, o.text));
  return { references, flaws };
}

/** Flat list of corpus texts, in the order gradeSemantic expects vectors. */
export const corpusTexts = (corpus) => [...corpus.references, ...corpus.flaws.map((f) => f.text)];

/**
 * Grade one sentence. `vectors` = [player, ...corpusTexts(corpus)] embeddings.
 * Returns { method, score 0–100, similarity, closest, flaw }.
 */
export function gradeSemantic(vectors, corpus, thresholds = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const [player, ...rest] = vectors;
  const refSims = corpus.references.map((text, i) => ({ text, sim: cosine(player, rest[i]) }));
  const flawSims = corpus.flaws.map((f, i) => ({ ...f, sim: cosine(player, rest[corpus.references.length + i]) }));
  const closest = refSims.reduce((a, b) => (b.sim > a.sim ? b : a));
  const nearestFlaw = flawSims.length ? flawSims.reduce((a, b) => (b.sim > a.sim ? b : a)) : null;

  const scaled = Math.max(0, Math.min(1, (closest.sim - t.floor) / (t.ceiling - t.floor)));
  const flagged = nearestFlaw && nearestFlaw.sim >= t.flawMin && nearestFlaw.sim > closest.sim + t.flawMargin;
  return {
    method: 'embedding',
    score: Math.round(100 * scaled * (flagged ? FLAW_MULTIPLIER : 1)),
    similarity: round3(closest.sim),
    closest: { text: closest.text, sim: round3(closest.sim) },
    flaw: flagged ? { tag: nearestFlaw.tag, text: nearestFlaw.text, sim: round3(nearestFlaw.sim) } : null,
  };
}

const round3 = (n) => Math.round(n * 1000) / 1000;
