import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AppDatabase } from '../../electron/main/db'

// Stub the Electron + native surface so the service can be constructed under
// plain Node (no Electron runtime, no real embedding worker, no better-sqlite3).
// This lets us validate the *wiring* fix — that indexing actually starts — which
// the live path can't exercise here due to the better-sqlite3 ABI mismatch.
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => os.tmpdir(), getAppPath: () => os.tmpdir() }
}))

const workers = vi.hoisted(() => [] as Array<{ data: unknown; handlers: Map<string, (msg: unknown) => void>; posted: unknown[] }>)
vi.mock('node:worker_threads', () => {
  class FakeWorker {
    handlers = new Map<string, (msg: unknown) => void>()
    posted: unknown[] = []
    constructor(_path: string, options: { workerData?: unknown }) {
      workers.push({ data: options.workerData, handlers: this.handlers, posted: this.posted })
    }
    on(event: string, handler: (msg: unknown) => void): this { this.handlers.set(event, handler); return this }
    postMessage(msg: unknown): void { this.posted.push(msg) }
    terminate(): Promise<number> { return Promise.resolve(0) }
  }
  return { Worker: FakeWorker, default: { Worker: FakeWorker } }
})

const watchMock = vi.fn(() => ({ on: vi.fn().mockReturnThis(), close: vi.fn() }))
vi.mock('chokidar', () => ({
  default: { watch: (...args: unknown[]) => watchMock(...args) },
  FSWatcher: class {}
}))

// Imported after the mocks are registered (vi.mock is hoisted above imports).
const { SemanticService } = await import('../../electron/main/services/semantic.service')

interface WsRow { id: string; root_path: string; is_active: number }

const THIS_FILE = fileURLToPath(import.meta.url)

function makeFakeDb(workspaces: WsRow[], lexical: Array<{ file_path: string; rank: number }> = [{ file_path: THIS_FILE, rank: -1 }]): AppDatabase & { queries: string[] } {
  const queries: string[] = []
  return {
    queries,
    prepare(sql: string) {
      queries.push(sql)
      return {
        get: (...args: unknown[]) => {
          if (sql.includes('is_active = 1')) return workspaces.find((w) => w.is_active === 1)
          if (/FROM workspaces WHERE id/.test(sql)) return workspaces.find((w) => w.id === args[0])
          if (sql.includes('semantic_documents_fts') && sql.includes('COUNT(*)')) return { n: lexical.length }
          if (sql.includes('COUNT(*)')) return { n: 0 }
          return undefined
        },
        all: () => sql.includes('semantic_documents_fts') ? lexical : [],
        run: () => undefined
      }
    }
  } as unknown as AppDatabase & { queries: string[] }
}

/** In-memory stand-in for SemanticModelStore (userData/models). */
function makeStore(options: { vectorIndex?: boolean; installed?: boolean } = {}) {
  let settings = { vectorIndex: options.vectorIndex ?? false }
  let installed = options.installed ?? false
  const writes: unknown[] = []
  return {
    root: '/user-data/models',
    readSettings: () => settings,
    writeSettings: (next: { vectorIndex: boolean }) => { settings = next },
    isInstalled: () => installed,
    readUsage: () => ({ since: 1, tools: {} }),
    writeUsage: (usage: unknown) => { writes.push(JSON.parse(JSON.stringify(usage))) },
    importFrom: () => { installed = true },
    remove: () => { installed = false },
    writes
  }
}

describe('SemanticService indexing startup', () => {
  beforeEach(() => { watchMock.mockClear(); workers.length = 0 })
  afterEach(() => vi.clearAllMocks())

  test('does NOT watch on construction — opt-in / off by default', () => {
    // Semantic is opt-in: even with an active workspace, boot must not start
    // indexing until the user (renderer) enables it.
    const db = makeFakeDb([
      { id: 'ws-active', root_path: '/projects/active', is_active: 1 },
      { id: 'ws-other', root_path: '/projects/other', is_active: 0 }
    ])
    const svc = new SemanticService(db)
    try {
      expect(watchMock).not.toHaveBeenCalled()
      expect(svc.isEnabled('ws-active')).toBe(false)
    } finally {
      svc.destroy()
    }
  })

  test('setEnabled(true) without a rootPath resolves the root from the DB and starts watching', () => {
    const db = makeFakeDb([{ id: 'ws-1', root_path: '/projects/app', is_active: 0 }])
    const svc = new SemanticService(db)
    try {
      expect(watchMock).not.toHaveBeenCalled()

      // Mirrors the renderer chip's mount effect, which passes only
      // { workspaceId, enabled } (no rootPath).
      svc.setEnabled('ws-1', true)

      expect(watchMock).toHaveBeenCalledTimes(1)
      expect(watchMock.mock.calls[0][0]).toBe('/projects/app')
      // chokidar must receive the function predicate, not a glob array
      // (chokidar v5 dropped glob support).
      const opts = watchMock.mock.calls[0][1] as { ignored: unknown }
      expect(typeof opts.ignored).toBe('function')
    } finally {
      svc.destroy()
    }
  })

  test('setEnabled(false) does not start a watcher', () => {
    const db = makeFakeDb([{ id: 'ws-1', root_path: '/projects/app', is_active: 0 }])
    const svc = new SemanticService(db)
    try {
      svc.setEnabled('ws-1', false)
      expect(watchMock).not.toHaveBeenCalled()
      expect(svc.isEnabled('ws-1')).toBe(false)
    } finally {
      svc.destroy()
    }
  })

  test('does not start a second watcher for an already-watched workspace', () => {
    const db = makeFakeDb([{ id: 'ws-active', root_path: '/projects/active', is_active: 1 }])
    const svc = new SemanticService(db)
    try {
      svc.setEnabled('ws-active', true) // enable -> first watcher
      expect(watchMock).toHaveBeenCalledTimes(1)
      svc.setEnabled('ws-active', true) // idempotent -> no second watcher
      expect(watchMock).toHaveBeenCalledTimes(1)
    } finally {
      svc.destroy()
    }
  })

  test('answers with exact terms (FTS5) when there is no model, without starting the worker', async () => {
    const db = makeFakeDb([{ id: 'ws-1', root_path: '/projects/app', is_active: 0 }])
    const svc = new SemanticService(db)
    const embed = vi.spyOn(svc, 'getEmbedding')
    try {
      const report = await svc.queryDetailed('ws-1', 'semantic service fallback', { mode: 'exhaustive' })
      expect(workers).toHaveLength(0)
      expect(embed).not.toHaveBeenCalled()
      expect(db.queries.some((sql) => sql.includes('FROM semantic_embeddings'))).toBe(false)
      expect(report.sources).toEqual(['fts5'])
      expect(report.results).toHaveLength(1)
      expect(report.results[0].sources).toEqual(['lexical'])
      expect(report.coverage.searchedFullLexicalIndex).toBe(true)
      // Exact-term retrieval is the normal mode, not a degradation.
      expect(report.warning ?? '').not.toContain('Vector')
      expect(svc.getStatus('ws-1').vector).toMatchObject({ enabled: false, state: 'off', available: false })
    } finally {
      svc.destroy()
    }
  })

  test('a single exact-term match is medium confidence and is not auto-expanded', async () => {
    const db = makeFakeDb([{ id: 'ws-1', root_path: '/projects/app', is_active: 0 }])
    const svc = new SemanticService(db)
    try {
      const report = await svc.queryDetailed('ws-1', 'semantic service fallback', { mode: 'auto' })
      expect(report.confidence).toBe('medium')
      expect(report.expanded).toBe(false)
    } finally {
      svc.destroy()
    }
  })

  test('auto-expands a low-confidence exact-term pass without requiring the caller to retry', async () => {
    const db = makeFakeDb([{ id: 'ws-1', root_path: '/projects/app', is_active: 0 }], [
      { file_path: THIS_FILE, rank: -1 },
      { file_path: `${THIS_FILE}.missing`, rank: -0.95 }
    ])
    const svc = new SemanticService(db)
    try {
      const report = await svc.queryDetailed('ws-1', 'semantic service fallback', { mode: 'auto' })
      expect(report.expanded).toBe(true)
      expect(report.resolvedMode).toBe('exhaustive')
      expect(report.expansionReason).toContain('low confidence')
      expect(report.coverage.searchedFullLexicalIndex).toBe(true)
      expect(report.confidence).toBe('low')
    } finally {
      svc.destroy()
    }
  })

  test('with the index on and the model installed, loads the model from userData only (no remote fetch)', () => {
    const db = makeFakeDb([{ id: 'ws-1', root_path: '/projects/app', is_active: 0 }])
    const svc = new SemanticService(db, { modelStore: makeStore({ vectorIndex: true, installed: true }) as never })
    try {
      expect(workers).toHaveLength(1)
      expect(workers[0].data).toEqual({ modelRoot: '/user-data/models', allowRemote: false })
      expect(svc.getVectorStatus().state).toBe('loading')
      workers[0].handlers.get('message')!({ type: 'ready' })
      expect(svc.getVectorStatus()).toMatchObject({ state: 'ready', installed: true, available: true })
    } finally {
      svc.destroy()
    }
  })

  test('turning the index on without a model does not download it; downloading is explicit and reports progress', () => {
    const db = makeFakeDb([{ id: 'ws-1', root_path: '/projects/app', is_active: 0 }])
    const store = makeStore()
    const svc = new SemanticService(db, { modelStore: store as never })
    try {
      expect(workers).toHaveLength(0)
      expect(svc.setVectorIndex(true).state).toBe('not-installed')
      expect(workers).toHaveLength(0)
      expect(store.readSettings().vectorIndex).toBe(true)

      svc.downloadModel()
      expect(workers).toHaveLength(1)
      expect(workers[0].data).toEqual({ modelRoot: '/user-data/models', allowRemote: true })
      workers[0].handlers.get('message')!({ type: 'progress', file: 'onnx/model_quantized.onnx', loaded: 50, total: 200 })
      expect(svc.getVectorStatus()).toMatchObject({ state: 'downloading', progress: { loaded: 50, total: 200 } })

      // A failed download leaves exact-term search untouched and allows a retry.
      workers[0].handlers.get('message')!({ type: 'error', error: 'fetch failed' })
      expect(svc.getVectorStatus()).toMatchObject({ state: 'error', error: 'fetch failed' })
      expect(svc.getStatus('ws-1').lastError).toBeNull()
      svc.downloadModel()
      expect(workers).toHaveLength(2)
    } finally {
      svc.destroy()
    }
  })

  test('says so when the index is on but the model has not loaded yet', async () => {
    const db = makeFakeDb([{ id: 'ws-1', root_path: '/projects/app', is_active: 0 }])
    const svc = new SemanticService(db, { modelStore: makeStore({ vectorIndex: true, installed: true }) as never })
    try {
      const report = await svc.queryDetailed('ws-1', 'semantic service fallback', { mode: 'exhaustive' })
      expect(report.sources).toEqual(['fts5'])
      expect(report.warning).toContain('still loading')
    } finally {
      svc.destroy()
    }
  })

  test('queries vectors once the model is ready, and warns when a query embedding fails', async () => {
    const db = makeFakeDb([{ id: 'ws-1', root_path: '/projects/app', is_active: 0 }])
    const svc = new SemanticService(db, { modelStore: makeStore({ vectorIndex: true, installed: true }) as never })
    workers[0].handlers.get('message')!({ type: 'ready' })
    vi.spyOn(svc, 'getEmbedding').mockRejectedValue(new Error('model offline'))
    try {
      const report = await svc.queryDetailed('ws-1', 'semantic service fallback', { mode: 'exhaustive' })
      expect(db.queries.some((sql) => sql.includes('FROM semantic_embeddings'))).toBe(true)
      expect(report.sources).toEqual(['fts5'])
      expect(report.warning).toContain('Vector embeddings were unavailable')
    } finally {
      svc.destroy()
    }
  })

  test('counts tool calls locally, split by whether vectors took part', async () => {
    const db = makeFakeDb([{ id: 'ws-1', root_path: '/projects/app', is_active: 0 }])
    const store = makeStore()
    const svc = new SemanticService(db, { modelStore: store as never })
    await svc.queryDetailed('ws-1', 'semantic service fallback', { caller: 'oxespace_semantic_search' })
    await svc.queryDetailed('ws-1', 'semantic service fallback')
    expect(svc.getUsage().tools.oxespace_semantic_search.withoutVector).toMatchObject({ calls: 1, answered: 1, results: 1 })
    expect(svc.getUsage().tools.oxespace_semantic_search.withVector.calls).toBe(0)
    svc.destroy()
    expect(store.writes.at(-1)).toMatchObject({ tools: { oxespace_semantic_search: { withoutVector: { calls: 1 } } } })
  })
})
