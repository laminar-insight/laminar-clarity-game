// Deterministic scoring for a Laminar round. Pure functions only — no DOM,
// no storage — so the same code runs in the browser and in Node tests.

export const SPECIAL_BUCKETS = ['noise', 'ruled_out'];
export const SPECIAL_BUCKET_NAMES = { noise: 'Noise', ruled_out: 'Ruled out' };
export const COMPONENT_TYPES = ['driver', 'evidence', 'ruled_out', 'red_herring', 'assumption'];
export const QUESTION_VALUES = ['high', 'med', 'low', 'noise'];
export const FLAW_TAGS = ['assumes_cause', 'jumps_to_solution', 'unmeasurable', 'too_narrow'];

// How much each question is worth for the efficiency score.
export const VALUE_POINTS = { high: 1, med: 0.6, low: 0.25, noise: 0 };

// Category weights for the overall score (sum to 100).
export const WEIGHTS = {
  reframe: 10,
  coverage: 25,
  mece: 10,
  noise: 15,
  efficiency: 10,
  priority: 15,
  checks: 15,
};

// Noise penalties. Decision: a non-driver filed as a driver is always
// penalised, but the penalty doubles once you've asked the question that
// debunks it — at that point you had the evidence and ignored it.
export const NOISE_PENALTY = { debunked: 25, unverified: 12, assumption: 15 };

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const toList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Bucket ids that count as a correct placement for `comp` under `spineId`. */
export function acceptedBuckets(comp, spineId) {
  return toList(comp.buckets?.[spineId]);
}

export function isUnlocked(comp, asked) {
  const by = toList(comp.unlocked_by);
  return by.length === 0 || by.some((q) => asked.includes(q));
}

export function visibleComponents(scenario, asked) {
  return scenario.components.filter((c) => isUnlocked(c, asked));
}

export function getSpine(scenario, spineId) {
  return scenario.spines.find((s) => s.id === spineId);
}

/**
 * Expected investigation order of a spine's buckets, derived from the
 * spine-independent priority_key: a bucket ranks by the earliest key entry
 * that lands in it. Returns [{ id, rank }] sorted by rank.
 */
export function expectedBucketOrder(scenario, spineId) {
  const spine = getSpine(scenario, spineId);
  const byId = Object.fromEntries(scenario.components.map((c) => [c.id, c]));
  const fallback = scenario.priority_key.length;
  return spine.buckets
    .map((b, i) => {
      let rank = fallback;
      scenario.priority_key.forEach((item, idx) => {
        const comp = byId[item.id];
        const hits = comp ? acceptedBuckets(comp, spineId)[0] === b.id : item.id === b.id;
        if (hits && idx < rank) rank = idx;
      });
      return { id: b.id, rank, authored: i };
    })
    .sort((a, b) => a.rank - b.rank || a.authored - b.authored)
    .map(({ id, rank }) => ({ id, rank }));
}

/** Placement status of one component given the player's bucket. */
export function placementStatus(comp, spineId, placed) {
  if (placed == null) return 'unplaced';
  const ok = acceptedBuckets(comp, spineId);
  if (ok.includes(placed)) return 'correct';
  if (comp.type === 'driver' || comp.type === 'evidence') {
    // Filed under a real branch, just the wrong one.
    return SPECIAL_BUCKETS.includes(placed) ? 'wrong' : 'partial';
  }
  // Non-drivers: the other special bucket is close enough; a real branch is wrong.
  return SPECIAL_BUCKETS.includes(placed) ? 'partial' : 'wrong';
}

function scoreReframe(scenario, run) {
  const opt = scenario.reframe_options.find((o) => o.id === run.reframeChoice);
  return {
    score: opt?.is_best ? 100 : 0,
    choice: opt ?? null,
    best: scenario.reframe_options.find((o) => o.is_best),
  };
}

function scoreCoverage(scenario, run) {
  const drivers = scenario.components.filter((c) => c.type === 'driver');
  const total = drivers.reduce((s, d) => s + d.weight, 0);
  let got = 0;
  const items = drivers.map((d) => {
    let status;
    if (!isUnlocked(d, run.asked)) status = 'locked';
    else status = placementStatus(d, run.spine, run.assignments[d.id]);
    const credit = status === 'correct' ? 1 : status === 'partial' ? 0.5 : 0;
    got += d.weight * credit;
    return { id: d.id, weight: d.weight, status, credit };
  });
  return { score: total ? clamp(Math.round((100 * got) / total)) : 100, items, got, total };
}

function scoreMece(scenario, run) {
  const spine = getSpine(scenario, run.spine);
  const visible = visibleComponents(scenario, run.asked);
  const valid = new Set([...spine.buckets.map((b) => b.id), ...SPECIAL_BUCKETS]);
  const orphans = visible.filter((c) => run.assignments[c.id] == null).map((c) => c.id);
  // Assignments are single-valued, so overlap can only come from corrupt state.
  const invalid = visible.filter((c) => run.assignments[c.id] != null && !valid.has(run.assignments[c.id])).map((c) => c.id);
  const used = new Set(visible.map((c) => run.assignments[c.id]));
  // A branch only counts as empty if a card you surfaced belongs in it;
  // branches you never found material for are already charged in coverage.
  const emptyBuckets = spine.buckets
    .filter((b) => !used.has(b.id) && visible.some((c) => acceptedBuckets(c, spine.id).includes(b.id)))
    .map((b) => b.id);
  const score = clamp(100 - 10 * orphans.length - 10 * invalid.length - 10 * emptyBuckets.length);
  return { score, orphans, invalid, emptyBuckets };
}

function scoreNoise(scenario, run) {
  const items = [];
  let penalty = 0;
  for (const c of visibleComponents(scenario, run.asked)) {
    if (c.type === 'driver' || c.type === 'evidence') continue;
    const placed = run.assignments[c.id];
    if (placed == null || SPECIAL_BUCKETS.includes(placed)) continue;
    const debunked = toList(c.debunked_by).some((q) => run.asked.includes(q));
    const p = c.type === 'assumption' ? NOISE_PENALTY.assumption : debunked ? NOISE_PENALTY.debunked : NOISE_PENALTY.unverified;
    penalty += p;
    items.push({ id: c.id, bucket: placed, debunked, penalty: p });
  }
  return { score: clamp(100 - penalty), items };
}

function scoreEfficiency(scenario, run) {
  const qs = run.asked.map((id) => scenario.questions.find((q) => q.id === id)).filter(Boolean);
  if (!qs.length) return { score: 0, asked: 0, budget: scenario.question_budget, points: 0 };
  const points = qs.reduce((s, q) => s + VALUE_POINTS[q.value], 0);
  return {
    score: clamp(Math.round((100 * points) / qs.length)),
    asked: qs.length,
    budget: scenario.question_budget,
    points,
  };
}

function scorePriority(scenario, run) {
  const expected = expectedBucketOrder(scenario, run.spine);
  const rank = Object.fromEntries(expected.map((e) => [e.id, e.rank]));
  // Anything the player didn't rank goes to the end, in authored order.
  const order = [...run.priority.filter((id) => id in rank)];
  for (const e of getSpine(scenario, run.spine).buckets) if (!order.includes(e.id)) order.push(e.id);
  let pairs = 0;
  let agree = 0;
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      if (rank[order[i]] === rank[order[j]]) continue;
      pairs++;
      if (rank[order[i]] < rank[order[j]]) agree++;
    }
  }
  return { score: pairs ? Math.round((100 * agree) / pairs) : 100, order, expected: expected.map((e) => e.id) };
}

function scoreChecks(scenario, run) {
  const items = scenario.global_checks.map((c) => ({
    ...c,
    passed: c.satisfied_by.some((q) => run.asked.includes(q)),
  }));
  const passed = items.filter((i) => i.passed).length;
  return { score: items.length ? Math.round((100 * passed) / items.length) : 100, items };
}

/**
 * Score a completed run.
 * run = { reframeChoice, asked: [qid], spine, assignments: {compId: bucketId}, priority: [bucketId] }
 */
export function scoreRun(scenario, run) {
  const r = { asked: [], assignments: {}, priority: [], ...run };
  const categories = {
    reframe: scoreReframe(scenario, r),
    coverage: scoreCoverage(scenario, r),
    mece: scoreMece(scenario, r),
    noise: scoreNoise(scenario, r),
    efficiency: scoreEfficiency(scenario, r),
    priority: scorePriority(scenario, r),
    checks: scoreChecks(scenario, r),
  };
  const overall = Math.round(
    Object.entries(WEIGHTS).reduce((s, [k, w]) => s + (w * categories[k].score) / 100, 0),
  );
  return { overall, categories };
}

export function gradeLabel(overall) {
  if (overall >= 85) return 'Laminar';
  if (overall >= 70) return 'Smooth';
  if (overall >= 50) return 'Choppy';
  return 'Turbulent';
}
