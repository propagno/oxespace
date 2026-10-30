import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'

/** The slice of the cipher this needs (see oxequery/secret-cipher.ts: Electron's safeStorage, refused when only obfuscating). */
export interface SecretVault { available(): boolean; problem(): string | null; encrypt(value: string): Buffer; decrypt(value: Buffer): string }

type Table = Record<string, Record<string, Record<string, string>>>

/**
 * Environment secrets, encrypted with the system's secure storage and kept in one file under the app's data folder,
 * keyed by workspace folder, environment and name. The page can set and clear a secret and ask whether it is set;
 * only the sender reads a value, and a value is never written to a request file, to the history or to a log.
 */
export class SecretStore {
  private writing: Promise<void> = Promise.resolve()
  constructor(private readonly file: string, private readonly vault: SecretVault, private readonly platform: NodeJS.Platform = process.platform) {}

  private key(root: string): string {
    const normalized = root.replace(/\\/g, '/').replace(/\/+$/, '')
    return createHash('sha256').update(this.platform === 'win32' || this.platform === 'darwin' ? normalized.toLowerCase() : normalized).digest('hex').slice(0, 32)
  }

  private async load(): Promise<Table> {
    try { const parsed = JSON.parse(await readFile(this.file, 'utf8')) as unknown; return parsed && typeof parsed === 'object' ? parsed as Table : {} } catch { return {} }
  }

  private save(table: Table): Promise<void> {
    const run = async (): Promise<void> => {
      await mkdir(dirname(this.file), { recursive: true })
      const temporary = `${this.file}.${randomBytes(4).toString('hex')}.tmp`
      try { await writeFile(temporary, JSON.stringify(table), { mode: 0o600, flag: 'wx' }); await rename(temporary, this.file) } catch (error) { await rm(temporary, { force: true }); throw error }
    }
    this.writing = this.writing.then(run, run)
    return this.writing
  }

  /** Names that have a value, for one environment. */
  async names(root: string, environment: string): Promise<string[]> {
    return Object.keys((await this.load())[this.key(root)]?.[environment] ?? {})
  }

  async set(root: string, environment: string, name: string, value: string): Promise<void> {
    const problem = this.vault.problem()
    if (problem) throw new Error(problem)
    if (value === '') throw new Error('A secret cannot be empty; clear it instead')
    if (value.length > 8192) throw new Error('A secret is at most 8192 characters')
    const table = await this.load()
    const key = this.key(root)
    ;((table[key] ??= {})[environment] ??= {})[name] = this.vault.encrypt(value).toString('base64')
    await this.save(table)
  }

  async clear(root: string, environment: string, name?: string): Promise<void> {
    const table = await this.load()
    const key = this.key(root)
    const scope = table[key]
    if (!scope?.[environment]) return
    if (name === undefined) delete scope[environment]; else delete scope[environment][name]
    await this.save(table)
  }

  /** Decrypted values, for sending only. A value that cannot be decrypted (another machine's file) counts as not set. */
  async values(root: string, environment: string): Promise<Record<string, string>> {
    const stored = (await this.load())[this.key(root)]?.[environment] ?? {}
    const result: Record<string, string> = {}
    if (this.vault.problem()) return result
    for (const [name, encrypted] of Object.entries(stored)) {
      try { result[name] = this.vault.decrypt(Buffer.from(encrypted, 'base64')) } catch { /* not set */ }
    }
    return result
  }
}
