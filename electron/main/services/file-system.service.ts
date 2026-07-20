import { randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { normalize, relative, resolve, sep } from 'node:path'
import type {
  FileSystemFileChangedEvent,
  FileSystemListTreeInput,
  FileSystemReadFileInput,
  FileSystemReadFileResult,
  FileSystemWatchFileInput,
  FileSystemWatchFileResult,
  FileSystemWriteFileInput,
  FileSystemWriteFileResult,
  FileTreeNode
} from '../../../shared/types/ipc'
import { safeJoin } from '../utils/safe-join'

export const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024
export const MAX_DIRECTORY_ENTRIES = 500
export const DEFAULT_EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'coverage', '.next', 'build'])

interface WatchEntry {
  watcher: FSWatcher
  timeout: NodeJS.Timeout | null
}

export type WorkspaceRootResolver = (workspaceId: string) => string | null

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
    const authoritativeRoot = this.resolveWorkspaceRoot?.(workspaceId)
    if (this.resolveWorkspaceRoot && !authoritativeRoot) {
      throw new Error(`Workspace ${workspaceId} not found`)
    }
    const expected = resolve(authoritativeRoot ?? requestedRoot)
    if (authoritativeRoot && normalize(resolve(requestedRoot)).toLowerCase() !== normalize(expected).toLowerCase()) {
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
  const root = normalize(canonicalRoot).toLowerCase()
  const target = normalize(canonicalTarget).toLowerCase()
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
