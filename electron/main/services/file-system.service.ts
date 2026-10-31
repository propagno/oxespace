import { randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { chmod, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, normalize, relative, resolve, sep } from 'node:path'
import type {
  FileSystemFileChangedEvent,
  FileSystemListTreeInput,
  FileSystemReadBinaryInput,
  FileSystemReadBinaryResult,
  FileSystemReadFileInput,
  FileSystemReadFileResult,
  FileSystemWatchFileInput,
  FileSystemWatchFileResult,
  FileSystemWriteFileInput,
  FileSystemWriteFileResult,
  FileTreeNode
} from '../../../shared/types/ipc'
import { safeJoin } from '../utils/safe-join'
import { MainRefusal } from './main-refusal'

export const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024
/** Previews stream base64 over IPC, which inflates ~33%; cap higher than text
 *  but still bounded so a huge PDF can't wedge the renderer. */
export const MAX_BINARY_FILE_BYTES = 12 * 1024 * 1024
export const MAX_DIRECTORY_ENTRIES = 500
export const DEFAULT_EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'coverage', '.next', 'build'])

/** Extension → MIME for the preview surfaces. Unknown types are rejected rather
 *  than guessed, so this can't become an arbitrary-file exfiltration channel. */
const PREVIEW_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf'
}

export function previewMimeType(relativePath: string): string | null {
  const ext = relativePath.split('.').pop()?.toLowerCase() ?? ''
  return PREVIEW_MIME_TYPES[ext] ?? null
}

interface WatchEntry {
  watcher: FSWatcher
  timeout: NodeJS.Timeout | null
}

export type WorkspaceRootResolver = (workspaceId: string, requestedRoot: string) => string | null

export class FileSystemService {
  private readonly watchers = new Map<string, WatchEntry>()

  constructor(private readonly resolveWorkspaceRoot?: WorkspaceRootResolver) {}

  async listTree(input: FileSystemListTreeInput): Promise<FileTreeNode[]> {
    const rootPath = await this.authorizeRoot(input.workspaceId, input.rootPath)
    const directoryPath = safeJoin(rootPath, input.relativePath ?? '.')
    await assertCanonicalInside(rootPath, directoryPath)
    const directoryStat = await stat(directoryPath)
    if (!directoryStat.isDirectory()) {
      throw new Error('Path is not a directory')
    }

    return this.listDirectory(rootPath, directoryPath)
  }

  async readFile(input: FileSystemReadFileInput): Promise<FileSystemReadFileResult> {
    const rootPath = await this.authorizeRoot(input.workspaceId, input.rootPath)
    const filePath = safeJoin(rootPath, input.relativePath)
    await assertCanonicalInside(rootPath, filePath)
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      throw new Error('Path is not a file')
    }
    if (fileStat.size > MAX_TEXT_FILE_BYTES) {
      throw new Error('File is larger than 2 MB')
    }

    const buffer = await readFile(filePath)
    ensureTextBuffer(buffer)

    return {
      relativePath: normalizeRelativePath(input.relativePath),
      content: buffer.toString('utf8'),
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs
    }
  }

  /** Base64 read for image/PDF previews (#10). Same root authorization and
   *  canonical-path guards as readFile; only known preview MIME types pass. */
  async readBinary(input: FileSystemReadBinaryInput): Promise<FileSystemReadBinaryResult> {
    const mimeType = previewMimeType(input.relativePath)
    if (!mimeType) {
      throw new Error('File type is not previewable')
    }
    const rootPath = await this.authorizeRoot(input.workspaceId, input.rootPath)
    const filePath = safeJoin(rootPath, input.relativePath)
    await assertCanonicalInside(rootPath, filePath)
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      throw new Error('Path is not a file')
    }
    if (fileStat.size > MAX_BINARY_FILE_BYTES) {
      throw new Error('File is larger than 12 MB')
    }

    const buffer = await readFile(filePath)
    return {
      relativePath: normalizeRelativePath(input.relativePath),
      base64: buffer.toString('base64'),
      mimeType,
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs
    }
  }

  async writeFile(input: FileSystemWriteFileInput): Promise<FileSystemWriteFileResult> {
    const rootPath = await this.authorizeRoot(input.workspaceId, input.rootPath)
    const filePath = safeJoin(rootPath, input.relativePath)
    await assertCanonicalInside(rootPath, filePath)
    const buffer = Buffer.from(input.content, 'utf8')
    if (buffer.length > MAX_TEXT_FILE_BYTES) {
      throw new Error('File is larger than 2 MB')
    }

    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      throw new Error('Path is not a file')
    }

    await writeFile(filePath, input.content, 'utf8')
    const updatedStat = await stat(filePath)
    return {
      relativePath: normalizeRelativePath(input.relativePath),
      size: updatedStat.size,
      mtimeMs: updatedStat.mtimeMs
    }
  }

  /** Creates a file that does not exist yet, under the same root checks as writeFile. Not reachable from the window. */
  async createFile(input: FileSystemWriteFileInput): Promise<FileSystemWriteFileResult> {
    const rootPath = await this.authorizeRoot(input.workspaceId, input.rootPath)
    const filePath = safeJoin(rootPath, input.relativePath)
    await assertCanonicalInside(rootPath, dirname(filePath))
    if (Buffer.byteLength(input.content, 'utf8') > MAX_TEXT_FILE_BYTES) throw new Error('File is larger than 2 MB')
    // `wx` fails when the file appeared meanwhile instead of replacing it.
    await writeFile(filePath, input.content, { encoding: 'utf8', flag: 'wx' })
    const created = await stat(filePath)
    return { relativePath: normalizeRelativePath(input.relativePath), size: created.size, mtimeMs: created.mtimeMs }
  }

  /**
   * Replaces a project file atomically, for a read-modify-write the main process does on the person's behalf (oxe.yaml,
   * .oxespace/policy.json). `expectedMtimeMs` is the `mtimeMs` `readFile` returned, or `null` when the file did not
   * exist. The content goes to a temporary file in the same folder, the target is checked again (unchanged since it was
   * read, still inside the root, still a file), and the temporary file is renamed over it, so a crash leaves the old file
   * or the new one, never half of one. A target that changed or appeared meanwhile is refused with
   * `project.file.changedMeanwhile`, writing nothing. Not reachable from the window.
   */
  async replaceFile(input: FileSystemWriteFileInput & { expectedMtimeMs: number | null }): Promise<FileSystemWriteFileResult> {
    const rootPath = await this.authorizeRoot(input.workspaceId, input.rootPath)
    const filePath = safeJoin(rootPath, input.relativePath)
    const relativePath = normalizeRelativePath(input.relativePath)
    await assertCanonicalInside(rootPath, dirname(filePath))
    if (Buffer.byteLength(input.content, 'utf8') > MAX_TEXT_FILE_BYTES) throw new Error('File is larger than 2 MB')
    const unchanged = async () => {
      const current = await stat(filePath).catch((error: NodeJS.ErrnoException) => { if (error?.code === 'ENOENT') return null; throw error })
      const same = input.expectedMtimeMs === null ? current === null : !!current && current.isFile() && current.mtimeMs === input.expectedMtimeMs
      if (!same) throw new MainRefusal('project.file.changedMeanwhile', { file: relativePath })
      // A link out of the root is judged by its target, as writeFile does.
      if (current) await assertCanonicalInside(rootPath, filePath)
      return current
    }
    const current = await unchanged()
    const temporary = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, input.content, { encoding: 'utf8', flag: 'wx' })
      if (current && process.platform !== 'win32') await chmod(temporary, current.mode & 0o7777)
      // Checked again right before the rename: an editor's save while the content was written is not overwritten.
      await unchanged()
      await rename(temporary, filePath)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
    const written = await stat(filePath)
    return { relativePath, size: written.size, mtimeMs: written.mtimeMs }
  }

  async watchFile(input: FileSystemWatchFileInput, onChanged: (event: FileSystemFileChangedEvent) => void): Promise<FileSystemWatchFileResult> {
    const rootPath = await this.authorizeRoot(input.workspaceId, input.rootPath)
    const filePath = safeJoin(rootPath, input.relativePath)
    await assertCanonicalInside(rootPath, filePath)
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      throw new Error('Path is not a file')
    }

    const watchId = randomUUID()
    const watcher = watch(filePath, () => {
      const entry = this.watchers.get(watchId)
      if (!entry) return
      if (entry.timeout) clearTimeout(entry.timeout)
      entry.timeout = setTimeout(() => {
        void this.emitFileChanged(watchId, input, onChanged)
      }, 80)
    })

    this.watchers.set(watchId, { watcher, timeout: null })
    return { watchId }
  }

  unwatchFile(watchId: string): void {
    const entry = this.watchers.get(watchId)
    if (!entry) return
    if (entry.timeout) clearTimeout(entry.timeout)
    entry.watcher.close()
    this.watchers.delete(watchId)
  }

  closeAll(): void {
    for (const watchId of this.watchers.keys()) {
      this.unwatchFile(watchId)
    }
  }

  private async authorizeRoot(workspaceId: string, requestedRoot: string): Promise<string> {
    const authoritativeRoot = this.resolveWorkspaceRoot?.(workspaceId, requestedRoot)
    if (this.resolveWorkspaceRoot && !authoritativeRoot) {
      throw new Error(`Workspace ${workspaceId} not found`)
    }
    const expected = resolve(authoritativeRoot ?? requestedRoot)
    if (authoritativeRoot && await realpath(resolve(requestedRoot)) !== await realpath(expected)) {
      throw new Error('Workspace root does not match the registered workspace')
    }
    return expected
  }

  private async listDirectory(rootPath: string, directoryPath: string): Promise<FileTreeNode[]> {
    const entries = (await readdir(directoryPath, { withFileTypes: true }))
      .filter((entry) => !entry.isDirectory() || !DEFAULT_EXCLUDED_DIRS.has(entry.name))
      .slice(0, MAX_DIRECTORY_ENTRIES)
    const nodes = await Promise.all(
      entries
        .map(async (entry) => {
          const absolutePath = safeJoin(directoryPath, entry.name)
          const entryStat = await stat(absolutePath)
          const relativePath = normalizeRelativePath(relative(rootPath, absolutePath))

          if (entry.isDirectory()) {
            return {
              name: entry.name,
              relativePath,
              type: 'directory' as const,
              size: null,
              children: undefined
            }
          }

          return {
            name: entry.name,
            relativePath,
            type: 'file' as const,
            size: entryStat.size
          }
        })
    )

    return nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  private async emitFileChanged(
    watchId: string,
    input: FileSystemWatchFileInput,
    onChanged: (event: FileSystemFileChangedEvent) => void
  ): Promise<void> {
    if (!this.watchers.has(watchId)) return

    try {
      const result = await this.readFile(input)
      onChanged({
        watchId,
        workspaceId: input.workspaceId,
        relativePath: result.relativePath,
        content: result.content,
        size: result.size,
        mtimeMs: result.mtimeMs
      })
    } catch {
      // Some editors replace files through rename/write sequences; ignore transient reads.
    }
  }
}

async function assertCanonicalInside(rootPath: string, targetPath: string): Promise<void> {
  const [canonicalRoot, canonicalTarget] = await Promise.all([realpath(rootPath), realpath(targetPath)])
  // realpath resolves casing on Windows too. Never fold case: Windows can
  // enable case-sensitive directories, and POSIX normally distinguishes them.
  const root = normalize(canonicalRoot)
  const target = normalize(canonicalTarget)
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  if (target !== root && !target.startsWith(prefix)) {
    throw new Error('Path resolves outside workspace root')
  }
}

function ensureTextBuffer(buffer: Buffer): void {
  if (buffer.includes(0)) {
    throw new Error('Binary files are not supported')
  }

  if (buffer.toString('utf8').includes('\uFFFD')) {
    throw new Error('Binary files are not supported')
  }
}

function normalizeRelativePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '')
}
