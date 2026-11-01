/**
 * OxeVoice 1.5 · Windows engine. Drives a PowerShell 5.1 helper (WinRT speech) as a child process.
 * Rules: fixed arguments (never -EncodedCommand/-Command), no shell, a scrubbed environment, an idle timeout,
 * and the whole process tree terminated on stop-timeout, cancel, idle, crash and dispose.
 * Exactly one `ended` per session.
 */
import { spawn as nodeSpawn, spawnSync } from 'node:child_process'
import { createLineSplitter, parseHelperLine } from './protocol'
import type { HelperMessage } from './protocol'
import type {
  VoiceEngine,
  VoiceEngineEvent,
  VoiceEngineSession,
  VoiceEngineStartOptions,
  VoiceProbeResult
} from './types'

export type HelperMode = 'probe' | 'listen'

const BCP47_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/
const OXESPACE_RE = /^OXESPACE_/i
const SECRET_KEY_RE = /TOKEN|SECRET|PASSWORD|API_KEY|_KEY|CREDENTIAL/i
const SPEECH_PRIVACY_OFF = '0x80045509'

const UNAVAILABLE: VoiceProbeResult = { available: false, languages: [], reason: 'engine-error' }

export function windowsHelperArgs(scriptPath: string, mode: HelperMode, language?: string): string[] {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Mode', mode]
  if (language !== undefined) {
    if (!BCP47_RE.test(language)) throw new Error('invalid language tag')
    args.push('-Language', language)
  }
  return args
}

export function sanitizeHelperEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (OXESPACE_RE.test(key) || SECRET_KEY_RE.test(key)) continue
    clean[key] = value
  }
  return clean
}

export function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } catch {
      /* best effort */
    }
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }
}

export interface WindowsWinrtEngineOptions {
  spawn?: typeof nodeSpawn
  scriptPath: string
  killTree?: (pid: number) => void
  env?: NodeJS.ProcessEnv
  idleTimeoutMs?: number
  stopGraceMs?: number
  probeTimeoutMs?: number
  powershellPath?: string
}

interface LiveEntry {
  abort(): void
}

export function createWindowsWinrtEngine(options: WindowsWinrtEngineOptions): VoiceEngine {
  const {
    spawn = nodeSpawn,
    scriptPath,
    killTree = killProcessTree,
    env = process.env,
    idleTimeoutMs = 30000,
    stopGraceMs = 3000,
    probeTimeoutMs = 15000,
    powershellPath = 'powershell.exe'
  } = options

  const live = new Set<LiveEntry>()

  function launch(mode: HelperMode, language?: string) {
    const args = windowsHelperArgs(scriptPath, mode, language) // validates the language before any spawn
    const child = spawn(powershellPath, args, {
      windowsHide: true,
      env: sanitizeHelperEnv(env),
      stdio: ['pipe', 'pipe', 'pipe']
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', () => {})
    return child
  }

  function probe(): Promise<VoiceProbeResult> {
    return new Promise<VoiceProbeResult>(resolve => {
      let child: ReturnType<typeof launch>
      try {
        child = launch('probe')
      } catch {
        resolve(UNAVAILABLE)
        return
      }
      let settled = false
      let result: VoiceProbeResult | null = null
      const kill = (): void => {
        if (child.pid !== undefined) killTree(child.pid)
      }
      const entry: LiveEntry = {
        abort: () => {
          kill()
          settle(UNAVAILABLE)
        }
      }
      const timer = setTimeout(() => {
        kill()
        settle(UNAVAILABLE)
      }, probeTimeoutMs)
      function settle(value: VoiceProbeResult): void {
        if (settled) return
        settled = true
        clearTimeout(timer)
        live.delete(entry)
        resolve(value)
      }
      live.add(entry)

      const splitter = createLineSplitter(line => {
        const parsed = parseHelperLine(line)
        if (!parsed.ok || parsed.message.type !== 'probe') return
        const message = parsed.message
        result =
          message.available && message.languages.length > 0
            ? { available: true, languages: message.languages, reason: null }
            : UNAVAILABLE
      })
      child.stdout.on('data', chunk => splitter.push(String(chunk)))
      child.on('exit', () => {
        splitter.flush()
        settle(result ?? UNAVAILABLE)
      })
      child.on('error', () => settle(UNAVAILABLE))
    })
  }

  function start(startOptions: VoiceEngineStartOptions, emit: (event: VoiceEngineEvent) => void): VoiceEngineSession {
    const child = launch('listen', startOptions.language)

    let done = false
    let stopping = false
    let errorSeen = false
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let graceTimer: ReturnType<typeof setTimeout> | undefined

    const kill = (): void => {
      if (child.pid !== undefined) killTree(child.pid)
    }
    const send = (event: VoiceEngineEvent): void => {
      if (!done) emit(event)
    }
    const entry: LiveEntry = {
      abort: () => {
        if (done) return
        kill()
        finish('cancelled')
      }
    }
    function finish(reason: 'stopped' | 'cancelled' | 'idle' | 'error'): void {
      if (done) return
      clearTimeout(idleTimer)
      clearTimeout(graceTimer)
      emit({ type: 'ended', reason } as VoiceEngineEvent)
      done = true
      live.delete(entry)
    }
    const armIdle = (): void => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        if (done) return
        kill()
        finish('idle')
      }, idleTimeoutMs)
    }

    live.add(entry)
    armIdle()

    const handle = (message: HelperMessage): void => {
      switch (message.type) {
        case 'listening':
          send({ type: 'listening' })
          break
        case 'partial':
          armIdle()
          send({ type: 'partial', text: message.text })
          break
        case 'final':
          armIdle()
          send({ type: 'final', text: message.text })
          break
        case 'error':
          errorSeen = true
          if (message.hresult.toLowerCase() === SPEECH_PRIVACY_OFF) {
            send({ type: 'error', message: { code: 'voice.os.speechPrivacyOff', params: {} } } as VoiceEngineEvent)
          } else {
            send({
              type: 'error',
              message: { code: 'voice.engine.failed', params: { hresult: message.hresult } }
            } as VoiceEngineEvent)
          }
          break
        default:
          // 'ended' and 'probe': the exit of the process is the source of truth.
          break
      }
    }

    const splitter = createLineSplitter(line => {
      if (done) return
      const parsed = parseHelperLine(line)
      if (parsed.ok) handle(parsed.message)
    })
    child.stdout.on('data', chunk => splitter.push(String(chunk)))

    child.on('exit', code => {
      splitter.flush()
      if (done) return
      if (errorSeen) {
        finish('error')
      } else if (stopping) {
        finish('stopped')
      } else {
        send({
          type: 'error',
          message: { code: 'voice.engine.crashed', params: { exitCode: code ?? -1 } }
        } as VoiceEngineEvent)
        finish('error')
      }
    })
    child.on('error', () => {
      if (done) return
      send({
        type: 'error',
        message: { code: 'voice.engine.crashed', params: { exitCode: -1 } }
      } as VoiceEngineEvent)
      finish('error')
    })

    return {
      stop(): void {
        if (done || stopping) return
        stopping = true
        try {
          child.stdin.write('stop\n')
        } catch {
          /* the grace timer covers a dead pipe */
        }
        graceTimer = setTimeout(() => {
          if (done) return
          kill()
          finish('stopped')
        }, stopGraceMs)
      },
      cancel(): void {
        if (done) return
        kill()
        finish('cancelled')
      }
    }
  }

  return {
    id: 'windows-winrt',
    privacy: 'os-cloud',
    platforms: ['win32'],
    probe,
    start,
    dispose(): void {
      for (const entry of [...live]) entry.abort()
    }
  }
}
