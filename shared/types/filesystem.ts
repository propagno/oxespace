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

export interface FileSystemApi {
  listTree(input: FileSystemListTreeInput): Promise<FileTreeNode[]>
  readFile(input: FileSystemReadFileInput): Promise<FileSystemReadFileResult>
  writeFile(input: FileSystemWriteFileInput): Promise<FileSystemWriteFileResult>
  watchFile(input: FileSystemWatchFileInput): Promise<FileSystemWatchFileResult>
  unwatchFile(input: FileSystemUnwatchFileInput): Promise<void>
  onFileChanged(listener: (event: FileSystemFileChangedEvent) => void): () => void
}
