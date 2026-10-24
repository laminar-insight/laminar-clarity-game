import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCorpus, corpusTexts, cosine, gradeSemantic, DEFAULT_THRESHOLDS, FLAW_MULTIPLIER } from '../js/semantic.js';
import { keywordGrade } from '../js/reframe.js';
import { validateScenario } from '../scripts/validate.mjs';

// These tests cover the grading math with hand-built vectors. They do not
// exercise the real model; scripts/calibrate.mjs does that.

const scenario = JSON.parse(readFileSync(new URL('../scenarios/membership-softer.json', import.meta.url)));
const corpus = buildCorpus(scenario);

/** A unit vector at `angle` radians in the plane spanned by e0/e1. */
const at = (angle, dims = 4) => {
  const v = new Array(dims).fill(0);
  v[0] = Math.cos(angle);
  v[1] = Math.sin(angle);
  return v;
};
const simToAngle = (s) => Math.acos(s);

/** Vectors where the player has similarity `refSim` to the first reference and `flawSim` to the first flaw. */
function vectorsFor(refSim, flawSim) {
  // Player on e0. Reference/flaw directions chosen to hit the target cosines;
  // everything else orthogonal (e2) so it never wins.
  const player = [1, 0, 0, 0];
  const n = corpusTexts(corpus).length;
  const vecs = Array.from({ length: n }, () => [0, 0, 1, 0]);
  vecs[0] = at(simToAngle(refSim));
  vecs[corpus.references.length] = at(-simToAngle(flawSim));
  return [player, ...vecs];
}

test('corpus includes references, the best option, and wrong options under their flaw tags', () => {
  const best = scenario.reframe_options.find((o) => o.is_best).text;
  assert.ok(corpus.references.includes(best));
  for (const r of scenario.reference_frames) assert.ok(corpus.references.includes(r));
  const narrow = scenario.reframe_options.find((o) => o.flaw_tags.includes('too_narrow')).text;
  assert.ok(corpus.flaws.some((f) => f.tag === 'too_narrow' && f.text === narrow));
  // Pattern duplicated in flaw_patterns and reframe_options appears once.
  assert.equal(corpus.flaws.filter((f) => f.text === narrow).length, 1);
});

test('cosine handles zero vectors', () => {
  assert.equal(cosine([0, 0], [1, 0]), 0);
  assert.equal(Math.round(cosine([1, 0], [1, 0]) * 1000), 1000);
});

test('similarity maps linearly between floor and ceiling', () => {
  const { floor, ceiling } = DEFAULT_THRESHOLDS;
  assert.equal(gradeSemantic(vectorsFor(ceiling + 0.05, 0.1), corpus).score, 100);
  assert.equal(gradeSemantic(vectorsFor(floor - 0.05, 0.1), corpus).score, 0);
  const mid = (floor + ceiling) / 2;
  assert.equal(gradeSemantic(vectorsFor(mid, 0.1), corpus).score, 50);
});

test('a sentence closer to a flaw than to any reference is flagged and penalised', () => {
  const g = gradeSemantic(vectorsFor(0.6, 0.75), corpus);
  assert.equal(g.flaw.tag, corpus.flaws[0].tag);
  const unflagged = Math.round((100 * (0.6 - DEFAULT_THRESHOLDS.floor)) / (DEFAULT_THRESHOLDS.ceiling - DEFAULT_THRESHOLDS.floor));
  assert.equal(g.score, Math.round(unflagged * FLAW_MULTIPLIER));
});

test('a flaw within the margin of the best reference is not flagged', () => {
  assert.equal(gradeSemantic(vectorsFor(0.7, 0.72), corpus).flaw, null);
  assert.equal(gradeSemantic(vectorsFor(0.3, 0.5), corpus).flaw, null); // below flawMin
});

test('scenario thresholds override the defaults', () => {
  const g = gradeSemantic(vectorsFor(0.5, 0.1), corpus, { floor: 0.4, ceiling: 0.6 });
  assert.equal(g.score, 50);
});

test('keyword fallback rewards measurable, decision-linked framings', () => {
  assert.equal(keywordGrade('').method, 'none');
  assert.equal(keywordGrade('Determine whether the renewal rate declined and what to decide by Thursday').score, 100);
  assert.ok(keywordGrade('Build a churn prediction model').score < 40);
  assert.ok(keywordGrade('Why are members unhappy').score < 40);
});

test('validator rejects bad grading thresholds and empty reference frames', () => {
  const s = structuredClone(scenario);
  s.grading = { floor: 0.9, ceiling: 0.5, bogus: 1 };
  s.reference_frames = [];
  const { errors } = validateScenario(s);
  assert.ok(errors.some((e) => e.includes('floor must be below')));
  assert.ok(errors.some((e) => e.includes('unknown key "bogus"')));
  assert.ok(errors.some((e) => e.includes('reference_frames')));
});
