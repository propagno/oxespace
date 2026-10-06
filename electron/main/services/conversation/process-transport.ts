import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, extname, join } from 'node:path'
import type { ConversationTransport } from './codex-conversation'
import { recordRuntime, type RuntimeDetail } from '../runtime-diagnostics'

/** Thread subscription processes share a native account, never an API env key. */
export function subscriptionEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([key]) =>
    !key.toUpperCase().startsWith('OXESPACE_') && ![
      'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
      'CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'CLAUDE_CODE_OAUTH_SCOPES',
      'OPENAI_API_KEY', 'OPENAI_ACCESS_TOKEN', 'CODEX_ACCESS_TOKEN',
      'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
      'ANTHROPIC_PROFILE', 'ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID',
      'ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL'
    ].includes(key.toUpperCase())))
}

/** Resolve without shell interpolation; npm Windows shims use their JS entry. */
export function conversationCommand(command: string, args: string[], env: NodeJS.ProcessEnv = process.env,
  platform = process.platform): { executable: string; args: string[]; env: NodeJS.ProcessEnv } {
  if (!command || /[\r\n\0]/.test(command)) throw new Error('Invalid agent executable')
  command = command.replace(/^"(.*)"$/, '$1')
  const paths = command.includes('/') || command.includes('\\') ? [command] :
    (env.PATH ?? env.Path ?? '').split(delimiter).flatMap(path =>
      platform === 'win32' && !extname(command) ? [join(path, command + '.exe'), join(path, command + '.cmd'), join(path, command)] : [join(path, command)])
  const executable = paths.find(path => existsSync(path))
  if (!executable) throw new Error('Agent executable was not found')
  if (platform === 'win32' && ['.cmd', '.ps1', '.bat'].includes(extname(executable).toLowerCase())) {
    const entry = join(dirname(executable), 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    if (!existsSync(entry) || !/^codex\.(cmd|ps1|bat)$/i.test(executable.split(/[\\/]/).at(-1) ?? '')) {
      throw new Error('Configure a native agent executable; arbitrary shell scripts are not supported for Thread')
    }
    return { executable: process.execPath, args: [entry, ...args], env: { ...env, ELECTRON_RUN_AS_NODE: '1' } }
  }
  return { executable, args, env }
}

/** Launch Codex directly: its npm shim spawns a child without windowsHide. */
export function interactiveConversationCommand(command: string, args: string[], env: NodeJS.ProcessEnv = process.env,
  platform = process.platform): ReturnType<typeof conversationCommand> {
  const resolved = conversationCommand(command, args, env, platform)
  if (platform !== 'win32' || resolved.executable !== process.execPath || !/[/\\]@openai[/\\]codex[/\\]bin[/\\]codex\.js$/i.test(resolved.args[0] ?? '')) return resolved
  const entry = resolved.args[0]
  const packageRoot = dirname(dirname(entry))
  const target = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
  const platformPackage = process.arch === 'arm64' ? '@openai/codex-win32-arm64' : '@openai/codex-win32-x64'
  let vendor = join(packageRoot, 'vendor')
  try { vendor = join(dirname(createRequire(entry).resolve(`${platformPackage}/package.json`)), 'vendor') } catch { /* older bundled npm package */ }
  const executable = [join(vendor, target, 'bin', 'codex.exe'), join(vendor, target, 'codex', 'codex.exe')].find(existsSync)
  if (!executable) throw Error('The installed Codex native executable is unavailable. Reinstall Codex or configure codex.exe in Agent Settings.')
  const nativeEnv = { ...env }
  delete nativeEnv.ELECTRON_RUN_AS_NODE
  return { executable, args, env: nativeEnv }
}

export class AgentProcessTransport implements ConversationTransport {
  private readonly child: ChildProcessWithoutNullStreams
  private closed = false
  private closeListener: () => void = () => {}
  private dataListener: (chunk: Uint8Array) => void = () => {}
  private diagnosticListener: (chunk: Uint8Array) => void = () => {}

  get exitCode(): number | null { return this.child.exitCode }

  constructor(command: string, args: string[], cwd: string, mcpEnvironment: Record<string, string> = {}, private readonly diagnosticContext: RuntimeDetail = {}) {
    const env = subscriptionEnvironment()
    // Only main may supply a fresh project-bound MCP lease. Never restore the
    // parent's OXESPACE context or provider/API credentials.
    for (const key of ['OXESPACE_MCP_PORT', 'OXESPACE_MCP_TOKEN', 'OXESPACE_WORKSPACE_ID', 'OXESPACE_MEMORY_RUN_ID',
      'OXESPACE_EXECUTION_ID', 'OXESPACE_EXECUTION_TOKEN', 'OXESPACE_EXECUTION_GENERATION']) {
      if (mcpEnvironment[key]) env[key] = mcpEnvironment[key]
    }
    const resolved = interactiveConversationCommand(command, args, env)
    this.child = spawn(resolved.executable, resolved.args, { cwd, env: resolved.env, windowsHide: true, stdio: 'pipe',
      detached: process.platform !== 'win32' })
    const startedAt = Date.now()
    this.child.once('spawn', () => recordRuntime('process-start', { ...diagnosticContext, kind: 'thread', pid: this.child.pid, parentPid: process.pid, executable: resolved.executable }))
    this.child.stdout.on('data', (chunk: Buffer) => this.dataListener(chunk))
    // Consume stderr without retaining potentially sensitive provider diagnostics.
    this.child.stderr.on('data', (chunk: Buffer) => this.diagnosticListener(chunk))
    this.child.stdin.on('error', () => this.end())
    this.child.on('error', () => { recordRuntime('process-error', { ...diagnosticContext, pid: this.child.pid, state: 'failed' }); this.end() })
    this.child.on('close', (code) => {
      recordRuntime('process-exit', { ...diagnosticContext, pid: this.child.pid, exitCode: code ?? undefined, durationMs: Date.now() - startedAt })
      this.end()
    })
  }

  write(line: string): void {
    if (this.closed || this.child.stdin.destroyed) throw new Error('Agent process is closed')
    if (this.child.stdin.writableLength > 1024 * 1024) throw new Error('Agent input queue is full')
    this.child.stdin.write(line)
  }
  onData(listener: (chunk: Uint8Array) => void): void { this.dataListener = listener }
  onDiagnostic(listener: (chunk: Uint8Array) => void): void { this.diagnosticListener = listener }
  endInput(): void { this.child.stdin.end() }
  onClose(listener: () => void): void {
    this.closeListener = listener
    if (this.closed) queueMicrotask(listener)
  }

  async close(): Promise<void> {
    const pid = this.child.pid
    if (!pid || this.child.exitCode !== null) { this.end(); return }
    recordRuntime('process-stop', { ...this.diagnosticContext, pid })
    this.child.stdin.end()
    if (process.platform === 'win32') {
      await new Promise<void>(resolve => execFile('taskkill.exe', ['/pid', String(pid), '/T', '/F'],
        { windowsHide: true, timeout: 3000 }, () => resolve()))
    } else {
      try { process.kill(-pid, 'SIGTERM') } catch { /* already exited */ }
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { try { process.kill(-pid, 'SIGKILL') } catch { /* exited */ } resolve() }, 500)
        this.child.once('close', () => { clearTimeout(timer); resolve() })
      })
    }
    this.end()
  }

  private end(): void {
    if (this.closed) return
    this.closed = true
    this.closeListener()
  }
}
