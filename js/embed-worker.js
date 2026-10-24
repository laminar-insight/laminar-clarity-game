// Web Worker that loads a quantized sentence-embedding model with
// Transformers.js, so downloading and inference never block the UI thread.
// Transformers.js caches the model files in the browser Cache API, so the
// ~23 MB download happens once per device.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

env.allowLocalModels = false;

let extractor = null;

self.onmessage = async ({ data }) => {
  if (data.type === 'load') {
    try {
      extractor = await pipeline('feature-extraction', data.model, {
        dtype: 'q8',
        progress_callback: (p) => {
          if (p.status === 'progress') self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
        },
      });
      self.postMessage({ type: 'ready' });
    } catch (e) {
      self.postMessage({ type: 'error', message: String(e?.message || e) });
    }
  } else if (data.type === 'embed') {
    try {
      const out = await extractor(data.texts, { pooling: 'mean', normalize: true });
      self.postMessage({ type: 'embeddings', id: data.id, vectors: out.tolist() });
    } catch (e) {
      self.postMessage({ type: 'embed-error', id: data.id, message: String(e?.message || e) });
    }
  }
};
