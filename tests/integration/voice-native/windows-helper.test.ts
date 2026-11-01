/**
 * OxeVoice F1 · A4 — frozen acceptance test (written by the plan, before execution; do not edit).
 * The Windows engine drives a PowerShell 5.1 helper (WinRT speech) as a child process. Coordinator rules (D-05):
 * fixed arguments (`-NoProfile -NonInteractive -ExecutionPolicy Bypass -File <script>`, never `-EncodedCommand`),
 * an environment without OXESPACE_* or secrets, an idle timeout, and the whole process tree terminated on stop,
 * cancel, idle, crash and dispose. Exactly one `ended` per session.
 */
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWindowsWinrtEngine, sanitizeHelperEnv, windowsHelperArgs } from '../../../electron/main/services/voice/windows-helper'
import type { VoiceEngineEvent } from '../../../electron/main/services/voice/types'

const SCRIPT = 'C:\\app\\resources\\voice\\windows-dictation.ps1'

class FakeChild extends EventEmitter {
  pid = 4242
  stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  stdin = { write: vi.fn(), end: vi.fn() }
  kill = vi.fn()
  exitCode: number | null = null
  say(message: unknown) { this.stdout.emit('data', `${JSON.stringify(message)}\n`) }
  exit(code: number) { this.exitCode = code; this.emit('exit', code, null); this.emit('close', code, null) }
}

function setup(options: { idleTimeoutMs?: number; stopGraceMs?: number } = {}) {
  const children: FakeChild[] = []
  const spawn = vi.fn(() => { const child = new FakeChild(); children.push(child); return child })
  const killTree = vi.fn()
  const env = { SystemRoot: 'C:\\Windows', Path: 'C:\\Windows\\System32', OXESPACE_ROOT: 'x', OXESPACE_DB_PATH: 'y', GITHUB_TOKEN: 'ghp_x', ANTHROPIC_API_KEY: 'k', MY_SECRET: 's', DB_PASSWORD: 'p' }
  const engine = createWindowsWinrtEngine({ spawn: spawn as never, scriptPath: SCRIPT, killTree, env, ...options })
  const events: VoiceEngineEvent[] = []
  const listen = (language = 'pt-BR') => engine.start({ sessionId: 's1', language }, event => events.push(event))
  return { engine, spawn, killTree, children, events, listen, child: () => children[children.length - 1] }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('windows helper process (A4)', () => {
  it('is the os-cloud windows-winrt engine', () => {
    const { engine } = setup()
    expect(engine).toMatchObject({ id: 'windows-winrt', privacy: 'os-cloud', platforms: ['win32'] })
  })

  it('spawns powershell with fixed arguments and a scrubbed environment', () => {
    expect(windowsHelperArgs(SCRIPT, 'listen', 'pt-BR')).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Mode', 'listen', '-Language', 'pt-BR'])
    expect(windowsHelperArgs(SCRIPT, 'probe')).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Mode', 'probe'])

    const { spawn, listen } = setup()
    listen()
    const [command, args, options] = spawn.mock.calls[0] as unknown as [string, string[], { env: Record<string, string>; windowsHide?: boolean; shell?: boolean }]
    expect(command.toLowerCase()).toMatch(/powershell(\.exe)?$/)
    expect(args).toEqual(windowsHelperArgs(SCRIPT, 'listen', 'pt-BR'))
    expect(args.some(arg => /^-(EncodedCommand|enc|e|Command|c)$/i.test(arg))).toBe(false)
    expect(options.windowsHide).toBe(true)
    expect(options.shell).toBeFalsy()
    expect(options.env).toMatchObject({ SystemRoot: 'C:\\Windows', Path: 'C:\\Windows\\System32' })
    for (const key of ['OXESPACE_ROOT', 'OXESPACE_DB_PATH', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'MY_SECRET', 'DB_PASSWORD']) expect(options.env).not.toHaveProperty(key)
  })

  it('refuses a language that is not a BCP-47 tag (nothing reaches the command line)', () => {
    const { listen, spawn, events } = setup()
    expect(() => listen('pt-BR; Remove-Item C:\\')).toThrow()
    expect(spawn).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })

  it('sanitizeHelperEnv keeps what PowerShell needs and drops OXESPACE_* and secrets', () => {
    const clean = sanitizeHelperEnv({ SystemRoot: 'C:\\Windows', TEMP: 'C:\\t', OXESPACE_X: '1', SOME_TOKEN: 'a', aws_secret_access_key: 'b' })
    expect(clean).toEqual({ SystemRoot: 'C:\\Windows', TEMP: 'C:\\t' })
  })

  it('maps helper lines to engine events and ignores lines that fail the schema', () => {
    const { listen, child, events } = setup()
    listen()
    child().say({ type: 'listening' })
    child().stdout.emit('data', 'garbage line\n')
    child().say({ type: 'exec', command: 'calc' })
    child().say({ type: 'partial', text: 'olá' })
    child().say({ type: 'final', text: 'olá mundo' })
    expect(events).toEqual([{ type: 'listening' }, { type: 'partial', text: 'olá' }, { type: 'final', text: 'olá mundo' }])
  })

  it('stop asks the helper to finish, then kills the tree after the grace period', () => {
    const { listen, child, killTree, events } = setup({ stopGraceMs: 2000 })
    const session = listen()
    session.stop()
    expect(child().stdin.write).toHaveBeenCalledWith('stop\n')
    expect(killTree).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2001)
    expect(killTree).toHaveBeenCalledWith(4242)
    child().exit(1)
    expect(events.filter(e => e.type === 'ended')).toEqual([{ type: 'ended', reason: 'stopped' }])
  })

  it('a helper that finishes on stop ends as stopped without being killed', () => {
    const { listen, child, killTree, events } = setup({ stopGraceMs: 2000 })
    const session = listen()
    session.stop()
    child().say({ type: 'final', text: 'fim' })
    child().say({ type: 'ended' })
    child().exit(0)
    vi.advanceTimersByTime(5000)
    expect(killTree).not.toHaveBeenCalled()
    expect(events).toEqual([{ type: 'final', text: 'fim' }, { type: 'ended', reason: 'stopped' }])
  })

  it('cancel kills the tree at once and ends exactly once', () => {
    const { listen, child, killTree, events } = setup()
    const session = listen()
    session.cancel()
    expect(killTree).toHaveBeenCalledWith(4242)
    child().exit(1)
    session.cancel()
    expect(events.filter(e => e.type === 'ended')).toEqual([{ type: 'ended', reason: 'cancelled' }])
  })

  it('idle timeout: no speech for the limit kills the tree; speech resets the clock', () => {
    const { listen, child, killTree, events } = setup({ idleTimeoutMs: 10_000 })
    listen()
    child().say({ type: 'listening' })
    vi.advanceTimersByTime(8_000)
    child().say({ type: 'partial', text: 'a' })
    vi.advanceTimersByTime(8_000)
    expect(killTree).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2_500)
    expect(killTree).toHaveBeenCalledWith(4242)
    child().exit(1)
    expect(events.filter(e => e.type === 'ended')).toEqual([{ type: 'ended', reason: 'idle' }])
  })

  it('the OS speech privacy setting being off (0x80045509) becomes voice.os.speechPrivacyOff', () => {
    const { listen, child, events } = setup()
    listen()
    child().say({ type: 'error', hresult: '0x80045509' })
    child().exit(1)
    expect(events).toEqual([
      { type: 'error', message: { code: 'voice.os.speechPrivacyOff', params: {} } },
      { type: 'ended', reason: 'error' }
    ])
  })

  it('an unknown HRESULT becomes voice.engine.failed with the code; a crash becomes voice.engine.crashed', () => {
    const a = setup()
    a.listen()
    a.child().say({ type: 'error', hresult: '0x80004005' })
    a.child().exit(1)
    expect(a.events).toEqual([
      { type: 'error', message: { code: 'voice.engine.failed', params: { hresult: '0x80004005' } } },
      { type: 'ended', reason: 'error' }
    ])

    const b = setup()
    b.listen()
    b.child().say({ type: 'listening' })
    b.child().exit(3)
    expect(b.events).toEqual([
      { type: 'listening' },
      { type: 'error', message: { code: 'voice.engine.crashed', params: { exitCode: 3 } } },
      { type: 'ended', reason: 'error' }
    ])
  })

  it('probe runs the helper in probe mode and reads its capabilities', async () => {
    const { engine, spawn, children } = setup()
    const probing = engine.probe()
    expect((spawn.mock.calls[0] as unknown as [string, string[]])[1]).toEqual(windowsHelperArgs(SCRIPT, 'probe'))
    children[0].say({ type: 'probe', available: true, languages: ['pt-BR'], systemLanguage: 'pt-BR' })
    children[0].exit(0)
    await expect(probing).resolves.toEqual({ available: true, languages: ['pt-BR'], reason: null })
  })

  it('a probe that never answers is unavailable (engine-error) and its tree is killed', async () => {
    const { engine, killTree } = setup()
    const probing = engine.probe()
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(probing).resolves.toEqual({ available: false, languages: [], reason: 'engine-error' })
    expect(killTree).toHaveBeenCalledWith(4242)
  })

  it('dispose kills every live helper tree', () => {
    const { engine, listen, killTree } = setup()
    listen()
    engine.dispose?.()
    expect(killTree).toHaveBeenCalledWith(4242)
  })
})
