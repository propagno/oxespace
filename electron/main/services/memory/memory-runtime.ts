import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { safeStorage } from 'electron'
import type { AppDatabase } from '../../db'
import type { MemoryRuntimeSettings } from '../../../../shared/types/memory'
import { AiMemoryClient } from './ai-memory.client'

const exec = promisify(execFile)
export const MEMORY_RELEASE = '2.1.0'
export function memoryEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('AI_MEMORY_')))
}

export class MemoryRuntime {
  private child: ChildProcess | null = null
  private starting: Promise<void> | null = null
  private generation = 0
  readonly dataDir: string
  readonly configPath: string
  constructor(private readonly db: AppDatabase, readonly directory: string) {
    this.dataDir = join(directory, 'data')
    this.configPath = join(directory, 'local.toml')
  }

  settings(): MemoryRuntimeSettings {
    const row = this.db.prepare('SELECT settings_json FROM memory_runtime WHERE id = 1').get() as { settings_json: string } | undefined
    return row ? JSON.parse(row.settings_json) : { mode: 'managed', executable: 'ai-memory', url: 'http://127.0.0.1:49374' }
  }
  async configure(settings: MemoryRuntimeSettings, token?: string): Promise<void> {
    new AiMemoryClient(settings.url, '') // Validate before persisting or stopping anything.
    if (settings.executable.includes('\0') || !settings.executable.trim()) throw new Error('Choose an AI Memory executable')
    await this.stop()
    if (token !== undefined) this.saveToken(token)
    this.db.prepare('INSERT INTO memory_runtime (id, settings_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json').run(JSON.stringify(settings))
  }
  private saveToken(token: string): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable')
    this.db.prepare(`INSERT INTO secure_credentials (provider, payload, encrypted, label, created_at, updated_at)
      VALUES ('ai-memory', ?, 1, 'Local project memory', ?, ?)
      ON CONFLICT(provider) DO UPDATE SET payload = excluded.payload, encrypted = 1, updated_at = excluded.updated_at`)
      .run(safeStorage.encryptString(token), Date.now(), Date.now())
  }
  token(): string {
    const row = this.db.prepare("SELECT payload FROM secure_credentials WHERE provider = 'ai-memory'").get() as { payload: Buffer } | undefined
    if (row) return safeStorage.decryptString(Buffer.from(row.payload))
    const token = randomBytes(32).toString('hex')
    this.saveToken(token)
    return token
  }
  client(): AiMemoryClient { return new AiMemoryClient(this.settings().url, this.token()) }

  async start(): Promise<void> {
    if (!this.starting) this.starting = this.startOnce().finally(() => { this.starting = null })
    return this.starting
  }
  private async startOnce(): Promise<void> {
    const generation = this.generation
    const settings = this.settings()
    if (this.child && this.child.exitCode === null) return
    await mkdir(this.dataDir, { recursive: true })
    // Dedicated explicit config, no inherited user/provider settings. No cloud model calls.
    await writeFile(this.configPath, `embedding_provider = "none"\nserver_url = ${JSON.stringify(settings.url)}\ncapture_assistant = true\n[auto_scope]\nmode = "per_actor"\n[routing]\nmid_session = "sticky"\n[auto_improve.scheduler]\nenabled = false\n`, { mode: 0o600 })
    await writeFile(join(this.dataDir, 'auth-token'), this.token(), { mode: 0o600 })
    if (generation !== this.generation) throw new Error('Memory startup cancelled')
    if (settings.mode === 'connected') { await this.client().initialize(); return }
    const bind = new URL(settings.url)
    if (bind.pathname !== '/') throw new Error('Managed memory requires a root URL without a base path')
    const child = spawn(settings.executable, ['--data-dir', this.dataDir, '--config', this.configPath, 'serve', '--transport', 'http', '--bind', bind.host, '--enable-web'], {
      env: { ...memoryEnvironment(), AI_MEMORY_AUTH_TOKEN: this.token() }, windowsHide: true, stdio: 'ignore', shell: false
    })
    this.child = child
    let spawnError = false
    child.on('error', () => { spawnError = true; if (this.child === child) this.child = null })
    child.on('exit', () => { if (this.child === child) this.child = null })
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      if (generation !== this.generation) throw new Error('Memory startup cancelled')
      if (spawnError || child.exitCode !== null) throw new Error('AI Memory could not start; check executable, port and data-directory lock')
      try { await this.client().initialize(); return } catch { /* bounded startup retry */ }
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    await this.stop()
    throw new Error('AI Memory startup timed out')
  }
  async stop(): Promise<void> {
    this.generation++
    const child = this.child
    this.child = null
    if (!child) return // Never stop a connected/external server.
    child.kill('SIGINT') // Windows terminates; native Unix handles Ctrl-C gracefully.
    await new Promise<void>(resolve => {
      if (child.exitCode !== null) return resolve()
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 2000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }

  /** Explicit UI action; download code only, never project contents. Pin and verify before extraction. */
  async install(): Promise<string> {
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
    if (!['x64', 'arm64'].includes(process.arch) || (process.platform === 'win32' && arch !== 'x86_64')) throw new Error('No supported native AI Memory release for this platform')
    const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'
    const asset = `ai-memory-${platform}-${arch}.${platform === 'windows' ? 'zip' : 'tar.gz'}`
    const base = `https://github.com/akitaonrails/ai-memory/releases/download/v${MEMORY_RELEASE}/${asset}`
    const [archive, checksum] = await Promise.all([fetch(base, { signal: AbortSignal.timeout(120000) }), fetch(`${base}.sha256`, { signal: AbortSignal.timeout(30000) })])
    if (!archive.ok || !checksum.ok) throw new Error('AI Memory download failed')
    const bytes = Buffer.from(await archive.arrayBuffer())
    const expected = (await checksum.text()).trim().split(/\s+/)[0].toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(expected) || createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('AI Memory checksum mismatch')
    const target = join(this.directory, `runtime-${MEMORY_RELEASE}`)
    await mkdir(target, { recursive: true })
    const path = join(target, asset)
    await writeFile(path, bytes)
    if (platform === 'windows') {
      const quote = (s: string): string => `'${s.replace(/'/g, "''")}'`
      await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(path)} -DestinationPath ${quote(target)} -Force`], { windowsHide: true, timeout: 30000 })
    } else await exec('tar', ['-xzf', path, '-C', target], { timeout: 30000 })
    const executable = join(target, platform === 'windows' ? 'ai-memory.exe' : 'ai-memory')
    await exec(executable, ['--version'], { timeout: 5000, windowsHide: true })
    return executable
  }
}

export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await rename(temp, path)
}

export async function readJson(path: string): Promise<Record<string, unknown>> {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}
