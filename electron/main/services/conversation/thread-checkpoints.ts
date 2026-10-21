import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { AppDatabase } from '../../db'
import type { ThreadFileHunk } from '../../../../shared/types/thread'
import { diffLines, joinLines, revertHunk, splitLines, type LineHunk } from '../../../../shared/lineDiff'

const FILE_LIMIT = 2 * 1024 * 1024
const CHECKPOINT_LIMIT = 32 * 1024 * 1024

export interface ThreadCheckpointSummary {
  id: string
  threadId: string
  turnId?: string
  label: string
  state: 'open' | 'ready' | 'restored' | 'conflict' | 'failed'
  fileCount: number
  createdAt: number
  finalizedAt?: number
  restoredAt?: number
  error?: string
}

interface FileImage { exists: boolean; content?: Buffer; hash?: string }

/**
 * Where one file of a turn stands now: still as the turn left it (`pending`),
 * back to how it was before the turn (`reverted`), or edited since (`modified`,
 * which cannot be undone without losing that later work).
 */
export type CheckpointFileState = 'pending' | 'reverted' | 'modified'
/** `path` is relative to `root`, the checkout the turn changed. */
export interface CheckpointFileStatus { path: string; root: string; state: CheckpointFileState; preExists: boolean; postExists: boolean }
interface CheckpointRow {
  id: string; thread_id: string; turn_id: string | null; root_path: string; base_commit: string | null
  label: string | null; state: ThreadCheckpointSummary['state']; created_at: number; finalized_at: number | null
  restored_at: number | null; error: string | null
}
interface CheckpointFileRow {
  path: string; pre_exists: number; pre_content: Buffer | null; pre_hash: string | null
  post_exists: number; post_hash: string | null
}

/**
 * Captures the worktree immediately before a turn and finalizes it against the
 * resulting tree. Restore is all-or-nothing: every postimage must still match,
 * otherwise no file is touched. Git's index and unrelated dirty files are never
 * reset or cleaned.
 */
export class ThreadCheckpointService {
  constructor(private readonly db: AppDatabase) {}

  async begin(input: { threadId: string; turnId: string; rootPath: string; label?: string }): Promise<string> {
    const root = await canonicalRoot(input.rootPath)
    const id = randomUUID(), createdAt = Date.now()
    const baseCommit = await gitText(root, ['rev-parse', '--verify', 'HEAD']).catch(() => '')
    const beforePaths = await statusPaths(root)
    let bytes = 0
    const images = new Map<string, FileImage>()
    for (const path of beforePaths) {
      const image = await readImage(root, path)
      bytes += image.content?.byteLength ?? 0
      if (bytes > CHECKPOINT_LIMIT) throw Error('Checkpoint exceeds the 32 MiB safety limit')
      images.set(path, image)
    }
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO conversation_checkpoints
        (id, thread_id, turn_id, root_path, base_commit, label, state, before_paths_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`)
        .run(id, input.threadId, input.turnId, root, baseCommit || null, input.label?.slice(0, 120) || 'Before turn', JSON.stringify([...beforePaths]), createdAt)
      const insert = this.db.prepare(`INSERT INTO conversation_checkpoint_files
        (checkpoint_id, path, pre_exists, pre_content, pre_hash, post_exists, post_hash, bytes)
        VALUES (?, ?, ?, ?, ?, 0, NULL, ?)`)
      for (const [path, image] of images) insert.run(id, path, Number(image.exists), image.content ?? null, image.hash ?? null, image.content?.byteLength ?? 0)
    })()
    return id
  }

  async finalize(checkpointId: string): Promise<ThreadCheckpointSummary> {
    const checkpoint = this.row(checkpointId)
    if (checkpoint.state !== 'open') return this.summary(checkpoint)
    try {
      const root = await canonicalRoot(checkpoint.root_path)
      const paths = new Set<string>(JSON.parse((this.db.prepare('SELECT before_paths_json FROM conversation_checkpoints WHERE id = ?').get(checkpointId) as { before_paths_json: string }).before_paths_json))
      for (const path of await statusPaths(root)) paths.add(path)
      if (checkpoint.base_commit) for (const path of await gitNameDiff(root, checkpoint.base_commit)) paths.add(path)
      const existing = new Map((this.db.prepare('SELECT path, pre_exists, pre_content, pre_hash, post_exists, post_hash FROM conversation_checkpoint_files WHERE checkpoint_id = ?').all(checkpointId) as CheckpointFileRow[]).map(row => [row.path, row]))
      const files: Array<{ path: string; pre: FileImage; post: FileImage }> = []
      let bytes = [...existing.values()].reduce((sum, row) => sum + (row.pre_content?.byteLength ?? 0), 0)
      for (const path of paths) {
        const prior = existing.get(path)
        const post = await readImage(root, path)
        const pre = prior ? imageFromRow(prior, 'pre') : checkpoint.base_commit ? await gitImage(root, checkpoint.base_commit, path, post) : { exists: false }
        if (!pre.exists && !post.exists) continue
        bytes += prior ? 0 : pre.content?.byteLength ?? 0
        if (bytes > CHECKPOINT_LIMIT) throw Error('Checkpoint exceeds the 32 MiB safety limit')
        files.push({ path, pre, post })
      }
      this.db.transaction(() => {
        const upsert = this.db.prepare(`INSERT INTO conversation_checkpoint_files
          (checkpoint_id, path, pre_exists, pre_content, pre_hash, post_exists, post_hash, bytes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(checkpoint_id, path) DO UPDATE SET
            pre_exists=excluded.pre_exists, pre_content=excluded.pre_content, pre_hash=excluded.pre_hash,
            post_exists=excluded.post_exists, post_hash=excluded.post_hash, bytes=excluded.bytes`)
        for (const file of files) upsert.run(checkpointId, file.path, Number(file.pre.exists), file.pre.content ?? null, file.pre.hash ?? null, Number(file.post.exists), file.post.hash ?? null, (file.pre.content?.byteLength ?? 0) + (file.post.content?.byteLength ?? 0))
        this.db.prepare("UPDATE conversation_checkpoints SET state = 'ready', finalized_at = ?, error = NULL WHERE id = ?").run(Date.now(), checkpointId)
      })()
    } catch (error) {
      this.db.prepare("UPDATE conversation_checkpoints SET state = 'failed', finalized_at = ?, error = ? WHERE id = ?")
        .run(Date.now(), errorMessage(error), checkpointId)
    }
    return this.summary(this.row(checkpointId))
  }

  list(threadId: string): ThreadCheckpointSummary[] {
    return (this.db.prepare('SELECT * FROM conversation_checkpoints WHERE thread_id = ? ORDER BY created_at DESC').all(threadId) as CheckpointRow[]).map(row => this.summary(row))
  }

  async restore(threadId: string, checkpointId: string): Promise<ThreadCheckpointSummary> {
    const checkpoint = this.row(checkpointId)
    if (checkpoint.thread_id !== threadId) throw Error('Checkpoint does not belong to this conversation')
    if (checkpoint.state !== 'ready' && checkpoint.state !== 'conflict') throw Error('Only a ready or conflict checkpoint can be restored')
    const root = await canonicalRoot(checkpoint.root_path)
    const files = this.db.prepare('SELECT path, pre_exists, pre_content, pre_hash, post_exists, post_hash FROM conversation_checkpoint_files WHERE checkpoint_id = ? ORDER BY path').all(checkpointId) as CheckpointFileRow[]
    const current = new Map<string, FileImage>()
    const conflicts: string[] = []
    const alreadyReverted = new Set<string>()
    for (const file of files) {
      const image = await readImage(root, file.path)
      current.set(file.path, image)
      // A file the user already undid on its own is not a conflict for the whole turn.
      if (matches(image, imageFromRow(file, 'pre'))) { alreadyReverted.add(file.path); continue }
      if (image.exists !== Boolean(file.post_exists) || image.hash !== (file.post_hash ?? undefined)) conflicts.push(file.path)
    }
    if (conflicts.length) {
      const detail = `Restore blocked: ${conflicts.length} file${conflicts.length === 1 ? '' : 's'} changed after this checkpoint (${conflicts.slice(0, 5).join(', ')})`
      this.db.prepare("UPDATE conversation_checkpoints SET state = 'conflict', error = ? WHERE id = ?").run(detail, checkpointId)
      throw Error(detail)
    }
    const applied: string[] = []
    try {
      for (const file of files) {
        if (alreadyReverted.has(file.path)) continue
        await applyImage(root, file.path, imageFromRow(file, 'pre'))
        applied.push(file.path)
      }
    } catch (error) {
      for (const path of applied.reverse()) await applyImage(root, path, current.get(path)!).catch(() => {})
      this.db.prepare("UPDATE conversation_checkpoints SET state = 'failed', error = ? WHERE id = ?").run(`Restore rolled back: ${errorMessage(error)}`, checkpointId)
      throw error
    }
    this.db.prepare("UPDATE conversation_checkpoints SET state = 'restored', restored_at = ?, error = NULL WHERE id = ?").run(Date.now(), checkpointId)
    return this.summary(this.row(checkpointId))
  }

  /** The most recent checkpoint captured for a turn, if any. */
  forTurn(threadId: string, turnId: string): ThreadCheckpointSummary | undefined {
    // A turn that moved into a worktree has one checkpoint per checkout; the one where files changed is the
    // one to review, and the most recent of those when several did.
    const rows = this.db.prepare('SELECT * FROM conversation_checkpoints WHERE thread_id = ? AND turn_id = ? ORDER BY created_at DESC').all(threadId, turnId) as CheckpointRow[]
    const summaries = rows.map(row => this.summary(row))
    return summaries.find(summary => summary.fileCount > 0) ?? summaries[0]
  }

  /** Per-file standing of a finalized checkpoint against the working tree. */
  async fileStates(threadId: string, checkpointId: string): Promise<CheckpointFileStatus[]> {
    const checkpoint = this.row(checkpointId)
    if (checkpoint.thread_id !== threadId) throw Error('Checkpoint does not belong to this conversation')
    if (checkpoint.state === 'open' || checkpoint.state === 'failed') return []
    const root = await canonicalRoot(checkpoint.root_path)
    const files = this.db.prepare('SELECT path, pre_exists, pre_content, pre_hash, post_exists, post_hash FROM conversation_checkpoint_files WHERE checkpoint_id = ? ORDER BY path').all(checkpointId) as CheckpointFileRow[]
    const states: CheckpointFileStatus[] = []
    for (const file of files) {
      const current = await readImage(root, file.path).catch(() => undefined)
      const state: CheckpointFileState = current && matches(current, imageFromRow(file, 'pre')) ? 'reverted'
        : current && current.exists === Boolean(file.post_exists) && current.hash === (file.post_hash ?? undefined) ? 'pending'
          : 'modified'
      states.push({ path: file.path, root: checkpoint.root_path, state, preExists: Boolean(file.pre_exists), postExists: Boolean(file.post_exists) })
    }
    return states
  }

  /**
   * Undoes one file of a turn: restores its pre-turn content (or removes a file
   * the turn created). Refused when the file was edited after the turn, so
   * later work is never overwritten; a file already back to its pre-turn state
   * is left alone.
   */
  async restoreFile(threadId: string, checkpointId: string, path: string): Promise<CheckpointFileState> {
    const checkpoint = this.row(checkpointId)
    if (checkpoint.thread_id !== threadId) throw Error('Checkpoint does not belong to this conversation')
    if (checkpoint.state !== 'ready' && checkpoint.state !== 'conflict') throw Error('Only a ready or conflict checkpoint can be restored')
    const root = await canonicalRoot(checkpoint.root_path)
    const file = this.db.prepare('SELECT path, pre_exists, pre_content, pre_hash, post_exists, post_hash FROM conversation_checkpoint_files WHERE checkpoint_id = ? AND path = ?').get(checkpointId, safeRelative(path)) as CheckpointFileRow | undefined
    if (!file) throw Error('That file was not changed by this turn')
    const current = await readImage(root, file.path)
    const pre = imageFromRow(file, 'pre')
    if (matches(current, pre)) return 'reverted'
    if (current.exists !== Boolean(file.post_exists) || current.hash !== (file.post_hash ?? undefined)) {
      throw Error(`${file.path} changed after this turn; undoing it would discard that later work`)
    }
    await applyImage(root, file.path, pre)
    return 'reverted'
  }

  /**
   * The change blocks one turn made to a text file, while the file is still as
   * the turn (or a previous hunk undo) left it. Empty when there is nothing to
   * show block by block: binary, too many edits, or edited since.
   */
  async fileHunks(threadId: string, checkpointId: string, path: string): Promise<ThreadFileHunk[]> {
    const { file, current, pre } = await this.pendingTextFile(threadId, checkpointId, path)
    if (current === null || pre === null) return []
    return (diffLines(splitLines(pre), splitLines(current)) ?? []).map(hunk => ({ ...hunk, id: hunkId(file.path, hunk) }))
  }

  /**
   * Undoes one change block of a turn. The checkpoint then records the file as
   * the turn's result, so undoing the whole file or turn still restores the
   * pre-turn content.
   */
  async restoreHunk(threadId: string, checkpointId: string, path: string, id: string): Promise<void> {
    const { root, file, current, pre } = await this.pendingTextFile(threadId, checkpointId, path)
    if (current === null || pre === null) throw Error(`${path} cannot be undone block by block; undo the whole file instead`)
    const hunk = (diffLines(splitLines(pre), splitLines(current)) ?? []).find(value => hunkId(file.path, value) === id)
    if (!hunk) throw Error('That change is no longer in the file. Refresh the changes and try again.')
    const lines = revertHunk(splitLines(current), hunk)
    if (!lines) throw Error('That change is no longer in the file. Refresh the changes and try again.')
    const content = Buffer.from(joinLines(lines), 'utf8')
    const image: FileImage = { exists: true, content, hash: hash(content) }
    await applyImage(root, file.path, image)
    this.db.prepare('UPDATE conversation_checkpoint_files SET post_exists = 1, post_hash = ? WHERE checkpoint_id = ? AND path = ?').run(image.hash, checkpointId, file.path)
  }

  /** Pre-turn and current text of a file still in its post-turn state; null text for binary or absent sides. */
  private async pendingTextFile(threadId: string, checkpointId: string, path: string) {
    const checkpoint = this.row(checkpointId)
    if (checkpoint.thread_id !== threadId) throw Error('Checkpoint does not belong to this conversation')
    if (checkpoint.state !== 'ready' && checkpoint.state !== 'conflict') throw Error('Only a ready checkpoint has reviewable changes')
    const root = await canonicalRoot(checkpoint.root_path)
    const file = this.db.prepare('SELECT path, pre_exists, pre_content, pre_hash, post_exists, post_hash FROM conversation_checkpoint_files WHERE checkpoint_id = ? AND path = ?').get(checkpointId, safeRelative(path)) as CheckpointFileRow | undefined
    if (!file) throw Error('That file was not changed by this turn')
    const image = await readImage(root, file.path)
    if (!file.post_exists || !image.exists || image.hash !== (file.post_hash ?? undefined)) {
      if (!matches(image, imageFromRow(file, 'pre'))) throw Error(`${file.path} changed after this turn; review it as a whole file`)
      return { root, file, current: null, pre: null }
    }
    // A file the turn created is all one change; it is undone as a whole file.
    const pre = file.pre_exists && file.pre_content ? text(Buffer.from(file.pre_content)) : null
    return { root, file, current: text(image.content!), pre }
  }

  delete(threadId: string, checkpointId: string): void {
    const result = this.db.prepare('DELETE FROM conversation_checkpoints WHERE id = ? AND thread_id = ?').run(checkpointId, threadId)
    if (!result.changes) throw Error('Checkpoint not found')
  }

  /** After a restart no checkpoint can still be capturing: every open one, in every conversation, failed. */
  failAllOpen(error: string): void {
    this.db.prepare("UPDATE conversation_checkpoints SET state = 'failed', finalized_at = ?, error = ? WHERE state = 'open'").run(Date.now(), error)
  }

  failOpen(threadId: string, error: string): void {
    this.db.prepare("UPDATE conversation_checkpoints SET state = 'failed', finalized_at = ?, error = ? WHERE thread_id = ? AND state = 'open'").run(Date.now(), error, threadId)
  }

  private row(id: string): CheckpointRow {
    const row = this.db.prepare('SELECT * FROM conversation_checkpoints WHERE id = ?').get(id) as CheckpointRow | undefined
    if (!row) throw Error('Checkpoint not found')
    return row
  }

  private summary(row: CheckpointRow): ThreadCheckpointSummary {
    const fileCount = (this.db.prepare('SELECT COUNT(*) AS count FROM conversation_checkpoint_files WHERE checkpoint_id = ?').get(row.id) as { count: number }).count
    return { id: row.id, threadId: row.thread_id, ...(row.turn_id ? { turnId: row.turn_id } : {}), label: row.label || 'Checkpoint', state: row.state, fileCount, createdAt: row.created_at, ...(row.finalized_at ? { finalizedAt: row.finalized_at } : {}), ...(row.restored_at ? { restoredAt: row.restored_at } : {}), ...(row.error ? { error: row.error } : {}) }
  }
}

async function canonicalRoot(rootPath: string): Promise<string> {
  return resolve(await realpath(resolve(rootPath)))
}

function safeRelative(path: string): string {
  const value = path.replaceAll('\\', '/').replace(/^\.\//, '')
  if (!value || isAbsolute(value) || value === '..' || value.startsWith('../') || value.includes('/../') || value.includes('\0')) throw Error('Checkpoint contains an unsafe path')
  return value
}

async function resolveSafe(root: string, path: string): Promise<string> {
  const rel = safeRelative(path), target = resolve(root, rel)
  const fromRoot = relative(root, target)
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) throw Error('Checkpoint path escapes the project')
  let cursor = root
  for (const part of fromRoot.split(sep).slice(0, -1)) {
    cursor = resolve(cursor, part)
    try { if ((await lstat(cursor)).isSymbolicLink()) throw Error('Checkpoint path crosses a symbolic link') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return target
}

async function readImage(root: string, path: string): Promise<FileImage> {
  const target = await resolveSafe(root, path)
  try {
    const stat = await lstat(target)
    if (stat.isSymbolicLink()) throw Error(`Checkpoint refuses symbolic link: ${path}`)
    if (!stat.isFile()) throw Error(`Checkpoint only supports files: ${path}`)
    if (stat.size > FILE_LIMIT) throw Error(`Checkpoint file exceeds 2 MiB: ${path}`)
    const content = await readFile(target)
    return { exists: true, content, hash: hash(content) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false }
    throw error
  }
}

async function applyImage(root: string, path: string, image: FileImage): Promise<void> {
  const target = await resolveSafe(root, path)
  if (!image.exists) { await rm(target, { force: true }); return }
  if (!image.content || hash(image.content) !== image.hash) throw Error(`Checkpoint preimage is corrupt: ${path}`)
  await mkdir(dirname(target), { recursive: true })
  const temp = `${target}.oxespace-restore-${randomUUID()}.tmp`
  try { await writeFile(temp, image.content, { flag: 'wx' }); await rename(temp, target) }
  finally { await rm(temp, { force: true }).catch(() => {}) }
}

function imageFromRow(row: CheckpointFileRow, side: 'pre' | 'post'): FileImage {
  return side === 'pre'
    ? { exists: Boolean(row.pre_exists), ...(row.pre_content ? { content: Buffer.from(row.pre_content) } : {}), ...(row.pre_hash ? { hash: row.pre_hash } : {}) }
    : { exists: Boolean(row.post_exists), ...(row.post_hash ? { hash: row.post_hash } : {}) }
}

function hash(content: Buffer): string { return createHash('sha256').update(content).digest('hex') }
/** UTF-8 text, or null for content that would not survive a decode/encode round trip. */
function text(content: Buffer): string | null {
  if (content.includes(0)) return null
  const value = content.toString('utf8')
  return Buffer.from(value, 'utf8').equals(content) ? value : null
}
/** Stable for the same change in the same file, so a stale request never undoes a different block. */
function hunkId(path: string, hunk: LineHunk): string {
  return createHash('sha256').update(JSON.stringify([path, hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines])).digest('hex').slice(0, 16)
}
function matches(a: FileImage, b: FileImage): boolean { return a.exists === b.exists && (!a.exists || a.hash === b.hash) }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }

async function statusPaths(root: string): Promise<Set<string>> {
  const output = await gitBuffer(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const records = output.toString('utf8').split('\0').filter(Boolean), paths = new Set<string>()
  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    if (record.length < 4) continue
    paths.add(safeRelative(record.slice(3)))
    if (/[RC]/.test(record.slice(0, 2)) && records[index + 1]) paths.add(safeRelative(records[++index]))
  }
  return paths
}

async function gitNameDiff(root: string, baseCommit: string): Promise<Set<string>> {
  const output = await gitBuffer(root, ['diff', '--name-only', '-z', baseCommit, 'HEAD', '--'])
  return new Set(output.toString('utf8').split('\0').filter(Boolean).map(safeRelative))
}

/**
 * The pre-turn content of a file that was clean when the turn began, rebuilt
 * from the base commit. A clean file can be on disk either as the stored blob
 * or in its checkout form (autocrlf, eol, smudge filters), and git status
 * cannot tell which; the form whose line endings match the turn's result is
 * taken, since edits keep a file's line endings.
 */
async function gitImage(root: string, commit: string, path: string, post: FileImage): Promise<FileImage> {
  try {
    const spec = `${commit}:${safeRelative(path)}`
    const raw = await gitBuffer(root, ['show', spec])
    if (raw.byteLength > FILE_LIMIT) throw Error(`Checkpoint file exceeds 2 MiB: ${path}`)
    const crlf = (content?: Buffer) => Boolean(content?.includes('\r\n'))
    // Only a CRLF result over an LF blob can mean a converted checkout; anything else keeps the blob (one git call).
    const filtered = post.exists && crlf(post.content) && !crlf(raw) ? await gitBuffer(root, ['cat-file', '--filters', spec]).catch(() => raw) : raw
    const content = filtered.byteLength <= FILE_LIMIT && crlf(filtered) ? filtered : raw
    return { exists: true, content, hash: hash(content) }
  } catch (error) {
    if (/does not exist|exists on disk, but not in|Path .* does not exist|bad object/i.test(errorMessage(error))) return { exists: false }
    throw error
  }
}

function gitText(root: string, args: string[]): Promise<string> { return gitBuffer(root, args).then(value => value.toString('utf8').trim()) }
function gitBuffer(root: string, args: string[]): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    execFile('git', args, { cwd: root, windowsHide: true, encoding: 'buffer', maxBuffer: CHECKPOINT_LIMIT + 1024 * 1024, timeout: 20_000 }, (error, stdout, stderr) => {
      if (error) { reject(Error(Buffer.isBuffer(stderr) ? stderr.toString('utf8').trim() || error.message : String(stderr || error.message))); return }
      resolvePromise(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout))
    })
  })
}
