import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SEMANTIC_MODEL_FILES, SemanticModelStore } from '../../electron/main/services/semantic-model-store'

function fakeModel(dir: string, onnxBytes = 2 * 1024 * 1024): string {
  mkdirSync(join(dir, 'onnx'), { recursive: true })
  for (const file of SEMANTIC_MODEL_FILES) {
    writeFileSync(join(dir, file), file.endsWith('.onnx') ? Buffer.alloc(onnxBytes) : '{}')
  }
  return dir
}

describe('SemanticModelStore', () => {
  it('starts off and not installed, and persists the vector-index setting', () => {
    const store = new SemanticModelStore(mkdtempSync(join(tmpdir(), 'oxe-model-')))
    expect(store.isInstalled()).toBe(false)
    expect(store.readSettings()).toEqual({ vectorIndex: false })
    store.writeSettings({ vectorIndex: true })
    expect(new SemanticModelStore(store.root).readSettings()).toEqual({ vectorIndex: true })
  })

  it('imports the model folder itself or a models root that contains <owner>/<model>', () => {
    const source = mkdtempSync(join(tmpdir(), 'oxe-model-src-'))
    fakeModel(join(source, 'Xenova', 'multilingual-e5-base'))

    const fromRoot = new SemanticModelStore(mkdtempSync(join(tmpdir(), 'oxe-model-')))
    fromRoot.importFrom(source)
    expect(fromRoot.isInstalled()).toBe(true)

    const fromFolder = new SemanticModelStore(mkdtempSync(join(tmpdir(), 'oxe-model-')))
    fromFolder.importFrom(join(source, 'Xenova', 'multilingual-e5-base'))
    expect(fromFolder.isInstalled()).toBe(true)

    fromFolder.remove()
    expect(fromFolder.isInstalled()).toBe(false)
  })

  it('refuses a folder without the model and a truncated ONNX file', () => {
    const store = new SemanticModelStore(mkdtempSync(join(tmpdir(), 'oxe-model-')))
    expect(() => store.importFrom(mkdtempSync(join(tmpdir(), 'oxe-empty-')))).toThrow('does not contain')
    const truncated = fakeModel(mkdtempSync(join(tmpdir(), 'oxe-trunc-')), 10)
    expect(() => store.importFrom(truncated)).toThrow('incomplete')
  })

  it('keeps usage counters across restarts and tolerates a corrupt file', () => {
    const root = mkdtempSync(join(tmpdir(), 'oxe-model-'))
    const store = new SemanticModelStore(root)
    store.writeUsage({ since: 5, tools: { t: { withVector: { calls: 1, answered: 1, results: 2, estimatedTokens: 3 }, withoutVector: { calls: 0, answered: 0, results: 0, estimatedTokens: 0 } } } })
    expect(new SemanticModelStore(root).readUsage().tools.t.withVector.calls).toBe(1)
    writeFileSync(join(root, 'semantic-usage.json'), '{not json')
    expect(new SemanticModelStore(root).readUsage().tools).toEqual({})
  })
})
