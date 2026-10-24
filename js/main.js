import {
  SPECIAL_BUCKETS,
  SPECIAL_BUCKET_NAMES,
  WEIGHTS,
  acceptedBuckets,
  expectedBucketOrder,
  getSpine,
  gradeLabel,
  isUnlocked,
  placementStatus,
  scoreRun,
  visibleComponents,
} from './scoring.js';
import { SOFT_CHAR_LIMIT, gradeReframe } from './reframe.js';
import {
  clearRun,
  computeStats,
  dailyScenarioId,
  dateKey,
  loadProgress,
  loadRun,
  recordFinish,
  saveRun,
} from './storage.js';
import { ROW_LABELS, buildGrid, decodeResult, encodeResult, gridToEmoji, shareText } from './share.js';

const app = document.getElementById('app');

const ROUNDS = ['reframe', 'ask', 'structure', 'prioritize', 'debrief'];
const ROUND_LABELS = { reframe: 'Reframe', ask: 'Ask', structure: 'Structure', prioritize: 'Prioritize', debrief: 'Debrief' };
const ARCHETYPES = {
  metric_moved: 'Metric moved and nobody knows why',
  ambiguous_strategic: 'Ambiguous strategic ask',
  conflicting_dashboards: 'Conflicting dashboards',
  model_no_decision: '“Build us a model” with no decision',
};
const FLAW_LABELS = {
  assumes_cause: 'Assumes cause',
  jumps_to_solution: 'Jumps to solution',
  unmeasurable: 'Unmeasurable',
  too_narrow: 'Too narrow',
};
const TYPE_LABELS = {
  driver: 'Driver',
  evidence: 'Evidence',
  ruled_out: 'Ruled out',
  red_herring: 'Red herring',
  assumption: 'Assumption',
};
const VALUE_LABELS = { high: 'High value', med: 'Useful', low: 'Low value', noise: 'Noise' };
const CATEGORY_LABELS = {
  reframe: 'Reframe',
  coverage: 'Coverage',
  mece: 'MECE',
  noise: 'Noise control',
  efficiency: 'Efficiency',
  priority: 'Prioritization',
  checks: 'Sanity checks',
};

let scenario;
let run;
let today;
let view = 'home'; // 'home' | 'shared' | 'game'
let shared = null;
// Ephemeral UI state — not saved, reset when the round changes.
let ui = {};

// ---------- tiny DOM helper ----------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function seededShuffle(list, seed) {
  let x = 2166136261;
  for (const ch of seed) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  let a = x >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const seed = (salt) => `${scenario.id}:${run?.date ?? today}:${salt}`;
const question = (id) => scenario.questions.find((q) => q.id === id);
const component = (id) => scenario.components.find((c) => c.id === id);

function bucketName(spineId, bucketId) {
  if (SPECIAL_BUCKET_NAMES[bucketId]) return SPECIAL_BUCKET_NAMES[bucketId];
  return getSpine(scenario, spineId)?.buckets.find((b) => b.id === bucketId)?.name ?? bucketId;
}

/** Components in a stable shuffled order, so card types aren't grouped. */
function cardOrder() {
  const visible = new Set(visibleComponents(scenario, run.asked).map((c) => c.id));
  return seededShuffle(scenario.components, seed('cards')).filter((c) => visible.has(c.id));
}

// ---------- state ----------

function newRun() {
  return {
    v: 1,
    scenarioId: scenario.id,
    date: today,
    round: 'brief',
    reframeText: '',
    reframeStage: 'write',
    reframeChoice: null,
    asked: [],
    spine: null,
    structureStage: 'spine',
    assignments: {},
    cursor: 0,
    priority: [],
    finished: false,
  };
}

function update(patch, { top = false } = {}) {
  const roundChanged = patch.round && patch.round !== run.round;
  Object.assign(run, patch);
  if (roundChanged) ui = {};
  saveRun(run);
  render();
  if (top || roundChanged) window.scrollTo({ top: 0 });
}

function go(nextView) {
  view = nextView;
  ui = {};
  render();
  window.scrollTo({ top: 0 });
}

// ---------- shared pieces ----------

function topbar() {
  const idx = view === 'game' ? ROUNDS.indexOf(run.round) : -1;
  return h(
    'header',
    { class: 'topbar' },
    h('button', { class: 'brand', onclick: () => go('home'), 'aria-label': 'Laminar home' }, logo(), h('span', null, 'Laminar')),
    view === 'game' &&
      h(
        'ol',
        { class: 'stepper', 'aria-label': 'Rounds' },
        ROUNDS.map((r, i) =>
          h(
            'li',
            { class: i < idx ? 'done' : i === idx ? 'current' : '', 'aria-current': i === idx ? 'step' : null },
            h('span', { class: 'step-label' }, ROUND_LABELS[r]),
          ),
        ),
      ),
  );
}

function logo() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'logo');
  svg.setAttribute('aria-hidden', 'true');
  ['M3 7c3-3 6 3 9 0s6-3 9 0', 'M3 12h18', 'M3 17h18'].forEach((d, i) => {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', `logo-line l${i}`);
    svg.append(p);
  });
  return svg;
}

function roundHead(n, title, sub) {
  return h(
    'div',
    { class: 'round-head' },
    h('p', { class: 'eyebrow' }, `Round ${n} · ${ROUND_LABELS[ROUNDS[n - 1]]}`),
    h('h1', null, title),
    sub && h('p', { class: 'lede' }, sub),
  );
}

function initials(name) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function askMessage() {
  const { ask } = scenario;
  return h(
    'div',
    { class: 'slack' },
    h('div', { class: 'slack-channel' }, ask.channel),
    h(
      'div',
      { class: 'slack-msg' },
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, initials(ask.sender.name)),
      h(
        'div',
        { class: 'slack-body' },
        h('div', { class: 'slack-meta' }, h('strong', null, ask.sender.name), h('span', null, ask.sender.role), h('time', null, ask.sent)),
        ask.messages.map((m) => h('p', null, m)),
      ),
    ),
  );
}

function constraints() {
  return h('ul', { class: 'constraints', 'aria-label': 'Constraints' }, scenario.ask.constraints.map((c) => h('li', null, c)));
}

/** The original ask + everything learned so far; collapsible on phones. */
function contextPanel() {
  const facts = run.asked.map(question);
  const wide = window.matchMedia('(min-width: 960px)').matches;
  return h(
    'aside',
    { class: 'context' },
    h(
      'details',
      { open: wide || ui.contextOpen, ontoggle: (e) => (ui.contextOpen = e.target.open) },
      h('summary', null, 'The ask', facts.length ? h('span', { class: 'count' }, `${facts.length} fact${facts.length === 1 ? '' : 's'}`) : null),
      askMessage(),
      constraints(),
      facts.length > 0 &&
        h('div', { class: 'facts' }, h('h3', null, 'What you’ve learned'), h('ul', null, facts.map((q) => h('li', null, q.reveal)))),
    ),
  );
}

function actions(...buttons) {
  return h('div', { class: 'actions' }, ...buttons);
}

function primary(label, onclick, disabled = false) {
  return h('button', { class: 'btn primary', onclick, disabled }, label);
}

function secondary(label, onclick) {
  return h('button', { class: 'btn ghost', onclick }, label);
}

// ---------- home ----------

function renderHome() {
  const stats = computeStats(loadProgress(), today);
  let cta = 'Start today’s scenario';
  if (run?.finished) cta = 'See your debrief';
  else if (run && run.round !== 'brief') cta = `Resume · ${ROUND_LABELS[run.round]}`;

  const start = () => {
    if (!run) {
      run = newRun();
      saveRun(run);
    }
    go('game');
  };
  const restart = () => {
    if (!confirm('Start this scenario over? Your progress on it will be cleared.')) return;
    clearRun(scenario.id, today);
    run = newRun();
    saveRun(run);
    go('game');
  };

  return h(
    'main',
    { class: 'home' },
    h('section', { class: 'hero' }, h('h1', null, 'Laminar'), h('p', { class: 'tagline' }, 'Turn the turbulent into structure.')),
    h(
      'section',
      { class: 'daily card' },
      h('p', { class: 'eyebrow' }, `Today · ${today}`),
      h('h2', null, scenario.title),
      h('p', { class: 'muted' }, `${ARCHETYPES[scenario.archetype] ?? scenario.archetype} · ${scenario.domain}`),
      h('p', { class: 'muted small' }, '5 rounds · about 5–7 minutes'),
      h('div', { class: 'stack' }, primary(cta, start), run && run.round !== 'brief' && secondary('Start over', restart)),
    ),
    h(
      'section',
      { class: 'stats', 'aria-label': 'Your stats' },
      stat(stats.streak, 'day streak'),
      stat(stats.played, 'played'),
      stat(stats.best ?? '—', 'best score'),
    ),
    h(
      'section',
      { class: 'how' },
      h('h3', null, 'How a round works'),
      h(
        'ol',
        null,
        h('li', null, h('strong', null, 'Reframe'), ' — turn the vague ask into a problem statement.'),
        h('li', null, h('strong', null, 'Ask'), ' — spend a small question budget to learn what’s really going on.'),
        h('li', null, h('strong', null, 'Structure'), ' — pick a spine and sort the evidence into an issue tree.'),
        h('li', null, h('strong', null, 'Prioritize'), ' — choose what to investigate first.'),
        h('li', null, h('strong', null, 'Debrief'), ' — compare your tree with other valid ones and the answer key.'),
      ),
    ),
  );
}

function stat(value, label) {
  return h('div', { class: 'stat' }, h('strong', null, value), h('span', null, label));
}

// ---------- brief ----------

function renderBrief() {
  return h(
    'main',
    { class: 'single' },
    h(
      'div',
      { class: 'round-head' },
      h('p', { class: 'eyebrow' }, scenario.company),
      h('h1', null, 'A message just landed'),
      h('p', { class: 'lede' }, 'Read it the way you’d read it at work. What’s actually being asked?'),
    ),
    askMessage(),
    constraints(),
    actions(primary('Start Round 1 · Reframe', () => update({ round: 'reframe' }))),
  );
}

// ---------- round 1: reframe ----------

function reframeOptions() {
  return seededShuffle(scenario.reframe_options, seed('reframe'));
}

function renderReframe() {
  const stage = run.reframeStage;
  let body;

  if (stage === 'write') {
    const counter = h('span', { class: 'counter' });
    const lock = primary('Lock it in', () => update({ reframeStage: 'choose' }));
    const sync = () => {
      const n = run.reframeText.length;
      counter.textContent = `${n} / ${SOFT_CHAR_LIMIT}`;
      counter.classList.toggle('over', n > SOFT_CHAR_LIMIT);
      lock.disabled = run.reframeText.trim().length < 8;
    };
    const input = h('textarea', {
      id: 'reframe-input',
      rows: 3,
      placeholder: 'e.g. Determine whether…',
      'aria-describedby': 'reframe-help',
      oninput: (e) => {
        run.reframeText = e.target.value.replace(/\n/g, ' ');
        saveRun(run);
        sync();
      },
    });
    input.value = run.reframeText;
    sync();
    body = [
      roundHead(1, 'What problem are you actually solving?', 'Write one sentence — the line you’d put at the top of your doc.'),
      h('label', { class: 'field' }, h('span', { class: 'sr-only' }, 'Your problem statement'), input),
      h('div', { class: 'field-meta', id: 'reframe-help' }, h('span', null, 'One sentence. Short beats complete.'), counter),
      actions(lock, secondary('Skip writing', () => update({ reframeStage: 'choose' }))),
    ];
  } else if (stage === 'choose') {
    const choice = ui.pendingChoice;
    body = [
      roundHead(1, 'Which framing would you take into Thursday?', 'Pick the strongest problem statement.'),
      run.reframeText && h('blockquote', { class: 'yours' }, h('span', { class: 'label' }, 'You wrote'), run.reframeText),
      h(
        'div',
        { class: 'options', role: 'radiogroup', 'aria-label': 'Problem statements' },
        reframeOptions().map((o) =>
          h(
            'button',
            {
              class: `option${choice === o.id ? ' selected' : ''}`,
              role: 'radio',
              'aria-checked': String(choice === o.id),
              onclick: () => {
                ui.pendingChoice = o.id;
                render();
              },
            },
            o.text,
          ),
        ),
      ),
      actions(primary('Confirm', () => update({ reframeChoice: choice, reframeStage: 'feedback' }), !choice)),
    ];
  } else {
    const chosen = scenario.reframe_options.find((o) => o.id === run.reframeChoice);
    const grade = gradeReframe(run.reframeText);
    body = [
      roundHead(1, chosen?.is_best ? 'That’s the one.' : 'Not quite.', chosen?.is_best ? 'Here’s why it beats the others.' : 'Here’s what each framing gets wrong.'),
      h(
        'div',
        { class: 'options readonly' },
        reframeOptions().map((o) =>
          h(
            'div',
            { class: `option${o.is_best ? ' best' : ''}${o.id === run.reframeChoice ? ' selected' : ''}` },
            h(
              'div',
              { class: 'option-tags' },
              o.id === run.reframeChoice && h('span', { class: 'tag you' }, 'Your pick'),
              o.is_best && h('span', { class: 'tag good' }, 'Best'),
              (o.flaw_tags || []).map((t) => h('span', { class: 'tag flaw' }, FLAW_LABELS[t] ?? t)),
            ),
            h('p', { class: 'option-text' }, o.text),
            h('p', { class: 'option-why' }, o.explanation),
          ),
        ),
      ),
      reframeFeedback(grade),
      actions(primary('Next · Ask', () => update({ round: 'ask' }))),
    ];
  }

  return h('main', { class: 'game' }, contextPanel(), h('section', { class: 'play' }, body));
}

function reframeFeedback(grade) {
  if (grade.empty) return null;
  return h(
    'div',
    { class: 'card feedback' },
    h('h3', null, 'Your sentence'),
    h('blockquote', { class: 'yours' }, run.reframeText),
    grade.hits.length
      ? h('ul', { class: 'hits' }, grade.hits.map((x) => h('li', { class: x.good ? 'good' : 'flag' }, x.note)))
      : h('p', { class: 'muted' }, 'No strong signals either way. Compare it with the best option above.'),
    h('p', { class: 'muted small' }, 'Quick keyword check, not scored. Smarter grading of free text is coming.'),
  );
}

// ---------- round 2: ask ----------

function renderAsk() {
  const budget = scenario.question_budget;
  const left = budget - run.asked.length;
  const remaining = seededShuffle(scenario.questions, seed('questions')).filter((q) => !run.asked.includes(q.id));

  const ask = (q) => {
    if (left <= 0) return;
    ui.justAsked = q.id;
    update({ asked: [...run.asked, q.id] });
    document.querySelector(`[data-reply="${q.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const thread = run.asked.map((id) => {
    const q = question(id);
    const unlocked = (q.unlocks || []).map(component);
    return h(
      'div',
      { class: `exchange${ui.justAsked === id ? ' fresh' : ''}`, 'data-reply': id },
      h('p', { class: 'bubble me' }, q.text),
      h(
        'div',
        { class: 'bubble them' },
        h('span', { class: 'who' }, scenario.ask.sender.name.split(' ')[0]),
        h('p', null, q.reveal),
        unlocked.length > 0 &&
          h(
            'ul',
            { class: 'unlocks' },
            unlocked.map((c) => h('li', null, h('span', { class: 'tag new' }, 'New card'), c.text)),
          ),
      ),
    );
  });

  const unused = left > 0 ? `${left} question${left === 1 ? '' : 's'} unused` : null;

  return h(
    'main',
    { class: 'game' },
    contextPanel(),
    h(
      'section',
      { class: 'play' },
      roundHead(2, 'Spend your questions wisely', `You get ${budget} questions. Some replies surface new facts you can use in your tree.`),
      h(
        'div',
        { class: 'budget', role: 'status', 'aria-live': 'polite' },
        h(
          'div',
          { class: 'pips', 'aria-hidden': 'true' },
          Array.from({ length: budget }, (_, i) => h('span', { class: i < run.asked.length ? 'pip used' : 'pip' })),
        ),
        h('span', null, left > 0 ? `${left} of ${budget} left` : 'Budget spent'),
      ),
      thread.length > 0 && h('div', { class: 'thread', 'aria-live': 'polite' }, thread),
      h(
        'div',
        { class: 'questions' },
        h('h3', null, left > 0 ? `Ask ${scenario.ask.sender.name.split(' ')[0]}…` : 'Questions you didn’t ask'),
        remaining.map((q) => h('button', { class: 'question', disabled: left <= 0, onclick: () => ask(q) }, q.text)),
      ),
      actions(
        primary('Next · Structure', () => update({ round: 'structure' })),
        unused && h('span', { class: 'muted small' }, unused),
      ),
    ),
  );
}

// ---------- round 3: structure ----------

function renderStructure() {
  const stage = run.structureStage;
  const body =
    stage === 'spine' ? structureSpine() : stage === 'assign' ? structureAssign() : structureReview();
  return h('main', { class: 'game' }, contextPanel(), h('section', { class: 'play' }, body));
}

function structureSpine() {
  const n = visibleComponents(scenario, run.asked).length;
  return [
    roundHead(3, 'Pick your spine', 'The spine is the top-level cut of your issue tree. More than one is valid — pick the one you’d defend.'),
    h(
      'div',
      { class: 'spines' },
      scenario.spines.map((sp) =>
        h(
          'button',
          {
            class: 'spine',
            onclick: () =>
              update({
                spine: sp.id,
                structureStage: 'assign',
                cursor: 0,
                assignments: sp.id === run.spine ? run.assignments : {},
                priority: [],
              }),
          },
          h('strong', null, sp.name),
          h('span', { class: 'muted' }, sp.blurb),
          h('span', { class: 'chips' }, sp.buckets.map((b) => h('span', { class: 'chip static' }, b.name))),
        ),
      ),
    ),
    h('p', { class: 'muted small' }, `You’ll sort ${n} card${n === 1 ? '' : 's'}, one at a time.`),
  ];
}

function structureAssign() {
  const cards = cardOrder();
  const spine = getSpine(scenario, run.spine);
  if (!cards.length) {
    return [
      roundHead(3, 'Nothing to sort', 'You have no cards yet.'),
      actions(primary('Continue', () => update({ structureStage: 'review' }))),
    ];
  }
  const i = Math.min(run.cursor, cards.length - 1);
  const card = cards[i];
  const current = run.assignments[card.id];

  const assign = (bucket) => {
    const assignments = { ...run.assignments, [card.id]: bucket };
    if (i + 1 >= cards.length) update({ assignments, structureStage: 'review' }, { top: true });
    else update({ assignments, cursor: i + 1 });
  };
  const chip = (id, name, cls = '') =>
    h('button', { class: `chip ${cls}${current === id ? ' selected' : ''}`, 'aria-pressed': String(current === id), onclick: () => assign(id) }, name);

  return [
    h(
      'div',
      { class: 'round-head compact' },
      h('p', { class: 'eyebrow' }, `Round 3 · ${spine.name}`),
      h('div', { class: 'progress' }, h('span', { style: `width:${(100 * i) / cards.length}%` })),
      h('p', { class: 'muted small' }, `Card ${i + 1} of ${cards.length}`),
    ),
    h('div', { class: 'card sort-card', 'aria-live': 'polite' }, h('p', null, card.text)),
    h('p', { class: 'prompt' }, 'Which branch does this belong to?'),
    h('div', { class: 'chips buckets' }, spine.buckets.map((b) => chip(b.id, b.name))),
    h('div', { class: 'chips special' }, SPECIAL_BUCKETS.map((b) => chip(b, SPECIAL_BUCKET_NAMES[b], 'subtle'))),
    h(
      'div',
      { class: 'row-between' },
      h('button', { class: 'link', disabled: i === 0, onclick: () => update({ cursor: i - 1 }) }, '← Back'),
      h(
        'button',
        { class: 'link', onclick: () => (i + 1 >= cards.length ? update({ structureStage: 'review' }, { top: true }) : update({ cursor: i + 1 })) },
        'Skip →',
      ),
      h('button', { class: 'link', onclick: () => update({ structureStage: 'review' }, { top: true }) }, 'Review tree'),
    ),
  ];
}

function structureReview() {
  const spine = getSpine(scenario, run.spine);
  const cards = cardOrder();
  const orphans = cards.filter((c) => run.assignments[c.id] == null);
  const groups = [
    ...(orphans.length ? [{ id: '__none', name: 'Unassigned', cards: orphans, warn: true }] : []),
    ...[...spine.buckets, ...SPECIAL_BUCKETS.map((id) => ({ id, name: SPECIAL_BUCKET_NAMES[id], special: true }))].map((b) => ({
      ...b,
      cards: cards.filter((c) => run.assignments[c.id] === b.id),
    })),
  ];

  const move = (cardId, bucket) => {
    ui.moving = null;
    update({ assignments: { ...run.assignments, [cardId]: bucket } });
  };

  const changeSpine = () => {
    if (Object.keys(run.assignments).length && !confirm('Changing spine clears your card assignments.')) return;
    update({ structureStage: 'spine', spine: null, assignments: {}, cursor: 0, priority: [] }, { top: true });
  };

  return [
    roundHead(3, 'Your tree', 'Tap a branch to open it. Tap a card to move it.'),
    h(
      'div',
      { class: 'tree' },
      h('div', { class: 'tree-root' }, h('span', { class: 'muted small' }, 'Spine'), h('strong', null, spine.name), h('button', { class: 'link', onclick: changeSpine }, 'Change')),
      groups.map((g) => treeBranch(g, { expandable: true, renderCard: (c) => movableCard(c, spine, move) })),
    ),
    orphans.length > 0 && h('p', { class: 'warn-text' }, `${orphans.length} card${orphans.length === 1 ? ' is' : 's are'} unassigned and will count against MECE.`),
    actions(
      primary('Next · Prioritize', () => update({ round: 'prioritize' })),
      secondary('Re-sort from first card', () => update({ structureStage: 'assign', cursor: 0 })),
    ),
  ];
}

function treeBranch(g, { renderCard, key = 'open' }) {
  const open = ui[key] === g.id;
  return h(
    'div',
    { class: `branch${g.special ? ' special' : ''}${g.warn ? ' warn' : ''}${open ? ' open' : ''}` },
    h(
      'button',
      { class: 'branch-head', 'aria-expanded': String(open), onclick: () => ((ui[key] = open ? null : g.id), render()) },
      h('span', { class: 'caret', 'aria-hidden': 'true' }, open ? '▾' : '▸'),
      h('span', { class: 'branch-name' }, g.name),
      g.extra,
      h('span', { class: `count${g.cards.length ? '' : ' empty'}` }, g.cards.length || 'empty'),
    ),
    open && h('ul', { class: 'branch-cards' }, g.cards.length ? g.cards.map(renderCard) : h('li', { class: 'muted small' }, 'Nothing here yet.')),
  );
}

function movableCard(c, spine, move) {
  const moving = ui.moving === c.id;
  return h(
    'li',
    { class: `leaf${moving ? ' moving' : ''}` },
    h('button', { class: 'leaf-text', onclick: () => ((ui.moving = moving ? null : c.id), render()) }, c.text),
    moving &&
      h(
        'div',
        { class: 'chips mini' },
        [...spine.buckets, ...SPECIAL_BUCKETS.map((id) => ({ id, name: SPECIAL_BUCKET_NAMES[id] }))].map((b) =>
          h('button', { class: `chip${run.assignments[c.id] === b.id ? ' selected' : ''}`, onclick: () => move(c.id, b.id) }, b.name),
        ),
      ),
  );
}

// ---------- round 4: prioritize ----------

function renderPrioritize() {
  const spine = getSpine(scenario, run.spine);
  const cards = cardOrder();
  const toggle = (id) => {
    const p = run.priority.includes(id) ? run.priority.filter((x) => x !== id) : [...run.priority, id];
    update({ priority: p });
  };
  const done = run.priority.length === spine.buckets.length;
  const finish = () => {
    const result = scoreRun(scenario, run);
    recordFinish(run.date, scenario.id, result.overall);
    update({ round: 'debrief', finished: true });
  };

  return h(
    'main',
    { class: 'game' },
    contextPanel(),
    h(
      'section',
      { class: 'play' },
      roundHead(4, 'What do you dig into first?', 'Tap branches in the order you’d investigate them. Tap again to undo.'),
      h(
        'div',
        { class: 'rank-list' },
        spine.buckets.map((b) => {
          const pos = run.priority.indexOf(b.id);
          const inside = cards.filter((c) => run.assignments[c.id] === b.id);
          return h(
            'button',
            { class: `rank${pos >= 0 ? ' ranked' : ''}`, 'aria-pressed': String(pos >= 0), onclick: () => toggle(b.id) },
            h('span', { class: 'rank-num', 'aria-hidden': 'true' }, pos >= 0 ? pos + 1 : ''),
            h(
              'span',
              { class: 'rank-body' },
              h('strong', null, b.name),
              h('span', { class: 'muted small' }, inside.length ? inside.map((c) => c.text).join(' · ') : 'No cards'),
            ),
          );
        }),
      ),
      actions(
        primary('See debrief', finish, !done),
        run.priority.length > 0 && secondary('Reset order', () => update({ priority: [] })),
      ),
    ),
  );
}

// ---------- round 5: debrief ----------

function shareUrl(result) {
  const grid = buildGrid(scenario, run, result);
  const payload = encodeResult({ scenarioId: scenario.id, date: run.date, overall: result.overall, grid });
  return { grid, url: `${location.origin}${location.pathname}#r=${payload}` };
}

function categoryNote(key, cat, result) {
  switch (key) {
    case 'reframe':
      return cat.choice?.is_best ? 'You picked the strongest framing.' : `Your pick: ${(cat.choice?.flaw_tags || []).map((t) => FLAW_LABELS[t].toLowerCase()).join(', ')}.`;
    case 'coverage': {
      const locked = cat.items.filter((i) => i.status === 'locked').length;
      const base = `${fmt(cat.got)} of ${fmt(cat.total)} points of the drop explained by cards you filed correctly.`;
      return locked ? `${base} ${locked} driver${locked === 1 ? ' was' : 's were'} never surfaced by your questions.` : base;
    }
    case 'mece': {
      const bits = [];
      if (cat.orphans.length) bits.push(`${cat.orphans.length} unassigned card${cat.orphans.length === 1 ? '' : 's'}`);
      if (cat.emptyBuckets.length) bits.push(`${cat.emptyBuckets.length} empty branch${cat.emptyBuckets.length === 1 ? '' : 'es'}`);
      return bits.length ? `Gaps: ${bits.join(', ')}.` : 'Every card placed once, every branch used.';
    }
    case 'noise':
      return cat.items.length
        ? `${cat.items.length} non-driver${cat.items.length === 1 ? '' : 's'} treated as a driver${cat.items.some((i) => i.debunked) ? ', including one you had evidence against' : ''}.`
        : 'No red herrings or untested assumptions treated as drivers.';
    case 'efficiency':
      return cat.asked ? `${cat.asked} question${cat.asked === 1 ? '' : 's'} asked; average value ${Math.round(cat.score)}%.` : 'No questions asked.';
    case 'priority':
      return `Your order compared with the senior analyst’s, pair by pair.`;
    case 'checks':
      return `${cat.items.filter((i) => i.passed).length} of ${cat.items.length} spine-independent checks.`;
    default:
      return '';
  }
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function renderDebrief() {
  const result = scoreRun(scenario, run);
  const { grid, url } = shareUrl(result);
  const grade = gradeLabel(result.overall);
  const text = shareText({ title: scenario.title, date: run.date, overall: result.overall, grade, grid }, url);

  const share = async (btn) => {
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied!';
    } catch {
      prompt('Copy your result:', text);
    }
  };

  const playAgain = () => {
    if (!confirm('Replay this scenario? Your streak keeps your first score.')) return;
    clearRun(scenario.id, today);
    run = newRun();
    saveRun(run);
    go('game');
  };

  const shareBtn = h('button', { class: 'btn primary', onclick: (e) => share(e.currentTarget) }, 'Share result');

  return h(
    'main',
    { class: 'single debrief' },
    h('p', { class: 'eyebrow' }, 'Round 5 · Debrief'),
    h(
      'div',
      { class: 'debrief-top' },
      shareCard({ title: scenario.title, date: run.date, overall: result.overall, grade, grid }),
      h('div', { class: 'stack' }, shareBtn, h('p', { class: 'headline' }, scenario.debrief.headline)),
    ),

    section(
      'How you scored',
      h(
        'ul',
        { class: 'scores' },
        Object.keys(WEIGHTS).map((k) => {
          const cat = result.categories[k];
          return h(
            'li',
            null,
            h('div', { class: 'score-row' }, h('span', null, CATEGORY_LABELS[k]), h('strong', null, cat.score), h('span', { class: 'muted small' }, `× ${WEIGHTS[k]}%`)),
            h('div', { class: 'bar' }, h('span', { style: `width:${cat.score}%`, class: cat.score >= 80 ? 'good' : cat.score >= 50 ? 'mid' : 'low' })),
            h('p', { class: 'muted small' }, categoryNote(k, cat, result)),
          );
        }),
      ),
    ),

    section('Your tree vs. other valid trees', debriefTrees(result)),

    section(
      'What actually happened',
      scenario.debrief.narrative.map((p) => h('p', null, p)),
      breakdownChart(),
    ),

    section(
      'What a senior analyst would do',
      h('ol', { class: 'senior' }, scenario.debrief.senior_analyst.map((s) => h('li', null, s))),
      scenario.debrief.thursday_line && h('blockquote', { class: 'thursday' }, h('span', { class: 'label' }, 'The Thursday line'), scenario.debrief.thursday_line),
    ),

    section('Investigation order', priorityCompare(result)),

    section('Your questions', questionReview(result)),

    section(
      'Your reframe',
      h(
        'p',
        null,
        result.categories.reframe.choice?.is_best ? '✓ ' : '✗ ',
        result.categories.reframe.choice?.text ?? 'No option picked.',
      ),
      !result.categories.reframe.choice?.is_best && h('p', { class: 'muted' }, 'Best: ', result.categories.reframe.best.text),
      reframeFeedback(gradeReframe(run.reframeText)),
    ),

    actions(secondary('Play again', playAgain), secondary('Home', () => go('home'))),
  );
}

function section(title, ...children) {
  return h('section', { class: 'card section' }, h('h2', null, title), ...children);
}

function shareCard({ title, date, overall, grade, grid }) {
  return h(
    'div',
    { class: 'share-card', role: 'img', 'aria-label': `Score ${overall} out of 100, ${grade}` },
    h('div', { class: 'share-brand' }, logo(), 'LAMINAR'),
    h('div', { class: 'share-date' }, date),
    title && h('div', { class: 'share-title' }, title),
    h('div', { class: 'share-score' }, h('strong', null, overall), h('span', null, '/100')),
    h('div', { class: 'share-grade' }, grade),
    h(
      'div',
      { class: 'share-grid' },
      grid.map((row, i) => h('div', { class: 'share-row' }, h('span', null, ROW_LABELS[i]), h('span', { class: 'emoji' }, gridToEmoji(row) || '—'))),
    ),
  );
}

function statusIcon(status) {
  const map = { correct: ['✓', 'good'], partial: ['~', 'mid'], wrong: ['✗', 'low'], unplaced: ['○', 'low'] };
  const [glyph, cls] = map[status] ?? ['', ''];
  return h('span', { class: `status ${cls}`, 'aria-label': status }, glyph);
}

function debriefTrees(result) {
  const tab = ui.tab ?? 'yours';
  const tabs = [{ id: 'yours', name: 'Your tree' }, ...scenario.spines.map((s) => ({ id: s.id, name: s.name }))];
  const content = tab === 'yours' ? yourTree() : answerTree(tab);
  return [
    h(
      'div',
      { class: 'tabs', role: 'tablist' },
      tabs.map((t) =>
        h(
          'button',
          { role: 'tab', 'aria-selected': String(tab === t.id), class: tab === t.id ? 'active' : '', onclick: () => ((ui.tab = t.id), (ui.dbranch = null), render()) },
          t.name,
          t.id === run.spine && tab !== 'yours' ? ' ★' : '',
        ),
      ),
    ),
    content,
  ];
}

function yourTree() {
  const spine = getSpine(scenario, run.spine);
  const cards = cardOrder();
  const hidden = scenario.components.filter((c) => !isUnlocked(c, run.asked));
  const leaf = (c) => {
    const st = placementStatus(c, run.spine, run.assignments[c.id]);
    const answer = acceptedBuckets(c, run.spine).map((b) => bucketName(run.spine, b));
    return h(
      'li',
      { class: 'leaf' },
      h('div', { class: 'leaf-line' }, statusIcon(st), h('span', null, c.text)),
      h(
        'div',
        { class: 'leaf-meta' },
        h('span', { class: `tag type-${c.type}` }, TYPE_LABELS[c.type]),
        c.type === 'driver' && h('span', { class: 'muted small' }, `≈${fmt(c.weight)} pts`),
        st !== 'correct' && h('span', { class: 'muted small' }, `Answer: ${answer.join(' or ')}`),
      ),
    );
  };
  const groups = [
    ...[...spine.buckets, ...SPECIAL_BUCKETS.map((id) => ({ id, name: SPECIAL_BUCKET_NAMES[id], special: true }))].map((b) => ({
      ...b,
      cards: cards.filter((c) => run.assignments[c.id] === b.id),
    })),
  ];
  const orphans = cards.filter((c) => run.assignments[c.id] == null);
  if (orphans.length) groups.unshift({ id: '__none', name: 'Unassigned', warn: true, cards: orphans });
  return h(
    'div',
    { class: 'tree' },
    h('div', { class: 'tree-root' }, h('span', { class: 'muted small' }, 'Your spine'), h('strong', null, spine.name)),
    groups.map((g) => treeBranch(g, { key: 'dbranch', renderCard: leaf })),
    hidden.length > 0 &&
      treeBranch(
        { id: '__hidden', name: 'Never surfaced', special: true, cards: hidden },
        {
          key: 'dbranch',
          renderCard: (c) =>
            h(
              'li',
              { class: 'leaf locked' },
              h('div', { class: 'leaf-line' }, h('span', { class: 'status' }, '🔒'), h('span', null, c.text)),
              h(
                'div',
                { class: 'leaf-meta' },
                h('span', { class: `tag type-${c.type}` }, TYPE_LABELS[c.type]),
                h('span', { class: 'muted small' }, `Ask: “${question([c.unlocked_by].flat()[0]).text}”`),
              ),
            ),
        },
      ),
  );
}

function answerTree(spineId) {
  const spine = getSpine(scenario, spineId);
  const leaf = (c) => {
    const alts = acceptedBuckets(c, spineId).slice(1).map((b) => bucketName(spineId, b));
    return h(
      'li',
      { class: `leaf${isUnlocked(c, run.asked) ? '' : ' locked'}` },
      h('div', { class: 'leaf-line' }, h('span', null, c.text)),
      h(
        'div',
        { class: 'leaf-meta' },
        h('span', { class: `tag type-${c.type}` }, TYPE_LABELS[c.type]),
        c.type === 'driver' && h('span', { class: 'muted small' }, `≈${fmt(c.weight)} pts`),
        alts.length > 0 && h('span', { class: 'muted small' }, `Also OK: ${alts.join(', ')}`),
        !isUnlocked(c, run.asked) && h('span', { class: 'muted small' }, '🔒 you didn’t surface this'),
      ),
    );
  };
  const order = expectedBucketOrder(scenario, spineId).map((e) => e.id);
  const groups = [
    ...order.map((id) => spine.buckets.find((b) => b.id === id)),
    ...SPECIAL_BUCKETS.map((id) => ({ id, name: SPECIAL_BUCKET_NAMES[id], special: true })),
  ].map((b) => {
    const cards = scenario.components
      .filter((c) => acceptedBuckets(c, spineId)[0] === b.id)
      .sort((a, z) => (z.weight ?? 0) - (a.weight ?? 0));
    const pts = cards.reduce((s, c) => s + (c.type === 'driver' ? c.weight : 0), 0);
    return { ...b, cards, extra: pts ? h('span', { class: 'pts' }, `≈${fmt(pts)} pts`) : null };
  });
  return h(
    'div',
    { class: 'tree' },
    h('div', { class: 'tree-root' }, h('span', { class: 'muted small' }, 'Answer key'), h('strong', null, spine.name), h('span', { class: 'muted small' }, spine.blurb)),
    groups.map((g) => treeBranch(g, { key: 'dbranch', renderCard: leaf })),
  );
}

function breakdownChart() {
  const items = scenario.debrief.breakdown;
  const total = items.reduce((s, b) => s + b.pts, 0);
  return h(
    'div',
    { class: 'breakdown', role: 'img', 'aria-label': items.map((b) => `${b.label} ${b.pts} points`).join(', ') },
    h('div', { class: 'stacked' }, items.map((b, i) => h('span', { class: `seg s${i}`, style: `flex:${b.pts}`, title: `${b.label}: ${b.pts} pts` }))),
    h(
      'ul',
      { class: 'legend' },
      items.map((b, i) => h('li', null, h('span', { class: `swatch s${i}` }), h('span', null, b.label), h('strong', null, `${fmt(b.pts)} pt${b.pts === 1 ? '' : 's'}`))),
    ),
    h('p', { class: 'muted small' }, `${fmt(total)} points of decline in total.`),
  );
}

function priorityCompare(result) {
  const cat = result.categories.priority;
  const key = scenario.priority_key;
  return [
    h(
      'div',
      { class: 'compare' },
      h('div', null, h('h3', null, 'Yours'), h('ol', null, cat.order.map((id) => h('li', null, bucketName(run.spine, id))))),
      h('div', null, h('h3', null, 'Senior'), h('ol', null, cat.expected.map((id) => h('li', null, bucketName(run.spine, id))))),
    ),
    h('ol', { class: 'rationale' }, key.map((k) => h('li', null, h('strong', null, component(k.id)?.text ?? k.id), h('span', { class: 'muted' }, ` — ${k.rationale}`)))),
  ];
}

function questionReview(result) {
  const asked = run.asked.map(question);
  const missed = scenario.questions.filter((q) => !run.asked.includes(q.id) && (q.value === 'high' || q.value === 'med'));
  const qItem = (q) => h('li', null, h('span', { class: `tag value-${q.value}` }, VALUE_LABELS[q.value]), ' ', q.text);
  return [
    asked.length ? h('ul', { class: 'qlist' }, asked.map(qItem)) : h('p', { class: 'muted' }, 'You didn’t ask anything.'),
    missed.length > 0 && [h('h3', null, 'Worth asking next time'), h('ul', { class: 'qlist' }, missed.map(qItem))],
    h('h3', null, 'Checks'),
    h(
      'ul',
      { class: 'checks' },
      result.categories.checks.items.map((c) =>
        h('li', { class: c.passed ? 'good' : 'flag' }, h('strong', null, `${c.passed ? '✓' : '✗'} ${c.label}`), h('span', { class: 'muted small' }, c.why)),
      ),
    ),
  ];
}

// ---------- shared result (from URL hash) ----------

function renderShared() {
  const title = shared.scenarioId === scenario.id ? scenario.title : '';
  return h(
    'main',
    { class: 'single shared' },
    h('p', { class: 'eyebrow' }, 'A friend’s result'),
    shareCard({ title, date: shared.date, overall: shared.overall, grade: gradeLabel(shared.overall), grid: shared.grid }),
    actions(
      primary('Play today’s Laminar', () => {
        history.replaceState(null, '', location.pathname + location.search);
        shared = null;
        go('home');
      }),
    ),
  );
}

// ---------- render loop ----------

function render() {
  let screen;
  if (view === 'shared' && shared) screen = renderShared();
  else if (view === 'game' && run) {
    screen = {
      brief: renderBrief,
      reframe: renderReframe,
      ask: renderAsk,
      structure: renderStructure,
      prioritize: renderPrioritize,
      debrief: renderDebrief,
    }[run.round]();
  } else screen = renderHome();
  app.replaceChildren(topbar(), screen);
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function boot() {
  today = dateKey();
  try {
    const index = await fetchJSON('scenarios/index.json');
    const requested = new URLSearchParams(location.search).get('s');
    const id = requested && index.scenarios.includes(requested) ? requested : dailyScenarioId(index.scenarios, today);
    scenario = await fetchJSON(`scenarios/${id}.json`);
  } catch (e) {
    app.replaceChildren(h('main', { class: 'single' }, h('h1', null, 'Couldn’t load today’s scenario'), h('p', { class: 'muted' }, String(e.message))));
    return;
  }
  run = loadRun(scenario.id, today);
  const r = new URLSearchParams(location.hash.slice(1)).get('r');
  shared = r ? decodeResult(r) : null;
  view = shared ? 'shared' : 'home';
  render();
}

window.addEventListener('hashchange', () => {
  const r = new URLSearchParams(location.hash.slice(1)).get('r');
  shared = r ? decodeResult(r) : null;
  if (shared) go('shared');
});

boot();
