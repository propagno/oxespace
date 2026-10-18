import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export interface MemoryDelivery {
  url: string
  body: { session_id: string; cwd: string; prompt?: string; _ai_memory_assistant?: { version: 1; excerpt: string } }
}

export interface MemoryOutboxRecord {
  key: string
  projectId: string
  sessionId: string
  createdAt: number
  policy: 'keep' | 'metadata-only'
  item: MemoryDelivery
}

interface StoredRecord extends MemoryOutboxRecord { file: string; bytes: number; sequence: number }
export interface OutboxStats { pending: number; quarantined: number; bytes: number; refused: number; oldestAt?: number }
const MAX_BYTES = 64 * 1024 * 1024
const MAX_EVENTS = 10_000
const MAX_AGE = 7 * 24 * 60 * 60 * 1000
const RESERVED_FILE_BYTES = 4096

function diskBytes(bytes: number, blocks?: number): number {
  return Math.max(RESERVED_FILE_BYTES, blocks ? blocks * 512 : Math.ceil(bytes / RESERVED_FILE_BYTES) * RESERVED_FILE_BYTES)
}

/** A producer-owned, crash-recoverable queue. Files are never named after content. */
export class MemoryOutbox {
  private readonly records = new Map<string, StoredRecord>()
  private bytes = 0
  private refused = 0
  private quarantined = 0
  private sequence = 0
  private operation = Promise.resolve()
  private ready: Promise<void> | undefined
  constructor(readonly directory: string, private readonly limits = { maxBytes: MAX_BYTES, maxEvents: MAX_EVENTS }) {}

  private statusSlot(count: number): Buffer {
    const value = JSON.stringify({ count, check: createHash('sha256').update(String(count)).digest('hex').slice(0, 16) })
    return Buffer.from(value.padEnd(128, ' '))
  }

  private async persistRefused(): Promise<void> {
    const handle = await open(join(this.directory, 'status.dat'), 'r+')
    try { await handle.write(this.statusSlot(this.refused), 0, 128, this.refused % 2 * 128); await handle.sync() }
    finally { await handle.close() }
  }

  static ingestKey(parts: string[]): string {
    return createHash('sha256').update(JSON.stringify(['oxespace-memory-v1', ...parts])).digest('hex')
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.operation.then(work)
    this.operation = result.then(() => {}, () => {})
    return result
  }

  init(): Promise<void> {
    if (!this.ready) this.ready = this.serialize(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      await mkdir(join(this.directory, 'quarantine'), { recursive: true, mode: 0o700 })
      const statusPath = join(this.directory, 'status.dat')
      try {
        const handle = await open(statusPath, 'wx', 0o600)
        try { await handle.write(Buffer.concat([this.statusSlot(0), this.statusSlot(0)])); await handle.sync() }
        finally { await handle.close() }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      if (!(await lstat(statusPath)).isFile()) throw Error('Memory outbox status is not a regular file')
      for (const location of [join(this.directory, 'quarantine'), this.directory]) {
        for (const file of await readdir(location)) {
          if (file === 'quarantine') continue
          const path = join(location, file)
          const info = await lstat(path).catch(() => undefined)
          if (!info?.isFile()) continue
          this.bytes += diskBytes(info.size, info.blocks)
          if (location !== this.directory) { this.quarantined++; continue }
          if (file === 'status.dat') {
            const bytes = await readFile(path)
            for (const offset of [0, 128]) try {
              const slot = JSON.parse(bytes.subarray(offset, offset + 128).toString().trim()) as { count: number; check: string }
              if (Number.isSafeInteger(slot.count) && slot.count >= 0
                && slot.check === createHash('sha256').update(String(slot.count)).digest('hex').slice(0, 16)) this.refused = Math.max(this.refused, slot.count)
            } catch { /* The alternate slot survives a torn write. */ }
            continue
          }
          if (!file.endsWith('.json')) {
            await rename(path, join(this.directory, 'quarantine', file)).catch(() => {})
            this.quarantined++
            continue
          }
          try {
            const value = JSON.parse(await readFile(path, 'utf8')) as MemoryOutboxRecord & { sequence?: number }
            if (value.key !== file.slice(0, -5) || !/^[a-f0-9]{64}$/.test(value.key)
              || typeof value.sessionId !== 'string' || typeof value.projectId !== 'string'
              || !Number.isFinite(value.createdAt) || !value.item?.url?.startsWith('/hook?')) throw Error('invalid')
            if (value.sequence !== undefined && (!Number.isSafeInteger(value.sequence) || value.sequence < 1)) throw Error('invalid sequence')
            const record = { ...value, sequence: value.sequence ?? 0, file, bytes: diskBytes(info.size, info.blocks) }
            this.sequence = Math.max(this.sequence, record.sequence)
            this.records.set(value.key, record)
          } catch { await rename(path, join(this.directory, 'quarantine', file)).catch(() => {}); this.quarantined++ }
        }
      }
      await this.quarantineExpired()
    })
    return this.ready
  }

  private async quarantineExpired(): Promise<void> {
    for (const record of this.records.values()) {
      if (Date.now() - record.createdAt <= MAX_AGE) continue
      await rename(join(this.directory, record.file), join(this.directory, 'quarantine', record.file))
      this.records.delete(record.key)
      this.quarantined++
    }
  }

  async admit(value: MemoryOutboxRecord): Promise<boolean> {
    await this.init()
    return this.serialize(async () => {
      if (!/^[a-f0-9]{64}$/.test(value.key) || !value.sessionId || !value.projectId || value.policy !== 'keep' && value.policy !== 'metadata-only') return false
      if (this.records.has(value.key)) return true
      await this.quarantineExpired()
      const sequence = this.sequence + 1
      if (!Number.isSafeInteger(sequence)) throw Error('Memory outbox sequence exhausted')
      const json = JSON.stringify({ ...value, sequence })
      const size = Buffer.byteLength(json)
      if (size > 16 * 1024 || this.records.size + this.quarantined >= this.limits.maxEvents
        || this.bytes + diskBytes(size) + RESERVED_FILE_BYTES > this.limits.maxBytes) {
        this.refused++
        await this.persistRefused().catch(() => {})
        return false
      }
      const temporary = join(this.directory, `${randomUUID()}.tmp`)
      const file = `${value.key}.json`
      try {
        const handle = await open(temporary, 'wx', 0o600)
        try { await handle.writeFile(json); await handle.sync() } finally { await handle.close() }
        await rename(temporary, join(this.directory, file))
      } catch (error) {
        // Even a partial write consumes the quota until explicitly removed.
        const orphan = await lstat(temporary).catch(() => undefined)
        if (orphan) {
          this.bytes += diskBytes(orphan.size, orphan.blocks)
          this.quarantined++
          await rename(temporary, join(this.directory, 'quarantine', temporary.slice(this.directory.length + 1))).catch(() => {})
        }
        throw error
      }
      const info = await stat(join(this.directory, file)).catch(() => ({ size, blocks: undefined }))
      const bytes = diskBytes(info.size, info.blocks)
      this.bytes += bytes
      this.sequence = sequence
      this.records.set(value.key, { ...value, sequence, file, bytes })
      return true
    })
  }

  async pending(): Promise<MemoryOutboxRecord[]> {
    await this.init()
    return this.serialize(async () => {
      await this.quarantineExpired()
      return [...this.records.values()].sort((a, b) => a.sequence - b.sequence || a.createdAt - b.createdAt || a.file.localeCompare(b.file))
        .map(({ file: _file, bytes: _bytes, sequence: _sequence, ...record }) => record)
    })
  }

  async settle(key: string, terminal: 'ack' | 'quarantine'): Promise<void> {
    await this.init()
    await this.serialize(async () => {
      const record = this.records.get(key)
      if (!record) return
      const source = join(this.directory, record.file)
      if (terminal === 'ack') { await unlink(source); this.bytes -= record.bytes }
      else { await rename(source, join(this.directory, 'quarantine', record.file)); this.quarantined++ }
      this.records.delete(key)
    })
  }

  stats(): OutboxStats {
    let oldestAt: number | undefined
    for (const record of this.records.values()) if (oldestAt === undefined || record.createdAt < oldestAt) oldestAt = record.createdAt
    return { pending: this.records.size, quarantined: this.quarantined, bytes: this.bytes, refused: this.refused, ...(oldestAt === undefined ? {} : { oldestAt }) }
  }
}
