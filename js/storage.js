// localStorage persistence: in-progress runs (so dropped sessions resume)
// and progress/streaks. Every access is guarded — storage can be missing or
// throw in private windows, and the game must still work without it.

const PREFIX = 'laminar:v1:';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable — play continues unsaved */
  }
}

function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** Local calendar date as YYYY-MM-DD. */
export function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Whole days since 1970-01-01 for a YYYY-MM-DD key (timezone-independent). */
export function dayNumber(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** Pick the daily scenario id by date index. */
export function dailyScenarioId(ids, key = dateKey()) {
  return ids[((dayNumber(key) % ids.length) + ids.length) % ids.length];
}

const runKey = (scenarioId, date) => `run:${scenarioId}:${date}`;

export const loadRun = (scenarioId, date) => read(runKey(scenarioId, date), null);
export const saveRun = (run) => write(runKey(run.scenarioId, run.date), run);
export const clearRun = (scenarioId, date) => remove(runKey(scenarioId, date));

export function loadProgress() {
  return read('progress', { days: {} });
}

/** Record a finished daily run. Only the first finish of a day counts. */
export function recordFinish(date, scenarioId, overall) {
  const p = loadProgress();
  if (!p.days[date]) {
    p.days[date] = { scenarioId, overall };
    write('progress', p);
  }
  return p;
}

/** Consecutive played days ending today (or yesterday, if today isn't played yet). */
export function computeStreak(progress, today = dateKey()) {
  const played = new Set(Object.keys(progress.days).map(dayNumber));
  let n = dayNumber(today);
  if (!played.has(n)) n -= 1;
  let streak = 0;
  while (played.has(n)) {
    streak++;
    n--;
  }
  return streak;
}

export function computeStats(progress, today = dateKey()) {
  const scores = Object.values(progress.days).map((d) => d.overall);
  return {
    played: scores.length,
    streak: computeStreak(progress, today),
    best: scores.length ? Math.max(...scores) : null,
  };
}
