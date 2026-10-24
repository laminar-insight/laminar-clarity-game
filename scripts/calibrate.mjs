#!/usr/bin/env node
// Prints how the embedding grader scores sample reframes, so the thresholds in
// js/semantic.js (or a scenario's "grading" object) can be tuned against the
// real model. Needs network access to huggingface.co and a one-off install:
//
//   npm i --no-save @huggingface/transformers@3.8.1
//   node scripts/calibrate.mjs [scenario-id] [extra sentence ...]
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildCorpus, corpusTexts, gradeSemantic, cosine } from '../js/semantic.js';
import { MODEL_ID } from '../js/embedder.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let transformers;
try {
  transformers = await import('@huggingface/transformers');
} catch {
  console.error('Missing dependency. Run: npm i --no-save @huggingface/transformers@3.8.1');
  process.exit(1);
}

const [id = 'membership-softer', ...extra] = process.argv.slice(2);
const scenario = JSON.parse(await readFile(path.join(ROOT, 'scenarios', `${id}.json`), 'utf8'));
const extractor = await transformers.pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' });
const embed = async (texts) => (await extractor(texts, { pooling: 'mean', normalize: true })).tolist();

const corpus = buildCorpus(scenario);
const corpusVecs = await embed(corpusTexts(corpus));

// Sample sentences: every MC option, plus a few typical player phrasings.
const samples = [
  ...scenario.reframe_options.map((o) => [o.is_best ? 'best' : o.flaw_tags.join(','), o.text]),
  ['player', 'Figure out whether renewal rate really dropped and what is driving it before Thursday'],
  ['player', 'Why did renewals go down this quarter?'],
  ['player', 'Find out why members are unhappy and leaving'],
  ['player', 'Build a model to predict which members will churn'],
  ['player', 'Make the member base feel stronger'],
  ['player', 'Pizza toppings ranked by popularity'],
  ...extra.map((t) => ['extra', t]),
];

const rows = [];
for (const [label, text] of samples) {
  const [v] = await embed([text]);
  const g = gradeSemantic([v, ...corpusVecs], corpus, scenario.grading);
  rows.push({ label, score: g.score, refSim: g.closest.sim, flaw: g.flaw ? `${g.flaw.tag} ${g.flaw.sim}` : '', text: text.slice(0, 60) });
}
console.table(rows);

// Leave-one-out view: how similar the references are to each other.
const refVecs = corpusVecs.slice(0, corpus.references.length);
const pair = [];
for (let i = 0; i < refVecs.length; i++) for (let j = i + 1; j < refVecs.length; j++) pair.push(cosine(refVecs[i], refVecs[j]));
console.log(`reference↔reference similarity: min ${Math.min(...pair).toFixed(3)}, max ${Math.max(...pair).toFixed(3)}`);
