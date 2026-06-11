#!/usr/bin/env node
/**
 * Fetch the semantic embedding model into resources/models so it can be bundled
 * with the app (electron-builder extraResources) and loaded OFFLINE at runtime.
 *
 * Why: transformers.js downloads the model from huggingface.co on first run.
 * On locked-down/corporate networks that fetch fails ("Model failed to load:
 * fetch failed") and semantic search never starts. Bundling the model removes
 * the runtime download entirely.
 *
 * Runs on the BUILD machine (needs internet) before electron-builder. The output
 * layout (<resources/models>/<owner>/<model>/…) matches transformers.js's
 * `localModelPath` lookup, so the worker finds it with no network — see
 * electron/main/workers/semantic-worker.ts.
 *
 * Keep MODEL_ID in sync with SEMANTIC_MODEL_ID in
 * electron/main/services/semantic-model.ts.
 *
 * Usage:  node scripts/fetch-semantic-model.mjs
 *         npm run prepare:model
 */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODEL_ID = 'Xenova/multilingual-e5-small'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const MODELS_DIR = join(ROOT, 'resources', 'models')
const marker = join(MODELS_DIR, ...MODEL_ID.split('/'), 'config.json')

if (existsSync(marker)) {
  process.stdout.write(`[fetch-model] ${MODEL_ID} already present in resources/models — skipping.\n`)
  process.exit(0)
}

mkdirSync(MODELS_DIR, { recursive: true })
process.stdout.write(`[fetch-model] downloading ${MODEL_ID} (quantized) into resources/models …\n`)

const { pipeline, env } = await import('@xenova/transformers')
// Download into resources/models with the same <owner>/<model> layout the app's
// localModelPath expects at runtime.
env.cacheDir = MODELS_DIR
env.allowRemoteModels = true
env.allowLocalModels = false // force a real download, don't read a stale local copy

try {
  await pipeline('feature-extraction', MODEL_ID, { quantized: true })
} catch (err) {
  process.stderr.write(`[fetch-model] FAILED: ${err instanceof Error ? err.message : String(err)}\n`)
  process.stderr.write('[fetch-model] The build machine needs internet access to huggingface.co.\n')
  process.exit(1)
}

if (!existsSync(marker)) {
  process.stderr.write('[fetch-model] download completed but expected files are missing.\n')
  process.exit(1)
}
process.stdout.write(`[fetch-model] done → ${join('resources', 'models', ...MODEL_ID.split('/'))}\n`)
