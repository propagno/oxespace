import { parentPort, workerData } from 'node:worker_threads'
import { pipeline, env } from '@xenova/transformers'
import { SEMANTIC_MODEL_ID } from '../services/semantic-model'

// The model is optional and lives under userData (see semantic-model-store.ts):
// downloaded when the user turns the vector index on, or imported from a folder
// on networks without internet access. The download cache and the local model
// path are the same folder, laid out as <root>/<owner>/<model>/…, so a model
// fetched once loads offline from then on.
if (workerData?.modelRoot) {
  env.localModelPath = workerData.modelRoot
  env.cacheDir = workerData.modelRoot
  env.allowLocalModels = true
}
// Remote fetches happen only when the user asked for the download; a normal
// start never reaches huggingface.co.
env.allowRemoteModels = workerData?.allowRemote === true

// Worker to generate embeddings
class SemanticWorker {
  private extractor: ((text: string, options: { pooling: 'mean'; normalize: boolean }) => Promise<{ data: Iterable<number> }>) | null = null;

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
        progress_callback: (event: { status?: string; file?: string; loaded?: number; total?: number }) => {
          if (event.status === 'progress' && event.file) {
            parentPort?.postMessage({ type: 'progress', file: event.file, loaded: event.loaded ?? 0, total: event.total ?? 0 });
          }
        }
      }) as typeof this.extractor;
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
