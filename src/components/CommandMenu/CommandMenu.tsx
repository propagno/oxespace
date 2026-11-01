import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { FileText, FolderGit2, Bot, Brain } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import type { SearchResult } from '../../../shared/types/search'
import type { SemanticQueryHit } from '../../../shared/types/ipc'
import type { CommandPaletteAction } from '../../utils/commandRegistry'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, commandStyles } from '../../ui/CommandPalette'
import { useEditorStore } from '../../store/editor.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { useCommandHistoryStore } from '../../store/command-history.store'
import { fuzzyScore, rankBy, rankText } from '../../utils/fuzzy'
import { KEYBINDINGS, chordsFor, type KeybindingId } from '../../keyboard/keybindings'
import { KeyChord } from '../Keyboard/KeyChord'
import { commandCategoryLabel, tCommand } from '../../commands/commandText'

interface CommandMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspace: Workspace | null
  /** The full command registry (shared with the legacy palette) — cmd-J is now
   *  the unified surface for commands + file name + file content search. */
  actions: CommandPaletteAction[]
  /** All open workspaces/worktrees, for jump-to (Orca cmd-J parity). */
  workspaces: Workspace[]
  onSelectWorkspace: (id: string) => void
  /** Focus a pane (agent/terminal) in the active workspace. */
  onSelectPane: (paneId: string) => void
}

function workspaceLabel(w: Workspace): string {
  return w.name?.trim() || w.rootPath.split(/[\\/]/).filter(Boolean).pop() || w.rootPath
}

function paneLabel(p: WorkspacePane, siblings: WorkspacePane[] = []): string {
  const named = p.displayName?.trim() || p.agentName?.trim()
  if (named) return named
  if (p.type !== 'terminal') return p.type
  // Unnamed terminals are told apart by position, not listed as identical rows.
  const index = siblings.filter(item => item.type === 'terminal').findIndex(item => item.id === p.id)
  return index >= 0 ? tCommand('menu.terminalAt', { index: index + 1 }) : tCommand('menu.terminal')
}

/** Semantic hits carry absolute paths; the editor opens workspace-relative ones. */
function toRelative(filePath: string, root: string): string {
  const norm = filePath.replace(/\\/g, '/')
  const base = root.replace(/\\/g, '/').replace(/\/$/, '')
  return norm.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? norm.slice(base.length + 1) : norm
}

// Ignore stale async search responses (a superseded query resolving late).
let requestToken = 0
const MATCHES_PER_FILE = 4
const MAX_NAME_MATCHES = 15

const KEYBINDING_IDS = new Set<string>(KEYBINDINGS.map(binding => binding.id))
/** A command's shortcut: a registry id (with the user's override) or a literal chord. */
function commandChord(shortcut: string | undefined): string | undefined {
  if (!shortcut) return undefined
  return KEYBINDING_IDS.has(shortcut) ? chordsFor(shortcut as KeybindingId)[0] : shortcut
}

const actionScore = (action: CommandPaletteAction, q: string): number =>
  rankText(action.title, `${action.subtitle ?? ''} ${(action.keywords ?? []).join(' ')} ${action.category ?? ''}`, q)

/**
 * cmd-J unified command palette (Wave 1 · #8 Native Search seed). Runs quick
 * actions and searches file contents through the existing ripgrep backend
 * (window.oxe.search). Built on the shadcn/cmdk `command` primitive (F1).
 */
export function CommandMenu({
  open,
  onOpenChange,
  workspace,
  actions,
  workspaces,
  onSelectWorkspace,
  onSelectPane
}: CommandMenuProps): ReactElement {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [fileList, setFileList] = useState<string[]>([])
  const [semanticHits, setSemanticHits] = useState<SemanticQueryHit[]>([])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults(null)
    setSemanticHits([])
    setLoading(false)
    if (!workspace) {
      setFileList([])
      return
    }
    // Snapshot the tracked file list once per open for name quick-open.
    let active = true
    window.oxe.search
      .listFiles({ workspaceId: workspace.id, rootPath: workspace.rootPath })
      .then((r) => { if (active) setFileList(Array.isArray(r?.files) ? r.files : []) })
      .catch(() => { if (active) setFileList([]) })
    return () => { active = false }
  }, [open, workspace])

  // Debounced content search via the ripgrep service.
  useEffect(() => {
    const q = query.trim()
    if (!q || !workspace) {
      setResults(null)
      setSemanticHits([])
      return
    }
    const token = ++requestToken
    setLoading(true)
    const handle = window.setTimeout(() => {
      window.oxe.search
        .run({ workspaceId: workspace.id, rootPath: workspace.rootPath, query: q })
        .then((r) => {
          if (token === requestToken) {
            setResults(r && Array.isArray(r.files) ? r : null)
            setLoading(false)
          }
        })
        .catch(() => {
          if (token === requestToken) setLoading(false)
        })
      // Semantic (e5-base) runs in parallel; returns [] when disabled/unindexed.
      window.oxe.semantic
        .query({ workspaceId: workspace.id, text: q, limit: 6 })
        .then((hits) => { if (token === requestToken) setSemanticHits(Array.isArray(hits) ? hits : []) })
        .catch(() => { if (token === requestToken) setSemanticHits([]) })
    }, 200)
    return () => window.clearTimeout(handle)
  }, [query, workspace])

  const close = useCallback(() => onOpenChange(false), [onOpenChange])

  const openFile = useCallback(
    (path: string) => {
      if (!workspace) return
      void useEditorStore
        .getState()
        .openFile({ workspaceId: workspace.id, rootPath: workspace.rootPath, relativePath: path })
      void useWorkspaceStore.getState().updateEditorState({ workspaceId: workspace.id, editorVisible: true })
      close()
    },
    [workspace, close]
  )

  const runAction = useCallback(
    (fn: () => void) => {
      fn()
      close()
    },
    [close]
  )
  const recentIds = useCommandHistoryStore(state => state.recent)
  const runCommand = useCallback(
    (action: CommandPaletteAction) => {
      useCommandHistoryStore.getState().record(action.id)
      runAction(action.run)
    },
    [runAction]
  )

  const q = query.trim().toLowerCase()
  // One ranker for every group: best match first, groups ordered by their best match.
  const matchedWorkspaces = rankBy(workspaces, q, (w) => rankText(workspaceLabel(w), w.rootPath, q))
  const panes = workspace?.panes ?? []
  const matchedPanes = rankBy(panes, q, (p) => rankText(paneLabel(p, panes), p.agentName ?? '', q))
  const enabled = actions.filter((a) => !a.disabled)
  const matchedActions = rankBy(enabled, q, (a) => actionScore(a, q))
  const actionGroups = new Map<string, CommandPaletteAction[]>()
  for (const a of matchedActions) {
    const key = a.category ?? 'General'
    const arr = actionGroups.get(key) ?? []
    arr.push(a)
    actionGroups.set(key, arr)
  }
  const byId = new Map(enabled.map((a) => [a.id, a]))
  const recentActions = q ? [] : recentIds.flatMap((id) => byId.get(id) ?? [])

  const files = results?.files ?? []
  const nameMatches = q
    ? fileList
        .map((p) => ({ p, s: fuzzyScore(p, q) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, MAX_NAME_MATCHES)
        .map((x) => x.p)
    : []

  const splitPath = (p: string): { name: string; dir: string } => {
    const i = p.lastIndexOf('/')
    return { name: i >= 0 ? p.slice(i + 1) : p, dir: i >= 0 ? p.slice(0, i) : '' }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      shouldFilter={false}
      title={t('commands.menu.title')}
      description={t('commands.menu.description')}
    >
      <CommandInput value={query} onValueChange={setQuery} placeholder={t('commands.menu.placeholder')} />
      <CommandList>
        {recentActions.length > 0 ? (
          <CommandGroup heading={t('commands.menu.recent')}>
            {recentActions.map((a) => <ActionItem key={`recent-${a.id}`} action={a} value={`recent-${a.id}`} onSelect={runCommand} />)}
          </CommandGroup>
        ) : null}

        {matchedWorkspaces.length > 0 ? (
          <CommandGroup heading={t('commands.menu.workspaces')}>
            {matchedWorkspaces.map((w) => (
              <CommandItem
                key={`ws-${w.id}`}
                value={`ws-${w.id}`}
                onSelect={() => runAction(() => onSelectWorkspace(w.id))}
              >
                <FolderGit2 />
                <span className={commandStyles.label}>{workspaceLabel(w)}</span>
                <span className={commandStyles.detail}>{w.rootPath}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {matchedPanes.length > 0 ? (
          <CommandGroup heading={t('commands.menu.agents')}>
            {matchedPanes.map((p) => (
              <CommandItem
                key={`pane-${p.id}`}
                value={`pane-${p.id}`}
                onSelect={() => runAction(() => onSelectPane(p.id))}
              >
                <Bot />
                <span className={commandStyles.label}>{paneLabel(p, panes)}</span>
                {p.agentName && p.displayName ? (
                  <span className={commandStyles.detail}>{p.agentName}</span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {[...actionGroups].map(([category, items]) => (
          <CommandGroup key={category} heading={commandCategoryLabel(category)}>
            {items.map((a) => <ActionItem key={a.id} action={a} value={`cmd-${a.id}`} onSelect={runCommand} />)}
          </CommandGroup>
        ))}

        {q && nameMatches.length > 0 ? (
          <CommandGroup heading={t('commands.menu.files')}>
            {nameMatches.map((p) => {
              const { name, dir } = splitPath(p)
              return (
                <CommandItem key={`name-${p}`} value={`name-${p}`} onSelect={() => openFile(p)}>
                  <FileText />
                  <span className={commandStyles.label}>{name}</span>
                  {dir ? <span className={commandStyles.detail}>{dir}</span> : null}
                </CommandItem>
              )
            })}
          </CommandGroup>
        ) : null}

        {q && semanticHits.length > 0 ? (
          <CommandGroup heading={t('commands.menu.semantic')}>
            {semanticHits.map((h) => {
              const rel = workspace ? toRelative(h.filePath, workspace.rootPath) : h.filePath
              const { name, dir } = splitPath(rel)
              return (
                <CommandItem key={`sem-${h.filePath}`} value={`sem-${h.filePath}`} onSelect={() => openFile(rel)}>
                  <Brain />
                  <span className={commandStyles.label}>{name}</span>
                  {dir ? <span className={commandStyles.detail}>{dir}</span> : null}
                </CommandItem>
              )
            })}
          </CommandGroup>
        ) : null}

        {q ? (
          <CommandGroup heading={loading ? t('commands.menu.searching') : t('commands.menu.contents', { count: results?.totalMatches ?? 0 })}>
            {files.flatMap((f) =>
              f.matches.slice(0, MATCHES_PER_FILE).map((m, i) => (
                <CommandItem
                  key={`${f.path}-${m.lineNumber}-${i}`}
                  value={`content-${f.path}-${m.lineNumber}-${i}`}
                  onSelect={() => openFile(f.path)}
                >
                  <FileText />
                  <span className={commandStyles.truncate}>{f.path}</span>
                  <span className={commandStyles.trailing}>:{m.lineNumber}</span>
                </CommandItem>
              ))
            )}
          </CommandGroup>
        ) : null}

        {q &&
        !loading &&
        matchedWorkspaces.length === 0 &&
        matchedPanes.length === 0 &&
        matchedActions.length === 0 &&
        nameMatches.length === 0 &&
        semanticHits.length === 0 &&
        files.length === 0 ? (
          <CommandEmpty>{t('commands.menu.empty')}</CommandEmpty>
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}

function ActionItem({ action, value, onSelect }: { action: CommandPaletteAction; value: string; onSelect: (action: CommandPaletteAction) => void }): ReactElement {
  const Icon = action.icon
  const chord = commandChord(action.shortcut)
  return (
    <CommandItem value={value} onSelect={() => onSelect(action)}>
      {Icon ? <Icon /> : null}
      <span className={commandStyles.label}>{action.title}</span>
      {action.subtitle ? <span className={commandStyles.detail}>{action.subtitle}</span> : null}
      {chord ? <span className={commandStyles.trailing}><KeyChord chord={chord} /></span> : null}
    </CommandItem>
  )
}
