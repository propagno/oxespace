import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────
// The service spawns a child process and touches the filesystem + electron
// app paths. None of that is available (or desirable) under vitest, so we
// stub the boundaries and drive the child's stdout/stderr deterministically.
// State lives in vi.hoisted so the (hoisted) vi.mock factories can read it.

const h = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  nextRun: { current: {} as { stdout?: string; stderr?: string; code?: number } },
  fsState: { exists: true, size: 200_000_000 }
}))

vi.mock('node:child_process', () => {
  const mkEmitter = () => {
    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
    return {
      setEncoding: () => undefined,
      on(event: string, cb: (...args: unknown[]) => void) { (handlers[event] ??= []).push(cb) },
      emit(event: string, ...args: unknown[]) { (handlers[event] ?? []).forEach((f) => f(...args)) }
    }
  }
  h.spawnMock.mockImplementation(() => {
    const stdout = mkEmitter()
    const stderr = mkEmitter()
    const child = mkEmitter() as ReturnType<typeof mkEmitter> & { stdout: unknown; stderr: unknown }
    child.stdout = stdout
    child.stderr = stderr
    setImmediate(() => {
      if (h.nextRun.current.stdout) stdout.emit('data', h.nextRun.current.stdout)
      if (h.nextRun.current.stderr) stderr.emit('data', h.nextRun.current.stderr)
      child.emit('close', h.nextRun.current.code ?? 0)
    })
    return child
  })
  return { spawn: h.spawnMock, default: { spawn: h.spawnMock } }
})

vi.mock('node:fs', () => {
  const api = {
    existsSync: vi.fn(() => h.fsState.exists),
    statSync: vi.fn(() => ({ size: h.fsState.size })),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
    renameSync: vi.fn(),
    createWriteStream: vi.fn()
  }
  return { ...api, default: api }
})

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/userdata', getAppPath: () => process.cwd() }
}))

const { spawnMock, nextRun, fsState } = h

import { VoiceService } from '../../electron/main/services/voice.service'

describe('VoiceService.getModelStatus', () => {
  beforeEach(() => { fsState.exists = true; fsState.size = 200_000_000 })

  test('reports ready when binary + model are present and plausibly sized', () => {
    const status = new VoiceService().getModelStatus('base')
    expect(status.engineReady).toBe(true)
    expect(status.ready).toBe(true)
    expect(status.path).toContain('ggml-base.bin')
  })

  test('reports not-ready when the model file is implausibly small', () => {
    fsState.size = 1024
    const status = new VoiceService().getModelStatus('base')
    expect(status.ready).toBe(false)
  })
})

describe('VoiceService.transcribe', () => {
  beforeEach(() => {
    fsState.exists = true
    fsState.size = 200_000_000
    spawnMock.mockClear()
    nextRun.current = {}
  })
  afterEach(() => vi.clearAllMocks())

  test('returns the cleaned stdout text and pins the language to pt', async () => {
    nextRun.current = {
      stdout: '\n Olá, tudo bem com você?\n',
      stderr: '',
      code: 0
    }
    const res = await new VoiceService().transcribe(new Uint8Array([1, 2, 3]), { modelSize: 'base' })
    expect(res.text).toBe('Olá, tudo bem com você?')
    expect(res.language).toBe('pt')
    expect(res.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('forces -l pt + a pt-BR prompt even when another language is requested', async () => {
    nextRun.current = { stdout: 'oi', code: 0 }
    // Requesting 'auto'/'en' must be ignored — OXEVoice is pt-BR only.
    await new VoiceService().transcribe(new Uint8Array([1]), { language: 'en', modelSize: 'base' })
    const args = spawnMock.mock.calls[0][1] as string[]
    expect(args).toContain('-m')
    expect(args).toContain('-f')
    expect(args[args.indexOf('-l') + 1]).toBe('pt')
    expect(args).toContain('--prompt')
    expect(args).not.toContain('auto')
    expect(args).not.toContain('-tr')
    expect(args).not.toContain('--translate')
    expect(args).toContain('-nt')
    expect(args).toContain('-np')
  })

  test('rejects when the engine exits non-zero', async () => {
    nextRun.current = { stderr: 'fatal: bad model', code: 1 }
    await expect(new VoiceService().transcribe(new Uint8Array([1]), { modelSize: 'base' })).rejects.toThrow(/bad model/)
  })

  test('throws an actionable error when the model is missing', async () => {
    fsState.size = 10 // engine present, model too small → not ready
    await expect(new VoiceService().transcribe(new Uint8Array([1]), { modelSize: 'base' })).rejects.toThrow(/not ready/)
  })
})
