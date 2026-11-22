import { delimiter, extname, join } from 'node:path'

const resolvedExecutableCache = new Map<string, string>()

/** `exists` is the caller's existence probe: this module has no file system access of its own. */
export function resolveExecutable(
  executable: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean
): string {
  if (platform !== 'win32' || extname(executable)) return executable

  const pathValue = env.PATH ?? env.Path ?? env.path
  if (!pathValue) return executable
  const pathExtValue = env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD'
  const cacheKey = `${executable}\0${pathValue}\0${pathExtValue}`
  const cached = resolvedExecutableCache.get(cacheKey)
  if (cached) {
    if (exists(cached)) return cached
    resolvedExecutableCache.delete(cacheKey)
  }

  const pathExtensions = pathExtValue
    .split(';')
    .map((extension) => extension.trim())
    .filter(Boolean)

  const executableNames = pathExtensions.map((extension) => `${executable}${extension.toLowerCase()}`)
  executableNames.push(executable)

  if (executable.includes('\\') || executable.includes('/')) {
    const resolved = executableNames.find((candidate) => exists(candidate))
    if (resolved) resolvedExecutableCache.set(cacheKey, resolved)
    return resolved ?? executable
  }

  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const executableName of executableNames) {
      const candidate = join(directory, executableName)
      if (exists(candidate)) {
        resolvedExecutableCache.set(cacheKey, candidate)
        return candidate
      }
    }
  }

  return executable
}

/** Test-only: avoid positive executable resolutions leaking between cases. */
export function __resetExecutableCacheForTests(): void {
  resolvedExecutableCache.clear()
}
