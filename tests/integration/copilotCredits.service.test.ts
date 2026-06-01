import { beforeEach, describe, expect, test, vi } from 'vitest'

// Mocked spawn, kept in vi.hoisted so the hoisted vi.mock factory can read it.
// Same idiom as oxe.service.test.ts / voice.service.test.ts.
const h = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  runs: [] as Array<{ stdout?: string; stderr?: string; code?: number }>
}))

vi.mock('node:child_process', () => {
  const mk = () => {
    const handlers: Record<string, Array<(...a: unknown[]) => void>> = {}
    return {
      setEncoding: () => undefined,
      on(e: string, cb: (...a: unknown[]) => void) { (handlers[e] ??= []).push(cb) },
      emit(e: string, ...a: unknown[]) { (handlers[e] ?? []).forEach((f) => f(...a)) }
    }
  }
  h.spawnMock.mockImplementation(() => {
    const next = h.runs.shift() ?? { code: 0 }
    const stdout = mk()
    const stderr = mk()
    const child = mk() as ReturnType<typeof mk> & { stdout: unknown; stderr: unknown; kill: () => void }
    child.stdout = stdout
    child.stderr = stderr
    child.kill = () => undefined
    setImmediate(() => {
      if (next.stdout) stdout.emit('data', next.stdout)
      if (next.stderr) stderr.emit('data', next.stderr)
      child.emit('close', next.code ?? 0)
    })
    return child
  })
  return { spawn: h.spawnMock, default: { spawn: h.spawnMock } }
})

import { CopilotCreditsService } from '../../electron/main/services/copilotCredits.service'

const BUSINESS_RESPONSE = JSON.stringify({
  login: 'dev',
  copilot_plan: 'business',
  access_type_sku: 'copilot_for_business_seat',
  token_based_billing: true,
  quota_reset_date: '2026-07-01',
  quota_snapshots: {
    premium_interactions: { percent_remaining: 77, remaining: 231, entitlement: 300, unlimited: false, overage_permitted: true },
    chat: { percent_remaining: 100, remaining: 200, entitlement: 200, unlimited: false },
    completions: { percent_remaining: 100, remaining: 2000, entitlement: 2000, unlimited: false }
  }
})

describe('CopilotCreditsService', () => {
  beforeEach(() => { h.runs = []; h.spawnMock.mockClear() })

  test('parses premium_interactions into used% + reset date', async () => {
    h.runs = [{ stdout: BUSINESS_RESPONSE, code: 0 }]
    const result = await new CopilotCreditsService().getCredits()
    expect(result.available).toBe(true)
    expect(result.installed).toBe(true)
    expect(result.plan).toBe('business')
    expect(result.premium).toEqual({ usedPct: 23, remaining: 231, entitlement: 300, unlimited: false, overagePermitted: true })
    expect(result.resetDate).toBe('2026-07-01')
    expect(result.error).toBeNull()
  })

  test('reports gh not installed when the binary is missing', async () => {
    h.spawnMock.mockImplementationOnce(() => { throw new Error('ENOENT') })
    const result = await new CopilotCreditsService().getCredits(true)
    expect(result.installed).toBe(false)
    expect(result.available).toBe(false)
    expect(result.premium).toBeNull()
  })

  test('handles a non-zero gh exit (not authed / no access) without throwing', async () => {
    h.runs = [{ stdout: '{"message":"Bad credentials"}', code: 1 }]
    const result = await new CopilotCreditsService().getCredits(true)
    expect(result.installed).toBe(true)
    expect(result.available).toBe(false)
    expect(result.error).toMatch(/Bad credentials/)
  })

  test('caches within the TTL (no second spawn)', async () => {
    h.runs = [{ stdout: BUSINESS_RESPONSE, code: 0 }]
    const svc = new CopilotCreditsService()
    await svc.getCredits()
    await svc.getCredits() // cached
    expect(h.spawnMock).toHaveBeenCalledTimes(1)
  })
})
