#!/usr/bin/env node
// Validates every scenario listed in scenarios/index.json.
// Usage: node scripts/validate.mjs [path/to/scenario.json ...]
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SPECIAL_BUCKETS, COMPONENT_TYPES, QUESTION_VALUES, FLAW_TAGS } from '../js/scoring.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Returns { errors: string[], warnings: string[] } for one scenario object. */
export function validateScenario(s) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  for (const key of ['id', 'archetype', 'domain', 'title', 'ask', 'reframe_options', 'questions', 'components', 'spines', 'global_checks', 'priority_key', 'debrief']) {
    if (s[key] == null) err(`missing top-level field "${key}"`);
  }
  if (errors.length) return { errors, warnings };

  const dupes = (list, label) => {
    const seen = new Set();
    for (const x of list) {
      if (seen.has(x.id)) err(`duplicate ${label} id "${x.id}"`);
      seen.add(x.id);
    }
    return seen;
  };

  // Ask
  if (!s.ask.sender?.name) err('ask.sender.name is required');
  if (!toList(s.ask.messages).length) err('ask.messages must be a non-empty list');

  // Reframe
  dupes(s.reframe_options, 'reframe option');
  const nBest = s.reframe_options.filter((o) => o.is_best).length;
  if (nBest !== 1) err(`reframe_options must have exactly one is_best (found ${nBest})`);
  if (s.reframe_options.length < 4 || s.reframe_options.length > 5) warn(`reframe_options has ${s.reframe_options.length} options (brief: 4–5)`);
  for (const o of s.reframe_options) {
    if (!o.text) err(`reframe option "${o.id}" has no text`);
    if (!o.explanation) err(`reframe option "${o.id}" has no explanation`);
    for (const t of toList(o.flaw_tags)) if (!FLAW_TAGS.includes(t)) err(`reframe option "${o.id}" has unknown flaw tag "${t}"`);
    if (!o.is_best && !toList(o.flaw_tags).length) err(`wrong reframe option "${o.id}" has no flaw_tags`);
    if (o.is_best && toList(o.flaw_tags).length) err(`best reframe option "${o.id}" should not carry flaw_tags`);
  }
  if (!toList(s.reference_frames).length) warn('no reference_frames (needed for embedding grading)');
  for (const t of Object.keys(s.flaw_patterns ?? {})) if (!FLAW_TAGS.includes(t)) err(`flaw_patterns has unknown tag "${t}"`);

  // Questions
  const qIds = dupes(s.questions, 'question');
  const compIds = new Set(s.components.map((c) => c.id));
  for (const q of s.questions) {
    if (!q.text || !q.reveal) err(`question "${q.id}" needs text and reveal`);
    if (!QUESTION_VALUES.includes(q.value)) err(`question "${q.id}" has invalid value "${q.value}"`);
    for (const u of toList(q.unlocks)) {
      if (!compIds.has(u)) err(`question "${q.id}" unlocks unknown component "${u}"`);
    }
  }
  const budget = s.question_budget;
  if (!Number.isInteger(budget) || budget < 1) err('question_budget must be a positive integer');
  else if (budget >= s.questions.length) err(`question_budget (${budget}) must be less than the number of questions (${s.questions.length})`);

  // Spines
  const spineIds = dupes(s.spines, 'spine');
  if (s.spines.length < 2 || s.spines.length > 3) warn(`${s.spines.length} spines (brief: 2–3)`);
  const bucketsBySpine = {};
  for (const sp of s.spines) {
    const ids = new Set();
    for (const b of sp.buckets) {
      if (ids.has(b.id)) err(`spine "${sp.id}" has duplicate bucket "${b.id}"`);
      if (SPECIAL_BUCKETS.includes(b.id)) err(`spine "${sp.id}" bucket "${b.id}" collides with a reserved bucket`);
      ids.add(b.id);
    }
    if (sp.buckets.length < 2 || sp.buckets.length > 4) err(`spine "${sp.id}" has ${sp.buckets.length} buckets (mobile limit: 2–4)`);
    bucketsBySpine[sp.id] = ids;
  }

  // Components — the core check: every component maps to a valid bucket in every spine.
  dupes(s.components, 'component');
  if (s.components.length < 15 || s.components.length > 20) warn(`${s.components.length} components (brief: ~15–20)`);
  for (const c of s.components) {
    if (!c.text) err(`component "${c.id}" has no text`);
    if (!COMPONENT_TYPES.includes(c.type)) err(`component "${c.id}" has invalid type "${c.type}"`);
    if (c.type === 'driver' && !(c.weight > 0)) err(`driver "${c.id}" needs a positive weight`);
    if (c.type !== 'driver' && c.weight != null) warn(`non-driver "${c.id}" has a weight (ignored)`);

    for (const sp of s.spines) {
      const mapped = toList(c.buckets?.[sp.id]);
      if (!mapped.length) {
        err(`component "${c.id}" has no bucket for spine "${sp.id}"`);
        continue;
      }
      for (const b of mapped) {
        if (!bucketsBySpine[sp.id].has(b) && !SPECIAL_BUCKETS.includes(b)) {
          err(`component "${c.id}" maps to unknown bucket "${b}" in spine "${sp.id}"`);
        }
      }
      const real = mapped.some((b) => bucketsBySpine[sp.id].has(b));
      if ((c.type === 'driver' || c.type === 'evidence') && !real) err(`${c.type} "${c.id}" must map to a real bucket in spine "${sp.id}"`);
      if (!['driver', 'evidence'].includes(c.type) && real) err(`${c.type} "${c.id}" should map only to noise/ruled_out in spine "${sp.id}"`);
    }
    for (const k of Object.keys(c.buckets ?? {})) if (!spineIds.has(k)) err(`component "${c.id}" maps unknown spine "${k}"`);

    for (const q of toList(c.unlocked_by)) {
      if (!qIds.has(q)) err(`component "${c.id}" unlocked_by unknown question "${q}"`);
      else if (!toList(s.questions.find((x) => x.id === q).unlocks).includes(c.id)) {
        err(`component "${c.id}" is unlocked_by "${q}" but that question doesn't list it in unlocks`);
      }
    }
    for (const q of toList(c.debunked_by)) if (!qIds.has(q)) err(`component "${c.id}" debunked_by unknown question "${q}"`);
  }
  for (const q of s.questions) {
    for (const u of toList(q.unlocks)) {
      const c = s.components.find((x) => x.id === u);
      if (c && !toList(c.unlocked_by).includes(q.id)) err(`question "${q.id}" unlocks "${u}" but the component's unlocked_by doesn't name it`);
    }
  }
  // Every real bucket should be reachable by at least one driver or evidence card.
  for (const sp of s.spines) {
    for (const b of sp.buckets) {
      const hit = s.components.some((c) => ['driver', 'evidence'].includes(c.type) && toList(c.buckets[sp.id]).includes(b.id));
      if (!hit) warn(`spine "${sp.id}" bucket "${b.id}" has no driver/evidence mapped to it`);
    }
  }

  // Global checks
  dupes(s.global_checks, 'global check');
  for (const g of s.global_checks) {
    if (!toList(g.satisfied_by).length) err(`global check "${g.id}" has no satisfied_by questions`);
    for (const q of toList(g.satisfied_by)) if (!qIds.has(q)) err(`global check "${g.id}" references unknown question "${q}"`);
  }

  // Priority key
  const allBuckets = new Set(s.spines.flatMap((sp) => sp.buckets.map((b) => b.id)));
  for (const p of s.priority_key) {
    if (!compIds.has(p.id) && !allBuckets.has(p.id)) err(`priority_key references unknown id "${p.id}"`);
    if (!p.rationale) warn(`priority_key "${p.id}" has no rationale`);
  }

  // Debrief
  if (!toList(s.debrief.narrative).length) err('debrief.narrative is required');
  for (const b of toList(s.debrief.breakdown)) {
    for (const id of toList(b.components)) if (!compIds.has(id)) err(`debrief.breakdown "${b.label}" references unknown component "${id}"`);
  }

  return { errors, warnings };
}

async function main() {
  const args = process.argv.slice(2);
  let files = args;
  if (!files.length) {
    const index = JSON.parse(await readFile(path.join(ROOT, 'scenarios/index.json'), 'utf8'));
    files = index.scenarios.map((id) => path.join(ROOT, 'scenarios', `${id}.json`));
  }
  let failed = false;
  for (const f of files) {
    let s;
    try {
      s = JSON.parse(await readFile(f, 'utf8'));
    } catch (e) {
      console.error(`✗ ${path.relative(ROOT, f)}: ${e.message}`);
      failed = true;
      continue;
    }
    const { errors, warnings } = validateScenario(s);
    const expectedId = path.basename(f, '.json');
    if (!args.length && s.id !== expectedId) errors.push(`id "${s.id}" doesn't match file name "${expectedId}"`);
    const label = path.relative(ROOT, f);
    if (errors.length) {
      failed = true;
      console.error(`✗ ${label}`);
      for (const e of errors) console.error(`    error: ${e}`);
    } else {
      console.log(`✓ ${label} (${s.components.length} components, ${s.questions.length} questions, ${s.spines.length} spines)`);
    }
    for (const w of warnings) console.warn(`    warn:  ${w}`);
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
