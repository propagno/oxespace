import type { FileSystemService } from './file-system.service'
import type { FileTreeNode } from '../../../shared/types/ipc'

/**
 * Main-process twin of the renderer's `discoverScripts` (in ScriptsPanel.tsx).
 * Walks the workspace tree looking for `.ps1`/`.sh` files and reads root
 * `package.json` scripts. Used by the internal MCP `oxespace_list_scripts`
 * tool so the agent sees the same set the user sees in the Scripts panel.
 */

export type ScriptExtension = 'ps1' | 'sh' | 'npm'

export interface ScriptEntry {
  id: string
  name: string
  relativePath: string
  extension: ScriptExtension
  command: string
}

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'coverage', '.next', 'test-results'])
const MAX_DIRECTORIES = 220
const MAX_ENTRIES = 200

export async function discoverScripts(
  fileSystem: FileSystemService,
  workspaceId: string,
  rootPath: string
): Promise<ScriptEntry[]> {
  const entries: ScriptEntry[] = []
  let visited = 0

  async function walk(relativePath?: string): Promise<void> {
    if (visited >= MAX_DIRECTORIES || entries.length >= MAX_ENTRIES) return
    visited += 1
    const nodes: FileTreeNode[] = await fileSystem.listTree({ workspaceId, rootPath, relativePath })
    for (const item of nodes) {
      if (item.type === 'directory') {
        if (EXCLUDED_DIRS.has(item.name)) continue
        await walk(item.relativePath)
        if (entries.length >= MAX_ENTRIES) return
        continue
      }
      const script = toScriptEntry(item, rootPath)
      if (script) entries.push(script)
      if (entries.length >= MAX_ENTRIES) return
    }
  }

  await walk()
  entries.push(...await discoverPackageScripts(fileSystem, workspaceId, rootPath))
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

async function discoverPackageScripts(
  fileSystem: FileSystemService,
  workspaceId: string,
  rootPath: string
): Promise<ScriptEntry[]> {
  try {
    const packageFile = await fileSystem.readFile({ workspaceId, rootPath, relativePath: 'package.json' })
    const parsed = JSON.parse(packageFile.content) as { scripts?: unknown }
    if (!parsed.scripts || typeof parsed.scripts !== 'object' || Array.isArray(parsed.scripts)) return []

    return Object.entries(parsed.scripts)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
      .map(([name]) => ({
        id: `package:${name}`,
        name,
        relativePath: `package.json › scripts.${name}`,
        extension: 'npm' as const,
        command: `npm run "${escapeDoubleQuotes(name)}"`
      }))
  } catch {
    // package.json is optional; malformed files remain the editor's concern.
    return []
  }
}

function toScriptEntry(item: FileTreeNode, rootPath: string): ScriptEntry | null {
  const lower = item.name.toLowerCase()
  const ext: ScriptExtension | null = lower.endsWith('.ps1') ? 'ps1' : lower.endsWith('.sh') ? 'sh' : null
  if (!ext) return null
  const fullPath = joinWorkspacePath(rootPath, item.relativePath)
  return {
    id: item.relativePath,
    name: item.name.replace(/\.(ps1|sh)$/i, ''),
    relativePath: item.relativePath,
    extension: ext,
    command: ext === 'ps1'
      ? `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${escapeDoubleQuotes(fullPath)}"`
      : buildShellScriptCommand(fullPath)
  }
}

function joinWorkspacePath(rootPath: string, relativePath: string): string {
  const separator = rootPath.includes('\\') ? '\\' : '/'
  return `${rootPath.replace(/[\\/]+$/, '')}${separator}${relativePath.replace(/[\\/]/g, separator)}`
}

function escapeDoubleQuotes(value: string): string {
  return value.replace(/"/g, '\\"')
}

function buildShellScriptCommand(fullPath: string): string {
  const script = escapeDoubleQuotes(fullPath)
  return [
    'if exist "%ProgramFiles%\\Git\\bin\\bash.exe" ("%ProgramFiles%\\Git\\bin\\bash.exe" "' + script + '")',
    'else if exist "%LOCALAPPDATA%\\Programs\\Git\\bin\\bash.exe" ("%LOCALAPPDATA%\\Programs\\Git\\bin\\bash.exe" "' + script + '")',
    'else (echo Git Bash not found. Install Git for Windows to run .sh scripts. & exit /b 1)'
  ].join(' ')
}
