import { spawn, type IPty, type IPtyForkOptions } from 'node-pty'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { ConversationThread, ThreadCliState } from '../../../../shared/types/thread'
import type { TerminalAttachResult, TerminalDataEvent, TerminalExitEvent } from '../../../../shared/types/ipc'
import { interactiveConversationCommand, subscriptionEnvironment } from './process-transport'
import { PtyInputQueue } from '../pty-input-queue'
import { PtyOutputBatcher } from '../pty-output-batcher'
import { PtyRingBuffer } from '../pty-ring-buffer'
import { PtyModeTracker } from '../pty-mode-tracker'
import { NativeSessionReader } from './native-session-history'

export interface NativeCliSession {
  state(): ThreadCliState
  write(data: string): Promise<void>
  resize(cols: number, rows: number): void
  attach(): TerminalAttachResult
  detach(): void
  insertCommand(): Promise<void>
  linkSession(id: string): Promise<void>
  close(): Promise<void>
}
interface Options {
  historyReader?: { read(thread: ConversationThread, id: string, cursor?: ConversationThread['nativeHistoryCursor']): Promise<import('./native-session-history').NativeSessionHistory>; close(): Promise<void> }
  spawn?: (file: string, args: string[], options: IPtyForkOptions) => IPty
  resolve?: typeof interactiveConversationCommand
  env?: NodeJS.ProcessEnv
  data(event: TerminalDataEvent): void
  exit(event: TerminalExitEvent): void
}
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** The actual installed TUI, with native selectors, confirmations and approvals.
 * It never shares a Code pane or starts a shell. ThreadManager owns the lease. */
export class ThreadNativeCli {
  constructor(private readonly executable: (thread: ConversationThread) => string, private readonly options: Options) {}

  read(thread: ConversationThread, id: string, cursor?: ConversationThread['nativeHistoryCursor']) { return this.options.historyReader ? this.options.historyReader.read(thread, id, cursor) : new NativeSessionReader(this.executable).read(thread, id, cursor) }

  async closeHistoryReader(): Promise<void> { await this.options.historyReader?.close() }

  async open(thread: ConversationThread, command: string | undefined, ended: (nativeSessionId: string | null, interrupted?: boolean) => Promise<void>): Promise<NativeCliSession> {
    if (!existsSync(thread.rootPath)) throw Error('Thread directory is unavailable; check its location before opening the CLI')
    const commandPattern = thread.provider === 'codex' ? /^[/$][a-z0-9][a-z0-9_:-]*(?:\s[\s\S]*)?$/i : /^\/[a-z0-9][a-z0-9_:-]*(?:\s[\s\S]*)?$/i
    if (command && (!commandPattern.test(command) || /[\0\x1b]/.test(command) || Buffer.byteLength(command) > 65536)) throw Error('Invalid native CLI command input')
    if (thread.nativeSessionId && !new RegExp(`^${UUID}$`, 'i').test(thread.nativeSessionId)) throw Error('Invalid native conversation identifier')
    let nativeSessionId = thread.nativeSessionId
    const args = thread.provider === 'claude'
      ? [...(nativeSessionId ? ['--resume', nativeSessionId] : ['--session-id', nativeSessionId = randomUUID()]), ...(thread.model ? ['--model', thread.model] : [])]
      : [...(nativeSessionId ? ['resume', nativeSessionId] : []), '--no-alt-screen', ...(thread.model ? ['--model', thread.model] : []), ...(thread.reasoningEffort ? ['-c', `model_reasoning_effort=${JSON.stringify(thread.reasoningEffort)}`] : []), '-c', 'model_provider="openai"', '-c', 'forced_login_method="chatgpt"']
    const resolved = (this.options.resolve ?? interactiveConversationCommand)(this.executable(thread), args, subscriptionEnvironment(this.options.env))
    const pty = (this.options.spawn ?? spawn)(resolved.executable, resolved.args, {
      name: 'xterm-256color', cwd: thread.rootPath, cols: 100, rows: 28,
      ...(process.platform === 'win32' ? { useConpty: true, useConptyDll: true } : {}),
      env: { ...resolved.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', COLORFGBG: '15;0' }
    })
    const queue = new PtyInputQueue(pty), ring = new PtyRingBuffer(), modes = new PtyModeTracker()
    let running = true, attached = false, pendingCommand = command, closing: Promise<void> | undefined, finishing: Promise<void> | undefined
    let cols = 100, rows = 28, linked = false
    // Only a bounded, ephemeral suffix is inspected for the explicit resume ID.
    // No provider output, credentials or native transcript is written to app storage.
    let suffix = ''
    const batcher = new PtyOutputBatcher(thread.id, event => {
      ring.push(event.data); modes.consume(event.data)
      if (attached) this.options.data(event)
    })
    const subscription = pty.onData(data => {
      batcher.push(data)
      suffix = (suffix + data).slice(-16384)
      const plain = suffix.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      const prefix = thread.provider === 'codex' ? 'To continue this session, run\\s+codex resume ' : 'Resume this session with:?\\s+claude(?:\\.exe)? (?:--resume|-r) '
      const ids = [...plain.matchAll(new RegExp(`${prefix}(${UUID})`, 'gi'))]
      if (ids.length && !linked) nativeSessionId = ids.at(-1)![1]
    })
    const finish = (exitCode: number | null): Promise<void> => {
      if (finishing) return finishing
      running = false; batcher.flush(); queue.dispose(); suffix = ''
      return finishing = ended(nativeSessionId, exitCode !== 0).catch(() => {}).then(() => this.options.exit({ paneId: thread.id, exitCode }))
    }
    const exitSubscription = pty.onExit(({ exitCode }) => finish(exitCode))
    return {
      state: () => ({ running, nativeSessionId, ...(pendingCommand ? { pendingCommand } : {}) }),
      write: async data => { if (running) await queue.enqueue(data) },
      resize: (width, height) => { cols = width; rows = height; if (running) pty.resize(cols, rows) },
      attach: () => {
        batcher.flush(); attached = true
        if (running && modes.altScreen) { try { pty.resize(cols, rows - 1); pty.resize(cols, rows) } catch { /* exit */ } }
        return { running, seq: ring.seq, prologue: modes.prologue(), replay: modes.altScreen && running ? '' : ring.snapshot(), truncated: false, altScreen: modes.altScreen,
          ...(!running ? { exit: { exitCode: null, at: Date.now() } } : {}) }
      },
      detach: () => { batcher.flush(); attached = false },
      // Explicit insertion, without Enter: startup/login/trust menus cannot
      // accidentally receive a submitted slash command or confirmation.
      insertCommand: async () => {
        if (!running || !pendingCommand) return
        await queue.enqueue(`\x1b[200~${pendingCommand}\x1b[201~`)
        pendingCommand = undefined
      },
      linkSession: async id => { await this.read(thread, id); nativeSessionId = id; linked = true },
      close: () => closing ??= (async () => {
        if (running) {
          // Let the provider flush its own session before closing ConPTY.
          try { pty.write('\x03') } catch { /* exit */ }
          await new Promise<void>(resolve => setTimeout(resolve, 150))
          if (running) {
            try { pty.write('\x03') } catch { /* exit */ }
            await new Promise<void>(resolve => setTimeout(resolve, 750))
          }
          if (running) {
            try { pty.kill() } catch { /* already exited */ }
            await new Promise<void>(resolve => setTimeout(resolve, 250))
            if (running && process.platform === 'win32') await new Promise<void>(resolve => execFile('taskkill.exe', ['/pid', String(pty.pid), '/T', '/F'], { windowsHide: true, timeout: 3000 }, () => resolve()))
            if (running) await finish(null)
          }
        }
        await finishing
        subscription.dispose(); exitSubscription.dispose(); batcher.dispose(); queue.dispose(); ring.clear()
      })()
    }
  }
}
