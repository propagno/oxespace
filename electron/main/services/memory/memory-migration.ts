import { cp, lstat, mkdir, readFile, readdir, rename, rm, statfs, writeFile, realpath } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { MemoryRuntimeSettings } from '../../../../shared/types/memory'

type Phase = 'copying' | 'validated' | 'switching' | 'committed' | 'restoring' | 'restored'
interface Journal { phase: Phase; from: MemoryRuntimeSettings; to: MemoryRuntimeSettings; config: string | null }
async function exists(path: string) { try { await lstat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error } }

/** One retained transaction. Never open upgraded data with the old executable.
 * Paths are fixed children of the application's private runtime directory.
 * Failed/newer data is preserved during recovery, not merged into the snapshot.
 */
export class MemoryMigration {
  readonly root: string
  readonly candidate: string
  readonly snapshot: string
  readonly displaced: string
  readonly journalPath: string
  constructor(private readonly directory: string, private readonly saveSettings: (settings: MemoryRuntimeSettings) => void,
    private readonly checkpoint: (phase: string) => Promise<void> = async () => {}) {
    this.root = join(directory, 'upgrade-2.6.2')
    this.candidate = join(this.root, 'candidate')
    this.snapshot = join(this.root, 'snapshot')
    this.displaced = join(this.root, 'preserved-newer-data')
    this.journalPath = join(this.root, 'journal.json')
  }
  private async read(): Promise<Journal | undefined> {
    if (!await exists(this.journalPath)) return undefined
    const value = JSON.parse(await readFile(this.journalPath, 'utf8')) as Journal
    if (!['copying', 'validated', 'switching', 'committed', 'restoring', 'restored'].includes(value.phase)
      || value.from?.mode !== 'managed' || value.to?.mode !== 'managed'
      || !(value.config === null || typeof value.config === 'string')) throw Error('Invalid memory upgrade journal; recovery requires inspection')
    return value
  }
  private async record(value: Journal) {
    const temporary = this.journalPath + '.tmp'
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
    await rename(temporary, this.journalPath)
  }
  async recover(): Promise<void> {
    const journal = await this.read()
    if (!journal || journal.phase === 'committed') return
    if (journal.phase === 'restored') { await this.cleanFailedCandidate(); return }
    await this.restore(journal)
  }
  private async cleanFailedCandidate(): Promise<void> {
    if (await exists(this.displaced) || await exists(this.snapshot)) return
    const target = resolve(this.root)
    if (dirname(target) !== resolve(this.directory) || basename(target) !== 'upgrade-2.6.2') throw Error('Invalid memory upgrade cleanup path')
    if (dirname(await realpath(this.root)) !== await realpath(this.directory)) throw Error('Memory upgrade directory changed during cleanup')
    await rm(target, { recursive: true, force: true })
  }
  async previous(): Promise<MemoryRuntimeSettings | null> {
    const journal = await this.read()
    return journal?.phase === 'committed' ? journal.from : null
  }
  async upgraded(): Promise<MemoryRuntimeSettings | null> {
    const journal = await this.read()
    return journal?.phase === 'committed' ? journal.to : null
  }
  async rollback(target: MemoryRuntimeSettings): Promise<boolean> {
    const journal = await this.read()
    if (journal?.phase !== 'committed' || JSON.stringify(journal.from) !== JSON.stringify(target)) return false
    await this.restore(journal)
    return true
  }
  private async restore(journal: Journal) {
    await this.record({ ...journal, phase: 'restoring' })
    const data = join(this.directory, 'data')
    if (await exists(this.snapshot)) {
      if (await exists(data)) {
        if (await exists(this.displaced)) throw Error('Recovery data already exists; refusing to overwrite it')
        await rename(data, this.displaced)
      }
      await rename(this.snapshot, data)
    }
    const configPath = join(this.directory, 'local.toml')
    if (journal.config !== null) await writeFile(configPath, journal.config, { mode: 0o600 })
    else await rm(configPath, { force: true })
    this.saveSettings(journal.from)
    await this.record({ ...journal, phase: 'restored' })
    await this.cleanFailedCandidate()
  }
  async upgrade(from: MemoryRuntimeSettings, to: MemoryRuntimeSettings, config: string,
    validate: (data: string, configPath: string) => Promise<void>): Promise<void> {
    if (await exists(this.root)) throw Error('A memory upgrade snapshot already exists. Review recovery data before another upgrade.')
    const data = join(this.directory, 'data')
    // Reject links, sockets and other special files rather than snapshotting
    // data outside our directory or pretending the copy is consistent.
    const size = async (file: string): Promise<number> => {
      const stat = await lstat(file)
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw Error('Memory snapshot contains an unsupported file type')
      if (!stat.isDirectory()) return stat.size
      let bytes = 0
      for (const child of await readdir(file)) bytes += await size(join(file, child))
      return bytes
    }
    const bytes = await size(data)
    const disk = await statfs(this.directory)
    if (disk.bavail * disk.bsize < bytes * 2 + 64 * 1024 * 1024) throw Error('Insufficient free space for a safe memory upgrade')
    let previousConfig: string | null = null
    try { previousConfig = await readFile(join(this.directory, 'local.toml'), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    await mkdir(this.root, { recursive: false })
    let journal: Journal = { phase: 'copying', from, to, config: previousConfig }
    await this.record(journal)
    try {
      await cp(data, this.candidate, { recursive: true, errorOnExist: true, force: false })
      await this.checkpoint('copied')
      const candidateConfig = join(this.root, 'candidate.toml')
      await writeFile(candidateConfig, config, { mode: 0o600 })
      await validate(this.candidate, candidateConfig)
      journal = { ...journal, phase: 'validated' }; await this.record(journal)
      await this.checkpoint('validated')
      journal = { ...journal, phase: 'switching' }; await this.record(journal)
      await rename(data, this.snapshot)
      await this.checkpoint('snapshot')
      await rename(this.candidate, data)
      await this.checkpoint('swapped')
      await writeFile(join(this.directory, 'local.toml'), config, { mode: 0o600 })
      this.saveSettings(to)
      await this.checkpoint('settings')
      await this.record({ ...journal, phase: 'committed' })
    } catch (error) {
      await this.restore(journal)
      throw error
    }
  }
}
