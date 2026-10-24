// Main-thread client for js/embed-worker.js. load() is idempotent and starts
// the background download; embed() waits a bounded time for the model, so a
// slow or blocked download falls back to keyword grading instead of stalling.

export const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

let worker = null;
let readyPromise = null;
let nextId = 1;
const pending = new Map();
const listeners = new Set();
let state = { status: 'idle', progress: 0, error: null }; // idle | loading | ready | error

function set(patch) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(state);
}

export const getState = () => state;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function fail(message) {
  set({ status: 'error', error: message });
  for (const p of pending.values()) p.reject(new Error(message));
  pending.clear();
}

export function load() {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((resolve, reject) => {
    try {
      worker = new Worker(new URL('./embed-worker.js', import.meta.url), { type: 'module' });
    } catch (e) {
      fail(String(e?.message || e));
      reject(e);
      return;
    }
    const files = {};
    worker.onmessage = ({ data }) => {
      switch (data.type) {
        case 'progress': {
          files[data.file] = data;
          const all = Object.values(files);
          const total = all.reduce((s, f) => s + (f.total || 0), 0);
          const loaded = all.reduce((s, f) => s + (f.loaded || 0), 0);
          set({ status: 'loading', progress: total ? loaded / total : 0 });
          break;
        }
        case 'ready':
          set({ status: 'ready', progress: 1 });
          resolve();
          break;
        case 'error':
          fail(data.message);
          reject(new Error(data.message));
          break;
        case 'embeddings':
          pending.get(data.id)?.resolve(data.vectors);
          pending.delete(data.id);
          break;
        case 'embed-error':
          pending.get(data.id)?.reject(new Error(data.message));
          pending.delete(data.id);
          break;
      }
    };
    // Fires if the worker script or its CDN import can't load.
    worker.onerror = (e) => {
      e.preventDefault?.();
      const message = e.message || 'Embedding worker failed to start';
      fail(message);
      reject(new Error(message));
    };
    set({ status: 'loading', progress: 0 });
    worker.postMessage({ type: 'load', model: MODEL_ID });
  });
  readyPromise.catch(() => {});
  return readyPromise;
}

function withTimeout(promise, ms, label) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms))]);
}

/** Embed texts; waits at most `waitMs` for the model to finish loading. */
export async function embed(texts, { waitMs = 4000, runMs = 10000 } = {}) {
  await withTimeout(load(), waitMs, 'Model load');
  return withTimeout(
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'embed', id, texts });
    }),
    runMs,
    'Embedding',
  );
}
