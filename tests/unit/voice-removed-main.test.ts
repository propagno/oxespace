// @vitest-environment node
/**
 * B21 · OXEVoice left the main process (user decision, 31/10): no voice channel or preload API, no whisper engine in
 * the source or the package, no microphone permission. `<userData>/models` is shared with the semantic search model
 * (SemanticModelStore), so the cut leaves that folder alone: an upgrade keeps the semantic model and every file
 * OXEVoice downloaded there (the 1.4.0 notes, #449, tell the person to delete the `ggml-*` files by hand).
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import { SEMANTIC_MODEL_FILES, SemanticModelStore } from '../../electron/main/services/semantic-model-store'
import { SEMANTIC_MODEL_ID } from '../../electron/main/services/semantic-model'

const repo = process.cwd()
const read = (rel: string) => readFileSync(join(repo, rel), 'utf8')

function sources(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== 'vendor') found.push(...sources(path)) } else if (/\.(ts|tsx|mjs|cjs|js)$/.test(entry.name)) found.push(path)
  }
  return found
}

describe('B21: OXEVoice is gone from main, the preload and the package', () => {
  test('no voice channel and no voice API in the preload', () => {
    expect(Object.keys(IPC_CHANNELS)).not.toContain('voice')
    expect(read('shared/types/ipc.ts')).not.toMatch(/['"]voice:/)
    expect(read('electron/preload/api.ts')).not.toMatch(/IPC_CHANNELS\.voice|\bvoice:\s*\{/)
    expect(existsSync(join(repo, 'shared/types/voice.ts'))).toBe(false)
  })

  test('no main source names whisper or a ggml model, and only the semantic store opens <userData>/models', () => {
    const offenders: string[] = []
    const modelsUsers: string[] = []
    for (const file of [...sources(join(repo, 'electron/main')), ...sources(join(repo, 'electron/preload'))]) {
      const text = readFileSync(file, 'utf8')
      const rel = relative(repo, file).replace(/\\/g, '/')
      if (/whisper|ggml/i.test(text)) offenders.push(rel)
      if (/getPath\('userData'\)[^\n]*'models'/.test(text)) modelsUsers.push(rel)
    }
    expect(offenders).toEqual([])
    expect(modelsUsers).toEqual(['electron/main/index.ts'])
    expect(read('electron/main/index.ts')).toMatch(/new SemanticModelStore\(join\(app\.getPath\('userData'\), 'models'\)\)/)
  })

  test('the package carries no whisper engine', () => {
    expect(read('electron-builder.yml')).not.toMatch(/whisper/i)
    expect(read('package.json')).not.toMatch(/whisper/i)
    expect(existsSync(join(repo, 'resources/whisper'))).toBe(false)
  })

  test('the window no longer grants the microphone or camera', () => {
    const allowed = /const ALLOWED_PERMISSIONS = new Set\(\[([^\]]*)\]\)/.exec(read('electron/main/index.ts'))
    expect(allowed?.[1]).toBeDefined()
    expect(allowed![1]).not.toMatch(/'media'/)
    expect(allowed![1]).toMatch(/'clipboard-read'/)
  })
})

describe('B21: an upgrade leaves <userData>/models as it was', () => {
  test('the semantic model is still installed next to OXEVoice\'s ggml files, and no file there changes', () => {
    const models = mkdtempSync(join(tmpdir(), 'oxe-b21-models-'))
    try {
      const modelDir = join(models, ...SEMANTIC_MODEL_ID.split('/'))
      for (const file of SEMANTIC_MODEL_FILES) {
        mkdirSync(join(modelDir, file, '..'), { recursive: true })
        writeFileSync(join(modelDir, file), file.endsWith('.onnx') ? Buffer.alloc(1024 * 1024 + 1) : '{}')
      }
      writeFileSync(join(models, 'ggml-base.bin'), 'whisper model')
      writeFileSync(join(models, 'ggml-small.bin.part'), 'partial download')
      // Every file under models/, with its size and modification time.
      const listing = (): string[] => {
        const all: string[] = []
        const walk = (dir: string) => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name)
            if (entry.isDirectory()) walk(path)
            else { const info = statSync(path); all.push(`${relative(models, path).replace(/\\/g, '/')}:${info.size}:${info.mtimeMs}`) }
          }
        }
        walk(models)
        return all.sort()
      }
      const before = listing()
      expect(before).toHaveLength(SEMANTIC_MODEL_FILES.length + 2)

      // What the upgraded app does with the folder at launch: the semantic store reads it.
      const store = new SemanticModelStore(models)
      expect(store.isInstalled()).toBe(true)
      store.readSettings()
      store.readUsage()

      expect(listing()).toEqual(before)
      expect(readFileSync(join(models, 'ggml-base.bin'), 'utf8')).toBe('whisper model')
    } finally {
      rmSync(models, { recursive: true, force: true })
    }
  })
})
