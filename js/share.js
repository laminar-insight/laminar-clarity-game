// Wordle-style share grid and URL-hash encoding of a result.
import { expectedBucketOrder } from './scoring.js';

const EMOJI = { g: '🟩', y: '🟨', r: '🟥', w: '⬜', b: '⬛' };
const VALUE_CODE = { high: 'g', med: 'y', low: 'w', noise: 'r' };
const DRIVER_CODE = { correct: 'g', partial: 'y', wrong: 'r', unplaced: 'b', locked: 'b' };

export const ROW_LABELS = ['Reframe', 'Ask', 'Build', 'Order'];

/** Compact grid rows as letter codes (g/y/r/w/b), one string per row. */
export function buildGrid(scenario, run, result) {
  const reframe = result.categories.reframe.score === 100 ? 'g' : 'r';
  const ask = run.asked.map((id) => VALUE_CODE[scenario.questions.find((q) => q.id === id)?.value] ?? 'w').join('');
  const build = result.categories.coverage.items.map((i) => DRIVER_CODE[i.status]).join('');
  const expected = expectedBucketOrder(scenario, run.spine);
  const rankOf = Object.fromEntries(expected.map((e) => [e.id, e.rank]));
  const sortedRanks = expected.map((e) => e.rank);
  const order = result.categories.priority.order
    .map((id, i) => (rankOf[id] === sortedRanks[i] ? 'g' : 'y'))
    .join('');
  return [reframe, ask, build, order];
}

export const gridToEmoji = (row) => [...row].map((c) => EMOJI[c] ?? '').join('');

export function shareText({ title, date, overall, grade, grid }, url) {
  const rows = grid.map((row, i) => `${ROW_LABELS[i].padEnd(8, ' ')}${gridToEmoji(row)}`);
  return [`Laminar ${date} · ${overall}/100 ${grade}`, title, '', ...rows, '', url].join('\n');
}

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Encode a result summary for the URL hash. */
export function encodeResult({ scenarioId, date, overall, grid }) {
  return toBase64Url(JSON.stringify({ v: 1, s: scenarioId, d: date, o: overall, g: grid }));
}

/** Decode a hash payload; returns null if it's malformed. */
export function decodeResult(payload) {
  try {
    const o = JSON.parse(fromBase64Url(payload));
    if (o.v !== 1 || typeof o.s !== 'string' || !Array.isArray(o.g)) return null;
    const grid = o.g.slice(0, ROW_LABELS.length).map((r) => String(r).replace(/[^gyrwb]/g, '').slice(0, 12));
    return { scenarioId: o.s, date: String(o.d).slice(0, 10), overall: Math.max(0, Math.min(100, Number(o.o) | 0)), grid };
  } catch {
    return null;
  }
}
