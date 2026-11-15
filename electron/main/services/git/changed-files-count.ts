export function createChangedFilesCounter(options: { read: (rootPath: string) => Promise<{ files: unknown[] }>; debounceMs: number }): { count(rootPath: string): Promise<number | null> } {
  throw new Error('TODO T42: A39 (OXE-185, AG-04d, backend): one debounced changed-files ');
}
