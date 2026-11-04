// Frozen acceptance test for CR-03 (OXE phase F1, A8, from the BACKEND review of #605). The executor must not edit it.
// A migration PR moves every pin of the schema version together, and every Workspace literal carries `color`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

describe('CR-03 · the workspace color migration moves every pin and every Workspace literal', () => {
  test('the migrations suite expects the same schema version as LATEST_DB_VERSION', () => {
    const latest = Number(/export const LATEST_DB_VERSION = (\d+)/.exec(read('electron/main/db/index.ts'))?.[1])
    const expected = Number(/EXPECTED_SCHEMA_VERSION\s*=\s*(\d+)/.exec(read('tests/integration/migrations.test.ts'))?.[1])
    expect(latest).toBeGreaterThanOrEqual(93)
    expect(expected).toBe(latest)
  })

  test.each(['electron/main/e2e/mock-ipc.ts', 'src/components/Threads/ThreadGrid.tsx'])('%s builds its Workspace with color', path => {
    expect(read(path)).toMatch(/\bcolor:\s*null\b/)
  })
})
