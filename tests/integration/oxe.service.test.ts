import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// State for the mocked spawn + fs, kept in vi.hoisted so the (hoisted) vi.mock
// factories can read it. Same approach as voice.service.test.ts.
const h = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  runs: [] as Array<{ stdout?: string; stderr?: string; code?: number }>,
  oxeDirExists: true
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

vi.mock('node:fs', () => {
  const api = {
    existsSync: vi.fn(() => h.oxeDirExists),
    watch: vi.fn(() => ({ on: vi.fn(), close: vi.fn() }))
  }
  return { ...api, default: api }
})

import { OxeService } from '../../electron/main/services/oxe.service'

describe('OxeService.detect', () => {
  beforeEach(() => { h.runs = []; h.spawnMock.mockClear() })
  afterEach(() => vi.clearAllMocks())

  test('parses the version from `oxe --version`', async () => {
    h.runs = [{ stdout: 'oxe-cc v1.12.0\n', code: 0 }]
    const result = await new OxeService().detect()
    expect(result).toEqual({ installed: true, version: '1.12.0' })
  })

  test('reports not installed when the binary is missing', async () => {
    h.runs = [{ stderr: '', code: null }]
    h.spawnMock.mockImplementationOnce(() => { throw new Error('ENOENT') })
    const result = await new OxeService().detect(true)
    expect(result.installed).toBe(false)
    expect(result.version).toBeNull()
  })
})

describe('OxeService.status', () => {
  beforeEach(() => { h.runs = []; h.oxeDirExists = true; h.spawnMock.mockClear() })

  test('returns parsed status for an OXE project', async () => {
    h.runs = [
      { stdout: 'oxe-cc v1.12.0', code: 0 }, // detect
      { stdout: '{"healthStatus":"warning","nextStep":"plan","cursorCmd":"/oxe-plan","phase":null}', code: 0 } // status
    ]
    const result = await new OxeService().status('C:/repo')
    expect(result.installed).toBe(true)
    expect(result.isOxeProject).toBe(true)
    expect(result.status?.healthStatus).toBe('warning')
    expect(result.status?.cursorCmd).toBe('/oxe-plan')
    expect(result.error).toBeNull()
  })

  test('flags a non-OXE project (no .oxe dir) without running status', async () => {
    h.oxeDirExists = false
    h.runs = [{ stdout: 'oxe-cc v1.12.0', code: 0 }]
    const result = await new OxeService().status('C:/plain')
    expect(result.installed).toBe(true)
    expect(result.isOxeProject).toBe(false)
    expect(result.status).toBeNull()
  })

  test('tolerates invalid JSON from the CLI', async () => {
    h.runs = [
      { stdout: 'oxe-cc v1.12.0', code: 0 },
      { stdout: 'not json at all', code: 0 }
    ]
    const result = await new OxeService().status('C:/repo')
    expect(result.status).toBeNull()
    expect(result.error).toMatch(/parse/i)
  })

  test('short-circuits to not-installed when oxe is absent', async () => {
    h.spawnMock.mockImplementationOnce(() => { throw new Error('ENOENT') })
    const result = await new OxeService().status('C:/repo')
    expect(result.installed).toBe(false)
    expect(result.status).toBeNull()
  })
})

describe('OxeService.statusSummary', () => {
  beforeEach(() => { h.runs = []; h.oxeDirExists = true; h.spawnMock.mockClear() })

  test('returns a parsed summary for oxe-cc >= 1.13', async () => {
    h.runs = [
      { stdout: 'oxe-cc v1.14.0', code: 0 }, // detect
      { stdout: '{"oxeSummarySchema":1,"phase":"execute","healthStatus":"warning","cursorCmd":"/oxe-execute","agentSkills":[{"agent":"copilot-cli","skillsInstalled":false}]}', code: 0 }
    ]
    const result = await new OxeService().statusSummary('C:/repo')
    expect(result.supportsSummary).toBe(true)
    expect(result.summary?.oxeSummarySchema).toBe(1)
    expect(result.summary?.cursorCmd).toBe('/oxe-execute')
    expect(result.summary?.agentSkills?.[0]).toEqual({ agent: 'copilot-cli', skillsInstalled: false })
  })

  test('does not attempt --summary on oxe-cc < 1.13 (graceful degradation)', async () => {
    h.runs = [{ stdout: 'oxe-cc v1.12.0', code: 0 }] // only detect
    const result = await new OxeService().statusSummary('C:/repo')
    expect(result.supportsSummary).toBe(false)
    expect(result.summary).toBeNull()
    // Only `oxe --version` ran — no `status --summary` spawn.
    expect(h.spawnMock).toHaveBeenCalledTimes(1)
  })

  test('treats a missing oxeSummarySchema as unsupported', async () => {
    h.runs = [
      { stdout: 'oxe-cc v1.14.0', code: 0 },
      { stdout: '{"phase":"plan"}', code: 0 } // no schema field
    ]
    const result = await new OxeService().statusSummary('C:/repo')
    expect(result.supportsSummary).toBe(false)
    expect(result.summary).toBeNull()
  })
})

describe('OxeService.watchEvents', () => {
  beforeEach(() => { h.oxeDirExists = true })

  test('fires the change callback (debounced) on a .oxe change', async () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const fsMod = await import('node:fs')
    let fired: (() => void) | undefined
    ;(fsMod.watch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce((_dir: string, _opts: unknown, cb: () => void) => {
      fired = cb
      return { on: vi.fn(), close: vi.fn() }
    })
    const svc = new OxeService(onChange)
    svc.watchEvents('C:/repo')
    fired?.()
    fired?.() // debounced — still one callback
    vi.advanceTimersByTime(600)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('C:/repo')
    svc.disposeAll()
    vi.useRealTimers()
  })
})
