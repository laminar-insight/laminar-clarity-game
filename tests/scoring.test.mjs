import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreRun, expectedBucketOrder, visibleComponents, acceptedBuckets, WEIGHTS } from '../js/scoring.js';
import { validateScenario } from '../scripts/validate.mjs';
import { gradeReframe } from '../js/reframe.js';
import { computeStreak, dailyScenarioId } from '../js/storage.js';
import { buildGrid, encodeResult, decodeResult } from '../js/share.js';

const scenario = JSON.parse(readFileSync(new URL('../scenarios/membership-softer.json', import.meta.url)));

/** Build a run that files every visible card into its first correct bucket. */
function perfectRun(spine, asked) {
  const assignments = {};
  for (const c of visibleComponents(scenario, asked)) assignments[c.id] = acceptedBuckets(c, spine)[0];
  return {
    reframeChoice: scenario.reframe_options.find((o) => o.is_best).id,
    asked,
    spine,
    assignments,
    priority: expectedBucketOrder(scenario, spine).map((e) => e.id),
  };
}

const SENIOR = ['q_definition', 'q_cohort', 'q_decision', 'q_product', 'q_last_year'];
const ALL_DRIVERS = ['q_definition', 'q_cohort', 'q_product', 'q_last_year', 'q_data'];

test('weights sum to 100', () => {
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100);
});

test('scenario 1 passes the validator', () => {
  const { errors } = validateScenario(scenario);
  assert.deepEqual(errors, []);
});

test('validator catches a component mapped to an unknown bucket', () => {
  const broken = structuredClone(scenario);
  broken.components[0].buckets.metric_math = 'nonsense';
  const { errors } = validateScenario(broken);
  assert.ok(errors.some((e) => e.includes('unknown bucket "nonsense"')));
});

test('validator catches a missing spine mapping and one-sided unlocks', () => {
  const broken = structuredClone(scenario);
  delete broken.components[0].buckets.lifecycle;
  broken.questions.find((q) => q.id === 'q_fee').unlocks = ['nps_drop'];
  const { errors } = validateScenario(broken);
  assert.ok(errors.some((e) => e.includes('no bucket for spine "lifecycle"')));
  assert.ok(errors.some((e) => e.includes('q_fee') && e.includes('nps_drop')));
});

test('a perfect structure scores high on every spine', () => {
  for (const sp of scenario.spines) {
    const r = scoreRun(scenario, perfectRun(sp.id, SENIOR));
    assert.equal(r.categories.mece.score, 100, sp.id);
    assert.equal(r.categories.noise.score, 100, sp.id);
    assert.equal(r.categories.priority.score, 100, sp.id);
    assert.equal(r.categories.checks.score, 100, sp.id);
    assert.equal(r.categories.coverage.score, 88, sp.id); // promo_low_frequency (0.5 of 4) stays locked
    assert.ok(r.overall >= 90, `${sp.id}: ${r.overall}`);
  }
});

test('asking every driver question gives full coverage but misses the decision check', () => {
  const r = scoreRun(scenario, perfectRun('metric_math', ALL_DRIVERS));
  assert.equal(r.categories.coverage.score, 100);
  assert.equal(r.categories.checks.score, 67);
});

test('locked drivers cannot be covered', () => {
  const r = scoreRun(scenario, perfectRun('metric_math', ['q_nps', 'q_outage']));
  assert.equal(r.categories.coverage.score, 0);
  assert.ok(r.categories.coverage.items.every((i) => i.status === 'locked'));
  assert.equal(r.categories.efficiency.score, 0);
});

test('misfiled driver earns half credit', () => {
  const run = perfectRun('metric_math', SENIOR);
  run.assignments.grace_window = 'mix';
  const r = scoreRun(scenario, run);
  const item = r.categories.coverage.items.find((i) => i.id === 'grace_window');
  assert.equal(item.status, 'partial');
  assert.equal(item.credit, 0.5);
});

test('noise penalty doubles once the debunking question was asked', () => {
  const blind = perfectRun('int_ext', SENIOR);
  blind.assignments.competitor_openings = 'external';
  const informed = perfectRun('int_ext', [...SENIOR.slice(0, 4), 'q_markets']);
  informed.assignments.competitor_openings = 'external';
  assert.equal(scoreRun(scenario, blind).categories.noise.score, 88);
  assert.equal(scoreRun(scenario, informed).categories.noise.score, 75);
});

test('orphans and empty branches cost MECE points', () => {
  const run = perfectRun('lifecycle', SENIOR);
  delete run.assignments.nps_drop;
  run.assignments.auto_renew_optin = 'renewal';
  const r = scoreRun(scenario, run);
  // onboarding is empty although auto_renew belongs there; engagement is empty
  // only because q_data wasn't asked, which coverage already charges for.
  assert.deepEqual(r.categories.mece.orphans, ['nps_drop']);
  assert.deepEqual(r.categories.mece.emptyBuckets, ['onboarding']);
  assert.equal(r.categories.mece.score, 80);
});

test('expected bucket order follows the priority key', () => {
  assert.deepEqual(expectedBucketOrder(scenario, 'metric_math').map((e) => e.id), ['measurement', 'mix', 'rate']);
  assert.deepEqual(expectedBucketOrder(scenario, 'lifecycle').map((e) => e.id), ['renewal', 'acquisition', 'onboarding', 'engagement']);
  assert.deepEqual(expectedBucketOrder(scenario, 'int_ext').map((e) => e.id), ['measurement', 'internal', 'external']);
});

test('reversed priority scores zero', () => {
  const run = perfectRun('metric_math', SENIOR);
  run.priority = [...run.priority].reverse();
  assert.equal(scoreRun(scenario, run).categories.priority.score, 0);
});

test('scoring is deterministic', () => {
  const run = perfectRun('lifecycle', ['q_metric', 'q_cohort', 'q_nps']);
  assert.deepEqual(scoreRun(scenario, run), scoreRun(scenario, structuredClone(run)));
});

test('reframe keyword grader flags the classic flaws', () => {
  const tags = (t) => gradeReframe(t).hits.map((x) => x.tag);
  assert.ok(tags('Find out why members are unhappy').includes('assumes_cause'));
  assert.ok(tags('Build a churn prediction model').includes('jumps_to_solution'));
  assert.ok(tags('Explain why the base feels softer').includes('unmeasurable'));
  assert.ok(tags('Determine whether the renewal rate declined and what to decide by Thursday').includes('names_metric'));
});

test('streak counts consecutive days ending today or yesterday', () => {
  const p = { days: { '2026-10-21': {}, '2026-10-22': {}, '2026-10-23': {} } };
  assert.equal(computeStreak(p, '2026-10-23'), 3);
  assert.equal(computeStreak(p, '2026-10-24'), 3);
  assert.equal(computeStreak(p, '2026-10-25'), 0);
});

test('daily scenario rotates by date', () => {
  const ids = ['a', 'b', 'c'];
  const picks = ['2026-10-24', '2026-10-25', '2026-10-26'].map((d) => dailyScenarioId(ids, d));
  assert.equal(new Set(picks).size, 3);
});

test('share result round-trips through the URL hash', () => {
  const run = perfectRun('metric_math', SENIOR);
  const result = scoreRun(scenario, run);
  const grid = buildGrid(scenario, run, result);
  const decoded = decodeResult(encodeResult({ scenarioId: scenario.id, date: '2026-10-24', overall: result.overall, grid }));
  assert.deepEqual(decoded, { scenarioId: scenario.id, date: '2026-10-24', overall: result.overall, grid });
  assert.equal(decodeResult('not-valid'), null);
});
