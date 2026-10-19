import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { SEMANTIC_MODEL_ID } from './semantic-model'

/**
 * Files transformers.js reads to build the feature-extraction pipeline for the
 * quantized model. The layout under the store root mirrors the Hugging Face
 * repo (<owner>/<model>/<file>), which is both where transformers.js caches a
 * download and where it looks for local models, so a download and an import
 * land in the same place.
 */
export const SEMANTIC_MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'] as const

/** The quantized ONNX file is ~266 MB; anything this small is a truncated download. */
const MIN_ONNX_BYTES = 1024 * 1024

export interface SemanticIndexSettings {
  /** The user turned on the optional vector index in Settings › Agents. */
  vectorIndex: boolean
}

export interface SemanticUsageBucket {
  calls: number
  /** Calls that returned at least one result. */
  answered: number
  results: number
  estimatedTokens: number
}

/**
 * Local-only counters behind the 1.3 decision on the vector index: how often
 * agents call the retrieval tools, and how much they get back, split by whether
 * the vector index took part. Never sent anywhere.
 */
export interface SemanticUsage {
  since: number
  tools: Record<string, { withVector: SemanticUsageBucket; withoutVector: SemanticUsageBucket }>
}

const SETTINGS_FILE = 'semantic-index.json'
const USAGE_FILE = 'semantic-usage.json'

export function emptyUsageBucket(): SemanticUsageBucket {
  return { calls: 0, answered: 0, results: 0, estimatedTokens: 0 }
}

/**
 * The optional embedding model and its settings, kept under userData so they
 * survive app updates (the installer no longer ships the model).
 */
export class SemanticModelStore {
  constructor(readonly root: string) {}

  get modelDir(): string {
    return path.join(this.root, ...SEMANTIC_MODEL_ID.split('/'))
  }

  isInstalled(): boolean {
    try {
      for (const file of SEMANTIC_MODEL_FILES) {
        const stat = statSync(path.join(this.modelDir, file))
        if (!stat.isFile()) return false
        if (file.endsWith('.onnx') && stat.size < MIN_ONNX_BYTES) return false
      }
      return true
    } catch {
      return false
    }
  }

  readSettings(): SemanticIndexSettings {
    const stored = this.readJson<Partial<SemanticIndexSettings>>(SETTINGS_FILE)
    return { vectorIndex: stored?.vectorIndex === true }
  }

  writeSettings(settings: SemanticIndexSettings): void {
    this.writeJson(SETTINGS_FILE, settings)
  }

  readUsage(): SemanticUsage {
    const stored = this.readJson<SemanticUsage>(USAGE_FILE)
    if (!stored || typeof stored.since !== 'number' || !stored.tools || typeof stored.tools !== 'object') {
      return { since: Date.now(), tools: {} }
    }
    return stored
  }

  writeUsage(usage: SemanticUsage): void {
    this.writeJson(USAGE_FILE, usage)
  }

  /**
   * Copy a model the user obtained elsewhere (offline networks). Accepts the
   * model folder itself, its owner folder, or a models root that contains
   * <owner>/<model>. Copies into a staging folder first so a failed copy never
   * leaves a half-installed model behind.
   */
  importFrom(source: string): void {
    const candidates = [source, path.join(source, SEMANTIC_MODEL_ID.split('/')[1]), path.join(source, ...SEMANTIC_MODEL_ID.split('/'))]
    const found = candidates.find((dir) => SEMANTIC_MODEL_FILES.every((file) => existsSync(path.join(dir, file))))
    if (!found) {
      throw new Error(`The folder does not contain ${SEMANTIC_MODEL_ID}. Expected ${SEMANTIC_MODEL_FILES.join(', ')}.`)
    }
    if (path.resolve(found) === path.resolve(this.modelDir)) return
    const staging = `${this.modelDir}.importing`
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(path.join(staging, 'onnx'), { recursive: true })
    try {
      for (const file of SEMANTIC_MODEL_FILES) cpSync(path.join(found, file), path.join(staging, file))
      rmSync(this.modelDir, { recursive: true, force: true })
      mkdirSync(path.dirname(this.modelDir), { recursive: true })
      renameSync(staging, this.modelDir)
    } catch (err) {
      rmSync(staging, { recursive: true, force: true })
      throw err
    }
    if (!this.isInstalled()) throw new Error('The imported model is incomplete (the ONNX file is truncated).')
  }

  remove(): void {
    rmSync(this.modelDir, { recursive: true, force: true })
  }

  private readJson<T>(file: string): T | null {
    try {
      return JSON.parse(readFileSync(path.join(this.root, file), 'utf-8')) as T
    } catch {
      return null
    }
  }

  private writeJson(file: string, value: unknown): void {
    mkdirSync(this.root, { recursive: true })
    const target = path.join(this.root, file)
    writeFileSync(`${target}.tmp`, JSON.stringify(value, null, 2))
    renameSync(`${target}.tmp`, target)
  }
}
