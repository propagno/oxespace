import os from 'node:os'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AppDatabase } from '../../electron/main/db'

// Stub the Electron + native surface so the service can be constructed under
// plain Node (no Electron runtime, no real embedding worker, no better-sqlite3).
// This lets us validate the *wiring* fix — that indexing actually starts — which
// the live path can't exercise here due to the better-sqlite3 ABI mismatch.
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => os.tmpdir(), getAppPath: () => os.tmpdir() }
}))

vi.mock('node:worker_threads', () => {
  class FakeWorker {
    on(): void {}
    postMessage(): void {}
    terminate(): void {}
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

function makeFakeDb(workspaces: WsRow[]): AppDatabase {
  return {
    prepare(sql: string) {
      return {
        get: (...args: unknown[]) => {
          if (sql.includes('is_active = 1')) return workspaces.find((w) => w.is_active === 1)
          if (/FROM workspaces WHERE id/.test(sql)) return workspaces.find((w) => w.id === args[0])
          if (sql.includes('COUNT(*)')) return { n: 0 }
          return undefined
        },
        all: () => [],
        run: () => undefined
      }
    }
  } as unknown as AppDatabase
}

describe('SemanticService indexing startup', () => {
  beforeEach(() => watchMock.mockClear())
  afterEach(() => vi.clearAllMocks())

  test('watches the active workspace on construction (boot path)', () => {
    const db = makeFakeDb([
      { id: 'ws-active', root_path: '/projects/active', is_active: 1 },
      { id: 'ws-other', root_path: '/projects/other', is_active: 0 }
    ])
    const svc = new SemanticService(db)
    try {
      expect(watchMock).toHaveBeenCalledTimes(1)
      expect(watchMock.mock.calls[0][0]).toBe('/projects/active')
      // chokidar must receive the function predicate, not a glob array
      // (chokidar v5 dropped glob support).
      const opts = watchMock.mock.calls[0][1] as { ignored: unknown }
      expect(typeof opts.ignored).toBe('function')
    } finally {
      svc.destroy()
    }
  })

  test('setEnabled(true) without a rootPath resolves the root from the DB and starts watching', () => {
    // No active workspace -> nothing watched at construction.
    const db = makeFakeDb([{ id: 'ws-1', root_path: '/projects/app', is_active: 0 }])
    const svc = new SemanticService(db)
    try {
      expect(watchMock).not.toHaveBeenCalled()

      // This mirrors the renderer chip's mount effect, which passes only
      // { workspaceId, enabled } — the regression that left the index empty.
      svc.setEnabled('ws-1', true)

      expect(watchMock).toHaveBeenCalledTimes(1)
      expect(watchMock.mock.calls[0][0]).toBe('/projects/app')
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
      expect(watchMock).toHaveBeenCalledTimes(1) // from construction
      svc.setEnabled('ws-active', true) // idempotent
      expect(watchMock).toHaveBeenCalledTimes(1)
    } finally {
      svc.destroy()
    }
  })
})
