/**
 * OXE-185 (AG-04d): one cheap, debounced source of OxeCode's changed-files count of a scope (the git status of its
 * folder). Calls for the same rootPath inside the debounce window share one read; another rootPath reads on its own;
 * after the window a call reads again. The count is files, never lines. A read that fails resolves to null, never 0.
 * OxeChat's count (the files a conversation changed) is a different source and is not served here.
 */
export interface ChangedFilesCounter {
  count(rootPath: string): Promise<number | null>
}

export function createChangedFilesCounter(options: { read: (rootPath: string) => Promise<{ files: unknown[] }>; debounceMs: number }): { count(rootPath: string): Promise<number | null> } {
  const pending = new Map<string, Promise<number | null>>()
  const debounceMs = Math.max(0, options.debounceMs)

  const readCount = async (rootPath: string): Promise<number | null> => {
    try {
      const status = await options.read(rootPath)
      return status && Array.isArray(status.files) ? status.files.length : null
    } catch {
      return null
    }
  }

  return {
    count(rootPath: string): Promise<number | null> {
      const shared = pending.get(rootPath)
      if (shared) return shared
      const next = new Promise<number | null>((resolve) => {
        setTimeout(() => {
          // The window closes when the read starts: a call after this point reads again.
          pending.delete(rootPath)
          void readCount(rootPath).then(resolve)
        }, debounceMs)
      })
      pending.set(rootPath, next)
      return next
    }
  }
}
