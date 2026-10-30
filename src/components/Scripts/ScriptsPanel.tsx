import { Code2, FileCode2, Play, RotateCw, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { RichText } from '../../i18n/RichText'
import { ToolPanel, Button, EmptyState, ErrorState, LoadingState, TextField } from '../../ui'
import type { FileTreeNode } from '../../../shared/types/ipc'
import type { Workspace } from '../../../shared/types/workspace'
import {
  buildScriptCommand,
  escapeDoubleQuotes,
  joinWorkspacePath
} from '../../../shared/utils/script-command'
import { useBackgroundStore } from '../../store/background.store'
import { humanizeError } from '../../utils/humanizeError'

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
  const { t } = useTranslation('code')
  const startJob = useBackgroundStore((state) => state.startJob)
  const [scripts, setScripts] = useState<ScriptEntry[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{ title: string; message: string; retry?: () => void } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const discovered = await discoverScripts(workspace.id, workspace.rootPath)
      setScripts(discovered)
    } catch (err) {
      setError({ title: t('scripts.listFailed'), message: humanizeError(err), retry: () => void load() })
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
      setError({ title: t('scripts.runFailed', { name: script.name }), message: humanizeError(err), retry: () => void handleRun(script) })
    } finally {
      setBusy(null)
    }
  }

  const content = (
    <>
      <header className="scripts-panel-header">
        <div className="scripts-panel-title">
          <Code2 size={14} aria-hidden="true" />
          <strong>{t('panels.scripts')}</strong>
          {!loading ? <span>{t('scripts.found', { count: scripts.length })}</span> : null}
        </div>
        <div className="scripts-panel-actions">
          <Button variant="ghost" size="sm" square aria-label={t('scripts.refresh')} title={t('scripts.refresh')} disabled={loading} onClick={() => void load()}>
            <RotateCw size={14} className={loading ? 'usage-spin' : ''} aria-hidden="true" />
          </Button>
          {!embedded ? (
            <Button variant="ghost" size="sm" square aria-label={t('scripts.close')} onClick={onClose}>
              <X size={14} aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </header>

      <div className="scripts-panel-search">
        <Search size={14} aria-hidden="true" />
        <TextField value={query} aria-label={t('scripts.filter')} placeholder={t('scripts.filterPlaceholder')} onChange={(event) => setQuery(event.currentTarget.value)} />
      </div>

      {error ? <ErrorState compact title={error.title} message={error.message} onRetry={error.retry} /> : null}

      <div className="scripts-panel-list">
        {loading && scripts.length === 0 ? <LoadingState label={t('scripts.loading')} /> : filtered.length === 0 ? (
          query.trim() && scripts.length > 0
            ? <EmptyState compact title={t('scripts.noMatch', { query: query.trim() })} />
            : <EmptyState icon={<FileCode2 size={20} />} title={t('scripts.none')}><RichText text={t('scripts.noneHint')} /></EmptyState>
        ) : filtered.map((script) => (
          <div key={script.id} className="scripts-panel-card">
            <div className="scripts-panel-card-main">
              <div className="scripts-panel-card-title">
                <strong>{script.name}</strong>
                <span>{script.extension}</span>
              </div>
              <code title={script.relativePath}>{script.relativePath}</code>
            </div>
            <button type="button" className="scripts-panel-run" aria-label={t('scripts.runLabel', { name: script.name })} title={t('scripts.runTitle')} disabled={busy === script.id} onClick={() => void handleRun(script)}>
              <Play size={12} aria-hidden="true" /> {busy === script.id ? t('scripts.starting') : t('scripts.run')}
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
    <ToolPanel className="scripts-panel" label={t('panels.scripts')} onClose={onClose}>
      {content}
    </ToolPanel>
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
    command: buildScriptCommand(fullPath, ext, window.oxe.app.platform)
  }
}
