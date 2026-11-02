import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { delimiter, dirname, extname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path'
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
  const childEnv = withoutRunAsNode(env)
  if (platform !== 'win32' || !['.cmd', '.ps1', '.bat'].includes(extname(found).toLowerCase())) return { executable: found, args, env: childEnv }
  const entry = join(dirname(found), 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
  if (!existsSync(entry) || !/^codex\.(cmd|ps1|bat)$/i.test(found.split(/[\\/]/).at(-1) ?? '')) {
    throw new MainRefusal('thread.agent.scriptUnsupported', {})
  }
  const executable = nativeCodexExecutable(dirname(found), arch)
  if (appExecutable && samePath(executable, appExecutable, platform)) throw new MainRefusal('thread.agent.scriptUnsupported', {})
  return { executable, args, env: childEnv }
}

/** The env without ELECTRON_RUN_AS_NODE under any casing (a Windows env copy keeps whatever casing it was given). */
export function withoutRunAsNode(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE'))
}

/** The same file, through links: a symlink, junction or differently spelled path to the app binary is still the app. */
function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const real = (path: string): string => { try { return realpathSync.native(path) } catch { return resolvePath(path) } }
  const norm = (path: string): string => { const full = real(path); return platform === 'win32' ? full.toLowerCase() : full }
  return norm(a) === norm(b)
}

/**
 * The `codex.exe` an npm install of `@openai/codex` ships, looked up ONLY under the folder that holds `codex.cmd`:
 * the platform package (nested in the Codex package, or beside it in a global install), then Codex's own vendor
 * folder. Never through Node's module resolution, which climbs every parent `node_modules` up to the drive root,
 * where another user may plant a package (`C:\node_modules\@openai\codex-win32-x64`). Each candidate must
 * resolve, through links, to a file inside that folder.
 */
function nativeCodexExecutable(shimFolder: string, arch: string): string {
  const target = arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
  const platformPackage = arch === 'arm64' ? 'codex-win32-arm64' : 'codex-win32-x64'
  const openai = join(shimFolder, 'node_modules', '@openai')
  const vendors = [join(openai, 'codex', 'node_modules', '@openai', platformPackage, 'vendor'), join(openai, platformPackage, 'vendor'), join(openai, 'codex', 'vendor')]
  let root: string
  try { root = realpathSync.native(shimFolder) } catch { throw new MainRefusal('thread.agent.nativeMissing', {}) }
  const inside = (candidate: string): boolean => {
    try {
      const path = relative(root, realpathSync.native(candidate))
      return path !== '' && path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path)
    } catch { return false }
  }
  const executable = vendors.flatMap(vendor => [join(vendor, target, 'bin', 'codex.exe'), join(vendor, target, 'codex', 'codex.exe')]).find(inside)
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
    // Only a live child: one that exited or died by a signal long ago may have handed its pid to someone else.
    // `closed` alone is not proof of death (a stdin error ends the transport while the agent may still run).
    if (!pid || this.child.exitCode !== null || this.child.signalCode !== null) { this.end(); return }
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
