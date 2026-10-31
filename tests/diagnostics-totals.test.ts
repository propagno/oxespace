// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildBundle } from '../electron/main/services/diagnostics/bundle'
import { collectMetrics, measureStorage } from '../electron/main/services/diagnostics/metrics'
import { isMessageCode } from '../shared/messages'

const folder = mkdtempSync(join(tmpdir(), 'oxe-diag-totals-'))
afterAll(() => rmSync(folder, { recursive: true, force: true }))

describe('diagnostics totals and bundle summaries (CCR on B8.3)', () => {
  it('reports the computer\'s memory and the data volume\'s size, so meters show a real share', async () => {
    writeFileSync(join(folder, 'db.sqlite'), 'x'.repeat(10))
    const storage = await measureStorage({ dataDirectory: folder, databaseFile: join(folder, 'db.sqlite'), logDirectories: [] })
    expect(storage.databaseBytes).toBe(10)
    if (storage.diskTotalBytes !== null) {
      expect(storage.diskTotalBytes).toBeGreaterThan(0)
      expect(storage.freeBytes).toBeLessThanOrEqual(storage.diskTotalBytes)
    }
    const metrics = await collectMetrics({ appMetrics: () => [], storage: async () => storage, clis: async () => [], connectivity: () => ({ state: 'online', checkedAt: 1 }),
      accounts: () => [], mcpServers: () => ({ total: 0, healthy: 0, quarantined: 0, failing: 0 }), totalMemory: () => 16 * 1024 ** 3 } as never, 1)
    expect(metrics.system).toEqual({ totalMemoryBytes: 16 * 1024 ** 3 })
    expect(metrics.storage.diskTotalBytes).toBe(storage.diskTotalBytes)
    const failing = await collectMetrics({ appMetrics: () => [], storage: async () => { throw new Error('gone') }, clis: async () => [], connectivity: () => ({ state: 'online', checkedAt: 1 }),
      accounts: () => [], mcpServers: () => ({ total: 0, healthy: 0, quarantined: 0, failing: 0 }), totalMemory: () => Number.NaN } as never, 1)
    expect(failing.storage).toEqual({ freeBytes: null, diskTotalBytes: null, databaseBytes: 0, logsBytes: 0 })
    expect(failing.system.totalMemoryBytes).toBe(0)
  })

  it('says what each bundle file holds as a message code', async () => {
    const bundle = await buildBundle({
      snapshot: () => ({ generatedAt: 1, appVersion: '1.4.0', platform: 'win32', arch: 'x64', nodeVersion: '22', electronVersion: '44', workspaceCount: 0, checks: [] }),
      metrics: async () => null as never, incidents: () => [], runtimeEvents: () => '', logFiles: () => [], readTail: async () => '',
      about: () => ({}), configuration: () => ({}), names: () => []
    } as never)
    const summaries = bundle.preview.files.map(file => [file.name, file.summary.code])
    expect(summaries).toEqual([
      ['snapshot.json', 'bundle.file.snapshot'], ['incidents.json', 'bundle.file.incidents'], ['runtime-events.jsonl', 'bundle.file.runtime'],
      ['main-log-tail.txt', 'bundle.file.logTail'], ['versions.json', 'bundle.file.versions'], ['configuration.json', 'bundle.file.configuration']
    ])
    for (const file of bundle.preview.files) expect(isMessageCode(file.summary.code), file.name).toBe(true)
  })
})
