import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { MemoryContext } from '../../../../shared/types/memory'

/** Conservative guard around native marker routing; unknown policy fails closed. */
export async function matchingMemoryMarker(cwd: string, context: MemoryContext): Promise<boolean> {
  let directory = resolve(cwd)
  for (;;) {
    let text = ''
    try { text = await readFile(join(directory, '.ai-memory.toml'), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false }
    if (text) {
      const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'))
      // Only capture-only markers are transparent. Other settings can alter native routing.
      const captureIndex = lines.indexOf('[capture]')
      const captureOnly = captureIndex === 0 && lines.slice(1).every(line => /^ignore_paths\s*=\s*\[.*\]\s*(#.*)?$/.test(line))
      if (!captureOnly) {
        const exact = (key: string, value: string): boolean => {
          const entries = lines.filter(line => new RegExp(`^${key}\\s*=`).test(line))
          return entries.length === 1 && new RegExp(`^${key}\\s*=\\s*["']${value}["']\\s*(#.*)?$`).test(entries[0])
        }
        return exact('workspace', context.workspace) && exact('project', context.project)
          && !lines.some(line => /^(project_strategy|default_global)\s*=/.test(line))
      }
    }
    const parent = dirname(directory)
    if (parent === directory) return false
    directory = parent
  }
}
