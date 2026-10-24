// Keyword-based feedback on the player's free-text reframe. The hits are
// always shown as feedback; keywordGrade() is the fallback written score when
// the embedding grader (js/semantic.js) can't load.

export const SOFT_CHAR_LIMIT = 160;

const RULES = [
  {
    tag: 'names_metric',
    good: true,
    test: /\b(rate|renewals?|retention|churn|%|percent|count|metric|declin\w*|drop\w*|fell|down \d)/i,
    note: 'Names something you can measure.',
  },
  {
    tag: 'whether',
    good: true,
    test: /\b(whether|if|is it real|actually|really)\b/i,
    note: 'Leaves room for the change not being real (or not being what it seems).',
  },
  {
    tag: 'decision_link',
    good: true,
    test: /\b(decid\w*|decision|action\w*|recommend\w*|prioriti\w*|thursday|staff meeting|leadership)\b/i,
    note: 'Connects the work to a decision or deadline.',
  },
  {
    tag: 'assumes_cause',
    good: false,
    test: /\b(unhappy|dissatisf\w*|frustrat\w*|because|due to|caused by|blame)\b/i,
    note: 'Bakes a cause into the question before you have evidence for it.',
  },
  {
    tag: 'jumps_to_solution',
    good: false,
    test: /\b(model|predict\w*|dashboard|build|campaign|launch|machine learning|ml|survey)\b/i,
    note: 'Jumps to a deliverable before the problem is pinned down.',
  },
  {
    tag: 'too_narrow',
    good: false,
    test: /\b(competitor|bulkbarn|outage|crash|nps|fee)\b/i,
    note: 'Centres one loud hypothesis, which can crowd out the others.',
  },
];

const VAGUE = /\b(feels?|soft(er)?|vibes?|sentiment|health|weak(er)?)\b/i;

export function gradeReframe(text) {
  const t = (text || '').trim();
  if (!t) return { empty: true, hits: [] };
  const hits = RULES.filter((r) => r.test.test(t)).map(({ tag, good, note }) => ({ tag, good, note }));
  if (VAGUE.test(t) && !hits.some((h) => h.tag === 'names_metric')) {
    hits.push({ tag: 'unmeasurable', good: false, note: 'Uses vague language without naming a metric — how would you know you\'re done?' });
  }
  if (t.length > SOFT_CHAR_LIMIT) {
    hits.push({ tag: 'long', good: false, note: `Over ${SOFT_CHAR_LIMIT} characters — a sharp problem statement usually fits in one breath.` });
  }
  return { empty: false, hits };
}

/**
 * Fallback written score (0–100) used when the embedding model is unavailable:
 * start at 40, +20 per good signal, −25 per flaw, −10 if over the soft limit.
 */
export function keywordGrade(text) {
  const g = gradeReframe(text);
  if (g.empty) return { method: 'none', score: 0 };
  let score = 40;
  for (const x of g.hits) score += x.good ? 20 : x.tag === 'long' ? -10 : -25;
  return { method: 'keyword', score: Math.max(0, Math.min(100, score)) };
}
