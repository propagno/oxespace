import { parentPort, workerData } from 'node:worker_threads'
import { pipeline, env } from '@xenova/transformers'
import { SEMANTIC_MODEL_ID } from '../services/semantic-model'

// Prefer the model bundled with the app (localModelPath) so semantic search
// works fully OFFLINE / on locked-down corporate networks — no huggingface.co
// fetch at runtime (which fails with "fetch failed" when egress is blocked).
// The bundled layout is <localModelPath>/<owner>/<model>/… (see
// scripts/fetch-semantic-model.mjs + electron-builder extraResources).
if (workerData?.localModelPath) {
  env.localModelPath = workerData.localModelPath
  env.allowLocalModels = true
}
// Cache for any remote download in a writable location (the bundle is read-only
// in a packaged build). Remote stays enabled only as a FALLBACK — used in dev
// when the model wasn't pre-fetched, or to self-heal a missing bundle.
if (workerData?.cacheDir) {
  env.cacheDir = workerData.cacheDir
}
env.allowRemoteModels = true

// Worker to generate embeddings
class SemanticWorker {
  private extractor: any = null;

  constructor() {
    if (parentPort) {
      parentPort.on('message', async (message) => {
        if (message.type === 'init') {
          await this.init();
        } else if (message.type === 'embed') {
          await this.embed(message.id, message.text);
        }
      });
    }
  }

  async init() {
    try {
      // Multilingual embedding model (id centralised in semantic-model.ts).
      this.extractor = await pipeline('feature-extraction', SEMANTIC_MODEL_ID, {
        quantized: true,
      });
      parentPort?.postMessage({ type: 'ready' });
    } catch (err) {
      parentPort?.postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  async embed(id: string, text: string) {
    if (!this.extractor) {
      parentPort?.postMessage({ type: 'error', id, error: 'Model not initialized' });
      return;
    }

    try {
      // Generate embeddings
      const output = await this.extractor(text, { pooling: 'mean', normalize: true });
      const embedding = Array.from(output.data);
      parentPort?.postMessage({ type: 'result', id, embedding });
    } catch (err) {
      parentPort?.postMessage({ type: 'error', id, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

new SemanticWorker();
