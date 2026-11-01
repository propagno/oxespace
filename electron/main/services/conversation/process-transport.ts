import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, extname, join, resolve as resolvePath } from 'node:path'
import type { ConversationTransport } from './codex-conversation'
import { recordRuntime, type RuntimeDetail } from '../runtime-diagnostics'
import { recordIncident } from '../diagnostics/incident-sink'
import { MainRefusal } from '../main-refusal'
import { killProcessTree } from '../../utils/process-tree'

/** Thread subscription processes share a native account, never an API env key. */
export function subscriptionEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([key]) =>
    !key.toUpperCase().startsWith('OXESPACE_') && !key.toUpperCase().startsWith('AI_MEMORY_') && ![
      'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
      'CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'CLAUDE_CODE_OAUTH_SCOPES',
      'OPENAI_API_KEY', 'OPENAI_ACCESS_TOKEN', 'CODEX_ACCESS_TOKEN',
      'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
      'ANTHROPIC_PROFILE', 'ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID',
      'ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL'
    ].includes(key.toUpperCase())))
}

/**
 * Resolve without shell interpolation. An npm Windows shim of Codex (`codex.cmd`) resolves to the native `codex.exe`
 * its package ships, never to `process.execPath` with ELECTRON_RUN_AS_NODE: the packaged app has the RunAsNode fuse
 * off (B13), and the shim itself spawns a child without windowsHide. No result carries ELECTRON_RUN_AS_NODE.
 */
export function conversationCommand(command: string, args: string[], env: NodeJS.ProcessEnv = process.env,
  platform = process.platform, arch = process.arch,
  appExecutable: string | undefined = process.versions.electron ? process.execPath : undefined): { executable: string; args: string[]; env: NodeJS.ProcessEnv } {
  if (!command || /[\r\n\0]/.test(command)) throw new Error('Invalid agent executable')
  command = command.replace(/^"(.*)"$/, '$1')
  const paths = command.includes('/') || command.includes('\\') ? [command] :
    (env.PATH ?? env.Path ?? '').split(delimiter).flatMap(path =>
      platform === 'win32' && !extname(command) ? [join(path, command + '.exe'), join(path, command + '.cmd'), join(path, command)] : [join(path, command)])
  const found = paths.find(path => existsSync(path))
  if (!found) throw new Error('Agent executable was not found')
  // The app's own binary is not an agent: run as one it would need RunAsNode, which the packaged app has off.
  if (appExecutable && samePath(found, appExecutable, platform)) throw new MainRefusal('thread.agent.scriptUnsupported', {})
  const childEnv = { ...env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  if (platform !== 'win32' || !['.cmd', '.ps1', '.bat'].includes(extname(found).toLowerCase())) return { executable: found, args, env: childEnv }
  const entry = join(dirname(found), 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
  if (!existsSync(entry) || !/^codex\.(cmd|ps1|bat)$/i.test(found.split(/[\\/]/).at(-1) ?? '')) {
    throw new MainRefusal('thread.agent.scriptUnsupported', {})
  }
  return { executable: nativeCodexExecutable(entry, arch), args, env: childEnv }
}

function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const norm = (path: string): string => { const full = resolvePath(path); return platform === 'win32' ? full.toLowerCase() : full }
  return norm(a) === norm(b)
}

/** The `codex.exe` an npm install of `@openai/codex` ships next to `bin/codex.js`, from its platform package or its own vendor folder. */
function nativeCodexExecutable(entry: string, arch: string): string {
  const packageRoot = dirname(dirname(entry))
  const target = arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
  const platformPackage = arch === 'arm64' ? '@openai/codex-win32-arm64' : '@openai/codex-win32-x64'
  const vendors = [join(packageRoot, 'vendor')]
  try { vendors.unshift(join(dirname(createRequire(entry).resolve(`${platformPackage}/package.json`)), 'vendor')) } catch { /* older bundled npm package */ }
  const executable = vendors.flatMap(vendor => [join(vendor, target, 'bin', 'codex.exe'), join(vendor, target, 'codex', 'codex.exe')]).find(existsSync)
  if (!executable) throw new MainRefusal('thread.agent.nativeMissing', {})
  return executable
}

/** Kept for callers that launch a conversation interactively: the same resolution, which is already native. */
export function interactiveConversationCommand(command: string, args: string[], env: NodeJS.ProcessEnv = process.env,
  platform = process.platform, arch = process.arch,
  appExecutable: string | undefined = process.versions.electron ? process.execPath : undefined): ReturnType<typeof conversationCommand> {
  return conversationCommand(command, args, env, platform, arch, appExecutable)
}

/** The CLI's bare name: the only part of a command that failed to start which the incident journal hashes. */
function agentName(command: string): string {
  return command.replace(/\\/g, '/').split('/').pop()?.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase() || 'agent'
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
    for (const key of ['OXESPACE_MCP_PORT', 'OXESPACE_MCP_TOKEN', 'OXESPACE_WORKSPACE_ID', 'OXESPACE_MEMORY_RUN_ID', 'OXESPACE_MEMORY_RUN', 'AI_MEMORY_CAPTURE_OWNER',
      'OXESPACE_EXECUTION_ID', 'OXESPACE_EXECUTION_TOKEN', 'OXESPACE_EXECUTION_GENERATION', 'ENABLE_TOOL_SEARCH']) {
      if (mcpEnvironment[key]) env[key] = mcpEnvironment[key]
    }
    let resolved: ReturnType<typeof interactiveConversationCommand>
    try { resolved = interactiveConversationCommand(command, args, env) } catch (error) { recordIncident('incident.agent.startFailed', agentName(command)); throw error }
    this.child = spawn(resolved.executable, resolved.args, { cwd, env: resolved.env, windowsHide: true, stdio: 'pipe',
      detached: process.platform !== 'win32' })
    const startedAt = Date.now()
    this.child.once('spawn', () => recordRuntime('process-start', { ...diagnosticContext, kind: 'thread', pid: this.child.pid, parentPid: process.pid, executable: resolved.executable }))
    this.child.stdout.on('data', (chunk: Buffer) => this.dataListener(chunk))
    // Consume stderr without retaining potentially sensitive provider diagnostics.
    this.child.stderr.on('data', (chunk: Buffer) => this.diagnosticListener(chunk))
    this.child.stdin.on('error', () => this.end())
    this.child.on('error', () => {
      recordRuntime('process-error', { ...diagnosticContext, pid: this.child.pid, state: 'failed' })
      // No pid: the agent never started (missing or blocked executable). Only the command's name is hashed.
      if (this.child.pid === undefined) recordIncident('incident.agent.startFailed', agentName(command))
      this.end()
    })
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
    await killProcessTree(pid)
    this.end()
  }

  private end(): void {
    if (this.closed) return
    this.closed = true
    this.closeListener()
  }
}
