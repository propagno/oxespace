import { parentPort, workerData } from 'node:worker_threads'
import { pipeline, env } from '@xenova/transformers'

// Cache downloaded model weights in a writable location (passed from the main
// process). Without this, a packaged build tries to write into the read-only
// asar and the model never loads. Remote download stays enabled so the first
// run can fetch the ~30MB MiniLM model into the cache.
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
      // Use the lightweight MiniLM model
      this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
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
