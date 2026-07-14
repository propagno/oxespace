import { Code2, FileCode2, Play, RotateCw, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { FileTreeNode } from '../../../shared/types/ipc'
import type { Workspace } from '../../../shared/types/workspace'
import { useBackgroundStore } from '../../store/background.store'

interface ScriptsPanelProps {
  workspace: Workspace
  onOpenBackground: () => void
  onClose: () => void
  embedded?: boolean
}

interface ScriptEntry {
  id: string
  name: string
  relativePath: string
  extension: 'ps1' | 'sh' | 'npm'
  command: string
}

const EXCLUDED_SCRIPT_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'coverage', '.next', 'test-results'])
const MAX_SCRIPT_DIRECTORIES = 220
const MAX_SCRIPT_ENTRIES = 200

export function ScriptsPanel({ embedded = false, onClose, onOpenBackground, workspace }: ScriptsPanelProps): ReactElement {
  const startJob = useBackgroundStore((state) => state.startJob)
  const [scripts, setScripts] = useState<ScriptEntry[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const discovered = await discoverScripts(workspace.id, workspace.rootPath)
      setScripts(discovered)
    } catch (err) {
      setError(toMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [workspace.id, workspace.rootPath])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return scripts
    return scripts.filter((script) =>
      script.name.toLowerCase().includes(normalized) ||
      script.relativePath.toLowerCase().includes(normalized) ||
      script.extension.includes(normalized)
    )
  }, [query, scripts])

  const handleRun = async (script: ScriptEntry): Promise<void> => {
    setBusy(script.id)
    setError(null)
    try {
      await startJob({
        workspaceId: workspace.id,
        workspaceRootPath: workspace.rootPath,
        command: script.command,
        label: script.name,
        paneRootPath: null,
        confirmed: true
      })
      onOpenBackground()
    } catch (err) {
      setError(toMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const content = (
    <>
      <header className="scripts-panel-header">
        <div className="scripts-panel-title">
          <Code2 size={14} aria-hidden="true" />
          <strong>Scripts</strong>
          <span>{scripts.length} found</span>
        </div>
        <div className="scripts-panel-actions">
          <button type="button" className="icon-button" aria-label="Refresh scripts" disabled={loading} onClick={() => void load()}>
            <RotateCw size={13} className={loading ? 'usage-spin' : ''} aria-hidden="true" />
          </button>
          {!embedded ? (
            <button type="button" className="icon-button" aria-label="Close scripts" onClick={onClose}>
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="scripts-panel-search">
        <Search size={13} aria-hidden="true" />
        <input value={query} placeholder="Search .ps1 or .sh scripts..." onChange={(event) => setQuery(event.currentTarget.value)} />
      </div>

      {error ? <div className="scripts-panel-error">{error}</div> : null}

      <div className="scripts-panel-list">
        {filtered.length === 0 ? (
          <div className="scripts-panel-empty">
            <FileCode2 size={32} aria-hidden="true" />
            <strong>{loading ? 'Loading scripts' : 'No script found'}</strong>
              <span>Add commands to <code>package.json</code>, or drop <code>.ps1</code>/<code>.sh</code> files in the workspace to run them as background jobs.</span>
          </div>
        ) : filtered.map((script) => (
          <div key={script.id} className="scripts-panel-card">
            <div className="scripts-panel-card-main">
              <div className="scripts-panel-card-title">
                <strong>{script.name}</strong>
                <span>{script.extension}</span>
              </div>
              <code title={script.relativePath}>{script.relativePath}</code>
            </div>
            <button type="button" className="scripts-panel-run" disabled={busy === script.id} onClick={() => void handleRun(script)}>
              <Play size={12} aria-hidden="true" /> Run
            </button>
          </div>
        ))}
      </div>
    </>
  )

  if (embedded) {
    return <div className="scripts-panel scripts-panel-embedded">{content}</div>
  }

  return (
    <div className="scripts-panel-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="scripts-panel" role="dialog" aria-modal="true" aria-label="Scripts" onMouseDown={(event) => event.stopPropagation()}>
        {content}
      </section>
    </div>
  )
}

async function discoverScripts(workspaceId: string, rootPath: string): Promise<ScriptEntry[]> {
  const entries: ScriptEntry[] = []
  let visitedDirectories = 0

  const walk = async (relativePath?: string): Promise<void> => {
    if (visitedDirectories >= MAX_SCRIPT_DIRECTORIES || entries.length >= MAX_SCRIPT_ENTRIES) return
    visitedDirectories += 1
    const nodes = await window.oxe.fs.listTree({ workspaceId, rootPath, relativePath })
    for (const item of nodes) {
      if (item.type === 'directory') {
        if (EXCLUDED_SCRIPT_DIRS.has(item.name)) continue
        await walk(item.relativePath)
        if (entries.length >= MAX_SCRIPT_ENTRIES) return
        continue
      }
      const script = toScriptEntry(item, rootPath)
      if (script) entries.push(script)
      if (entries.length >= MAX_SCRIPT_ENTRIES) return
    }
  }

  await walk()
  entries.push(...await discoverPackageScripts(workspaceId, rootPath))
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

async function discoverPackageScripts(workspaceId: string, rootPath: string): Promise<ScriptEntry[]> {
  try {
    const packageFile = await window.oxe.fs.readFile({ workspaceId, rootPath, relativePath: 'package.json' })
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
    return []
  }
}

function toScriptEntry(item: FileTreeNode, rootPath: string): ScriptEntry | null {
  const ext = item.name.toLowerCase().endsWith('.ps1') ? 'ps1' : item.name.toLowerCase().endsWith('.sh') ? 'sh' : null
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

function toMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+':\s*/i, '').replace(/^Error:\s*/i, '').trim()
}
