import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { connect } from 'node:net'
import { promisify } from 'node:util'
import { safeStorage } from 'electron'
import type { AppDatabase } from '../../db'
import type { MemoryRuntimeSettings } from '../../../../shared/types/memory'
import { AiMemoryClient } from './ai-memory.client'
import { MemoryMigration } from './memory-migration'

const exec = promisify(execFile)
export const MEMORY_RELEASE = '2.6.2'
const TOKEN_FILE = 'auth-token'
export function memoryEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('AI_MEMORY_')))
}

export class MemoryRuntime {
  private child: ChildProcess | null = null
  private starting: Promise<void> | null = null
  private generation = 0
  private changing: Promise<void> | null = null
  lastError: string | undefined
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
    if (this.changing) throw Error('A memory runtime change is already running')
    const operation = this.configureOnce(settings, token)
    this.changing = operation
    try { await operation } finally { if (this.changing === operation) this.changing = null }
  }
  private saveSettings(settings: MemoryRuntimeSettings): void {
    this.db.prepare('INSERT INTO memory_runtime (id, settings_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json').run(JSON.stringify(settings))
  }
  private configuration(settings: MemoryRuntimeSettings): string {
    return `embedding_provider = "none"\nserver_url = ${JSON.stringify(settings.url)}\ncapture_assistant = true\n[auto_scope]\nmode = "per_actor"\n[routing]\nmid_session = "sticky"\n[profile]\nenabled = false\n[handoff]\nclaim_on_session_start = false\n[auto_improve.scheduler]\nenabled = false\n`
  }
  private migration(): MemoryMigration { return new MemoryMigration(this.directory, value => this.saveSettings(value)) }
  async rollbackAvailable(): Promise<boolean> {
    const upgraded = await this.migration().upgraded()
    return upgraded !== null && JSON.stringify(upgraded) === JSON.stringify(this.settings())
  }
  async rollback(): Promise<void> {
    if (this.changing) throw Error('A memory runtime change is already running')
    const operation = this.rollbackOnce()
    this.changing = operation
    try { await operation } finally { if (this.changing === operation) this.changing = null }
  }
  private async rollbackOnce(): Promise<void> {
    const migration = this.migration()
    const previous = await migration.previous()
    if (!previous || !await this.rollbackAvailable()) throw Error('No verified memory rollback snapshot is available for this runtime')
    await this.stop()
    await this.starting?.catch(() => {})
    if (await this.version(previous.executable) !== '2.1.0') throw Error('The previous AI Memory executable is unavailable')
    if (!await migration.rollback(previous)) throw Error('Memory rollback snapshot changed during the operation')
  }
  async version(executable: string): Promise<string> {
    let stdout: string
    try { ({ stdout } = await exec(executable, ['--version'], { timeout: 5000, windowsHide: true, maxBuffer: 4096 })) }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'version error'
      throw Error(`Cannot launch AI Memory (${code}): ${executable}. Download the runtime and apply its executable path; check file permissions.`, { cause: error })
    }
    const match = stdout.trim().match(/^ai-memory (\d+\.\d+\.\d+)$/)
    if (!match) throw Error('Unsupported AI Memory executable version response')
    return match[1]
  }
  private async validateCandidate(settings: MemoryRuntimeSettings, dataDir: string, configPath: string): Promise<void> {
    const port = await new Promise<number>((resolvePort, reject) => {
      const socket = createServer()
      socket.once('error', reject)
      socket.listen(0, '127.0.0.1', () => {
        const address = socket.address()
        socket.close(() => address && typeof address !== 'string' ? resolvePort(address.port) : reject(Error('Cannot allocate migration port')))
      })
    })
    const url = `http://127.0.0.1:${port}`
    const config = this.configuration({ ...settings, url })
    await writeFile(configPath, config, { mode: 0o600 })
    const child = spawn(settings.executable, ['--data-dir', dataDir, '--config', configPath, 'serve', '--transport', 'http', '--bind', `127.0.0.1:${port}`, '--enable-api'], {
      env: { ...memoryEnvironment(), AI_MEMORY_AUTH_TOKEN: this.token(), AI_MEMORY_BACKFILL_ON_START: 'false' }, windowsHide: true, stdio: 'ignore', shell: false
    })
    let failed: Error | undefined
    child.once('error', error => { failed = error })
    let ready = false
    let stopped = false
    try {
      const client = new AiMemoryClient(url, this.token())
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        if (failed || child.exitCode !== null) throw failed ?? Error('Candidate runtime exited during validation')
        try { await client.initialize(); ready = true; break } catch { /* bounded candidate startup */ }
        await new Promise(resolve => setTimeout(resolve, 150))
      }
      if (!ready) throw Error('Candidate runtime did not become healthy')
    } finally {
      child.kill('SIGINT')
      stopped = child.exitCode !== null || child.signalCode !== null || failed !== undefined
      await new Promise<void>(resolve => {
        if (stopped) return resolve()
        const timer = setTimeout(() => { child.kill('SIGKILL') }, 2000)
        const deadline = setTimeout(() => { clearTimeout(timer); resolve() }, 5000)
        child.once('exit', () => { stopped = true; clearTimeout(timer); clearTimeout(deadline); resolve() })
      })
    }
    if (!stopped) throw Error('Candidate runtime did not exit; refusing to swap active memory data')
  }
  private async configureOnce(settings: MemoryRuntimeSettings, token?: string): Promise<void> {
    const previous = this.settings()
    await this.stop()
    await this.starting?.catch(() => {})
    const migration = this.migration()
    await migration.recover()
    if (token !== undefined && settings.mode === 'managed') throw Error('Managed memory credentials are generated locally; token overrides are only for connected servers')
    if (token !== undefined) this.saveToken(token)
    if (previous.mode === 'managed' && settings.mode === 'managed' && previous.executable !== settings.executable) {
      await mkdir(this.dataDir, { recursive: true })
      const hasData = (await readdir(this.dataDir)).some(name => name !== 'auth-token')
      if (hasData) {
        const address = new URL(previous.url)
        const occupied = await new Promise<boolean>(resolve => {
          const socket = connect({ host: address.hostname, port: Number(address.port || 80) })
          socket.setTimeout(750)
          socket.once('connect', () => { socket.destroy(); resolve(true) })
          socket.once('error', () => resolve(false))
          socket.once('timeout', () => { socket.destroy(); resolve(true) })
        })
        if (occupied) throw Error('Another memory server is listening on the managed port; refusing to migrate shared data')
        if (await migration.rollback(settings)) return
        const [before, after] = await Promise.all([this.version(previous.executable), this.version(settings.executable)])
        if (before !== '2.1.0' || after !== MEMORY_RELEASE) throw Error('Managed data can only upgrade from certified AI Memory 2.1.0 to 2.6.2')
        await migration.upgrade(previous, settings, this.configuration(settings), (data, config) => this.validateCandidate(settings, data, config))
        return
      }
    }
    this.saveSettings(settings)
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
  /**
   * The native hooks read the token from a file in the data directory. The store of record is the OS secure store
   * (above); this copy exists only while a memory-enabled agent can run a hook, and is removed when the last one
   * ends. The owner wires this to its live runs; by default the file stays, as before.
   */
  tokenInUse: () => boolean = () => true
  async publishToken(): Promise<void> {
    if (this.settings().mode !== 'managed') return
    await mkdir(this.dataDir, { recursive: true })
    await writeFile(join(this.dataDir, TOKEN_FILE), this.token(), { mode: 0o600 })
  }
  async withdrawToken(): Promise<void> {
    if (this.tokenInUse()) return
    await rm(join(this.dataDir, TOKEN_FILE), { force: true }).catch(() => {})
  }

  async start(): Promise<void> {
    if (this.changing) await this.changing
    if (!this.starting) this.starting = this.startOnce().then(() => { this.lastError = undefined; return this.withdrawToken() }).catch(async error => {
      this.lastError = error instanceof Error ? error.message : 'Memory startup failed'
      await this.withdrawToken()
      throw error
    }).finally(() => { this.starting = null })
    return this.starting
  }
  private async startOnce(): Promise<void> {
    await this.migration().recover()
    const generation = this.generation
    const settings = this.settings()
    if (this.child && this.child.exitCode === null) {
      // A running process is not proof that its authenticated API is ready.
      await this.client().initialize()
      return
    }
    if (generation !== this.generation) throw new Error('Memory startup cancelled')
    if (settings.mode === 'connected') { await this.client().initialize(); return }
    await mkdir(this.dataDir, { recursive: true })
    // Dedicated explicit config, no inherited user/provider settings. No cloud model calls.
    await writeFile(this.configPath, this.configuration(settings), { mode: 0o600 })
    await this.publishToken()
    const bind = new URL(settings.url)
    if (bind.pathname !== '/') throw new Error('Managed memory requires a root URL without a base path')
    const version = await this.version(settings.executable)
    if (generation !== this.generation) throw new Error('Memory startup cancelled')
    const child = spawn(settings.executable, ['--data-dir', this.dataDir, '--config', this.configPath, 'serve', '--transport', 'http', '--bind', bind.host, version === '2.6.2' ? '--enable-api' : '--enable-web'], {
      env: { ...memoryEnvironment(), AI_MEMORY_AUTH_TOKEN: this.token() }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], shell: false
    })
    this.child = child
    let spawnError: NodeJS.ErrnoException | undefined
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4096) })
    child.on('error', error => { spawnError = error; if (this.child === child) this.child = null })
    child.on('exit', () => { if (this.child === child) this.child = null })
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      if (generation !== this.generation) { await this.stop(); throw new Error('Memory startup cancelled') }
      if (spawnError || child.exitCode !== null) {
        const detail = stderr.replaceAll(this.token(), '[redacted]').replace(/\u001b\[[0-9;]*m/g, '').trim()
        throw new Error(spawnError
          ? `Cannot launch AI Memory (${spawnError.code ?? 'spawn error'}): ${settings.executable}. Download the runtime and apply its executable path; check file permissions.`
          : `AI Memory exited with code ${child.exitCode}. ${detail || 'Check the service port and data-directory lock.'}`)
      }
      try { await this.client().initialize(); return } catch { /* bounded startup retry */ }
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    await this.stop()
    throw new Error('AI Memory startup timed out')
  }
  async stop(): Promise<void> {
    this.generation++
    const child = this.child
    if (!child) return // Never stop a connected/external server.
    child.kill('SIGINT') // Windows terminates; native Unix handles Ctrl-C gracefully.
    let exited = child.exitCode !== null || child.signalCode !== null
    await new Promise<void>(resolve => {
      if (exited) return resolve()
      const timer = setTimeout(() => { child.kill('SIGKILL') }, 2000)
      const deadline = setTimeout(() => { clearTimeout(timer); resolve() }, 5000)
      child.once('exit', () => { exited = true; clearTimeout(timer); clearTimeout(deadline); resolve() })
    })
    if (!exited) throw Error('Managed AI Memory process did not exit; refusing an unsafe migration')
    if (this.child === child) this.child = null
  }

  /** Explicit UI action; download code only, never project contents. Pin and verify before extraction. */
  async install(): Promise<string> {
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
    if (!['x64', 'arm64'].includes(process.arch) || (process.platform === 'win32' && arch !== 'x86_64')) throw new Error('No supported native AI Memory release for this platform')
    const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'
    const asset = `ai-memory-${platform}-${arch}.${platform === 'windows' ? 'zip' : 'tar.gz'}`
    const target = join(this.directory, `runtime-${MEMORY_RELEASE}`)
    const executable = join(target, platform === 'windows' ? 'ai-memory.exe' : 'ai-memory')
    const manifest = join(target, 'oxespace-verified.json')
    await mkdir(this.directory, { recursive: true })
    try {
      const expected = JSON.parse(await readFile(manifest, 'utf8')) as { executableSha256: string }
      if (!/^[a-f0-9]{64}$/.test(expected.executableSha256)) throw Error('Invalid verified runtime manifest')
      const actual = createHash('sha256').update(await readFile(executable)).digest('hex')
      if (actual !== expected.executableSha256 || await this.version(executable) !== MEMORY_RELEASE) throw Error('Existing managed runtime verification failed')
      return executable
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if ((await readdir(this.directory)).includes(`runtime-${MEMORY_RELEASE}`)) throw Error('An incomplete runtime installation exists; inspect it before retrying', { cause: error })
    }
    const base = `https://github.com/akitaonrails/ai-memory/releases/download/v${MEMORY_RELEASE}/${asset}`
    const [archive, checksum] = await Promise.all([fetch(base, { signal: AbortSignal.timeout(120000) }), fetch(`${base}.sha256`, { signal: AbortSignal.timeout(30000) })])
    if (!archive.ok || !checksum.ok) throw new Error('AI Memory download failed')
    if (Number(archive.headers.get('content-length') || 0) > 128 * 1024 * 1024) throw Error('AI Memory archive exceeds the installation limit')
    const bytes = Buffer.from(await archive.arrayBuffer())
    if (bytes.length > 128 * 1024 * 1024) throw Error('AI Memory archive exceeds the installation limit')
    const expected = (await checksum.text()).trim().split(/\s+/)[0].toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(expected) || createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('AI Memory checksum mismatch')
    const staging = join(this.directory, `runtime-${MEMORY_RELEASE}-staging-${randomBytes(8).toString('hex')}`)
    const resolvedRoot = resolve(this.directory)
    const resolvedStaging = resolve(staging)
    if (dirname(resolvedStaging) !== resolvedRoot || !basename(resolvedStaging).startsWith(`runtime-${MEMORY_RELEASE}-staging-`)) throw Error('Invalid runtime staging path')
    await mkdir(staging)
    try {
      const path = join(staging, asset)
      await writeFile(path, bytes)
      if (platform === 'windows') {
        const quote = (s: string): string => `'${s.replace(/'/g, "''")}'`
        await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(path)} -DestinationPath ${quote(staging)} -Force`], { windowsHide: true, timeout: 30000 })
      } else await exec('tar', ['-xzf', path, '-C', staging], { timeout: 30000 })
      const candidate = join(staging, platform === 'windows' ? 'ai-memory.exe' : 'ai-memory')
      if (await this.version(candidate) !== MEMORY_RELEASE) throw Error('Extracted runtime version mismatch')
      const executableSha256 = createHash('sha256').update(await readFile(candidate)).digest('hex')
      await rm(path)
      await writeFile(join(staging, 'oxespace-verified.json'), JSON.stringify({ executableSha256, archiveSha256: expected }), { mode: 0o600 })
      await rename(staging, target)
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
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
