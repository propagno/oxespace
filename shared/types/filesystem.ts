export type FileTreeNodeType = 'file' | 'directory'

export interface FileTreeNode {
  name: string
  relativePath: string
  type: FileTreeNodeType
  size: number | null
  children?: FileTreeNode[]
}

export interface FileSystemListTreeInput { workspaceId: string; rootPath: string; relativePath?: string }
export interface FileSystemReadFileInput { workspaceId: string; rootPath: string; relativePath: string }
export interface FileSystemReadFileResult { relativePath: string; content: string; size: number; mtimeMs: number }
export interface FileSystemWriteFileInput { workspaceId: string; rootPath: string; relativePath: string; content: string }
export interface FileSystemWriteFileResult { relativePath: string; size: number; mtimeMs: number }
export interface FileSystemWatchFileInput { workspaceId: string; rootPath: string; relativePath: string }
export interface FileSystemUnwatchFileInput { watchId: string }
export interface FileSystemWatchFileResult { watchId: string }
export interface FileSystemFileChangedEvent { watchId: string; workspaceId: string; relativePath: string; content: string; size: number; mtimeMs: number }

/** Binary read for rich previews (#10): images/PDF are returned base64-encoded
 *  so the renderer can build a `data:` URI — the CSP allows data: for img/font
 *  but not file:, and the text readFile would corrupt binary content. */
export interface FileSystemReadBinaryInput { workspaceId: string; rootPath: string; relativePath: string }
export interface FileSystemReadBinaryResult {
  relativePath: string
  /** Base64 payload (no data: prefix). */
  base64: string
  /** Sniffed from the extension, e.g. `image/png`, `application/pdf`. */
  mimeType: string
  size: number
  mtimeMs: number
}

export interface FileSystemApi {
  listTree(input: FileSystemListTreeInput): Promise<FileTreeNode[]>
  readFile(input: FileSystemReadFileInput): Promise<FileSystemReadFileResult>
  readBinary(input: FileSystemReadBinaryInput): Promise<FileSystemReadBinaryResult>
  writeFile(input: FileSystemWriteFileInput): Promise<FileSystemWriteFileResult>
  watchFile(input: FileSystemWatchFileInput): Promise<FileSystemWatchFileResult>
  unwatchFile(input: FileSystemUnwatchFileInput): Promise<void>
  onFileChanged(listener: (event: FileSystemFileChangedEvent) => void): () => void
}
