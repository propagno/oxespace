// @vitest-environment node
// Frozen acceptance test for OXE-446 (A5): zero MCP tools can create, edit, delete, or elevate an automation;
// schedules.ipc.ts stays renderer-only; full-access is strictly rejected at validation, scheduler, and runner layers.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { TOOL_REGISTRY } from '../../../electron/main/mcp-internal/tool-registry'
import { buildRpcMethods } from '../../../electron/main/runtime/rpc/methods'
import { ScheduleStore } from '../../../electron/main/services/schedules/schedule-store'
import { ScheduleRefused, Scheduler } from '../../../electron/main/services/schedules/scheduler'
import { scheduleThreadRunner } from '../../../electron/main/services/schedules/thread-runner'
import { FORBIDDEN_CAPABILITIES, MCP_COVERAGE } from '../../../shared/mcp-coverage'
import { scheduleRefusal } from '../../../shared/schedule'
import { IPC_CHANNELS } from '../../../shared/types/ipc'

const openDbs: AppDatabase[] = []
afterEach(() => { for (const db of openDbs.splice(0)) db.close() })

describe('OXE-446 A5 · security boundaries (no MCP schedule admin, renderer-only IPC, full-access forbidden)', () => {
  it('keeps schedules.admin in FORBIDDEN_CAPABILITIES covering every schedules.* channel with zero MCP schedule tools', () => {
    expect(FORBIDDEN_CAPABILITIES).toContain('schedules.admin')
    const cap = MCP_COVERAGE['schedules.admin']
    expect(cap).toBeDefined()
    expect('forbidden' in cap).toBe(true)
    expect('tools' in cap).toBe(false)
    expect(cap.ipc).toEqual(['schedules.*'])

    // Every schedules.* IPC channel exists and is exclusively under schedules.admin (no covered capability overlaps).
    const scheduleChannels = Object.keys(IPC_CHANNELS.schedules)
    expect(scheduleChannels).toEqual(
      expect.arrayContaining(['state', 'runs', 'save', 'remove', 'setEnabled', 'setPaused', 'setMaxConcurrent', 'runNow', 'reviewQueue', 'reviewDiff', 'createPrFromRun', 'applyRunToCheckout', 'discardRun'])
    )

    // Zero MCP tools may touch schedules or automations.
    const scheduleMcpTools = TOOL_REGISTRY
      .map(entry => entry.descriptor.name)
      .filter(name => /schedule|automation|review_queue/i.test(name))
    expect(scheduleMcpTools).toEqual([])
  })

  it('rejects full-access at validation, Scheduler.save, and scheduleThreadRunner.start', async () => {
    const now = Date.now()
    const badInput = {
      name: 'Escalation Attempt',
      projectId: 'p1',
      rootPath: 'C:/work/repo',
      provider: 'claude' as const,
      access: 'full-access' as never,
      confirmedWrite: true,
      prompt: 'Try to escalate.',
      rule: { kind: 'cron' as const, expression: '0 * * * *' }
    }

    expect(scheduleRefusal(badInput, now)).toBe('access')

    const db = openInMemoryDatabase(); openDbs.push(db)
    const scheduler = new Scheduler({
      store: new ScheduleStore(db),
      start: async () => ({ threadId: 't1' }),
      busy: async () => false,
      knownProject: () => true,
      now: () => now
    })
    let refusedCode: string | null = null
    try {
      scheduler.save(badInput)
    } catch (error) {
      refusedCode = error instanceof ScheduleRefused ? error.code : null
    }
    expect(refusedCode).toBe('access')

    const service = {
      create: vi.fn(),
      command: vi.fn(),
      configure: vi.fn(),
      send: vi.fn(),
      read: vi.fn()
    }
    const runner = scheduleThreadRunner({
      service: async () => service as never,
      context: (projectId, rootPath) => ({ projectId, rootPath })
    })
    await expect(runner.start({
      id: 'forged-row',
      name: 'Forged',
      projectId: 'p1',
      rootPath: 'C:/work/repo',
      provider: 'claude',
      model: null,
      access: 'full-access' as never,
      prompt: 'Escalate',
      rule: { kind: 'cron', expression: '0 * * * *' },
      enabled: true,
      catchUp: false,
      createdAt: now,
      updatedAt: now,
      nextRunAt: now,
      lastRunAt: null,
      failures: 0,
      pausedReason: null
    })).rejects.toThrow()
    expect(service.create).not.toHaveBeenCalled()
  })

  it('keeps schedules.ipc.ts strictly renderer-only and local RPC trigger-only without schedule mutation methods', () => {
    const ipcSource = readFileSync(join(process.cwd(), 'electron/main/ipc/schedules.ipc.ts'), 'utf8')
    const coverageSource = readFileSync(join(process.cwd(), 'shared/mcp-coverage.ts'), 'utf8')
    expect(coverageSource).toContain("'schedules.admin'")
    expect(ipcSource).not.toMatch(/mcp-internal|remote-gateway|full-access/)
    expect(ipcSource).toContain('ipcMain.handle(IPC_CHANNELS.schedules.save')

    const db = openInMemoryDatabase(); openDbs.push(db)
    const methods = buildRpcMethods({
      db,
      gitHubService: {} as never,
      executionHost: { id: 'local', exec: vi.fn() } as never,
      appVersion: '1.6.3',
      listMethods: () => []
    })
    const methodNames = Object.keys(methods)
    expect(methodNames.filter(name => /^automation\.(create|save|edit|update|remove|delete|setAccess|setEnabled)/.test(name))).toEqual([])
  })
})
