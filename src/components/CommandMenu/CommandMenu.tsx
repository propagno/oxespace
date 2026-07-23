import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { FileText, FolderGit2, Bot, Brain } from 'lucide-react'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import type { SearchResult } from '../../../shared/types/search'
import type { SemanticQueryHit } from '../../../shared/types/ipc'
import type { CommandPaletteAction } from '../CommandPalette/CommandPalette'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { useEditorStore } from '../../store/editor.store'
import { useWorkspaceStore } from '../../store/workspace.store'

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

function paneLabel(p: WorkspacePane): string {
  return p.displayName?.trim() || p.agentName?.trim() || (p.type === 'terminal' ? 'Terminal' : p.type)
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

/** Multi-word matcher for commands/workspaces/agents: every query token must
 *  appear somewhere in the haystack, so "usage rate" hits "Usage & Rate Limits". */
function matchesTokens(haystack: string, q: string): boolean {
  const hay = haystack.toLowerCase()
  return q.split(/\s+/).every((token) => !token || hay.includes(token))
}

/** Cheap fuzzy score for filename quick-open: basename substring > path
 *  substring > ordered subsequence. Returns 0 for no match. */
function fuzzyScore(path: string, q: string): number {
  const hay = path.toLowerCase()
  const base = hay.slice(hay.lastIndexOf('/') + 1)
  const inBase = base.indexOf(q)
  if (inBase >= 0) return 1000 - inBase
  if (hay.includes(q)) return 500
  let hi = 0
  for (const ch of q) {
    const f = hay.indexOf(ch, hi)
    if (f < 0) return 0
    hi = f + 1
  }
  return 100
}

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

  const q = query.trim().toLowerCase()
  const matchedWorkspaces = workspaces.filter(
    (w) => !q || matchesTokens(`${workspaceLabel(w)} ${w.rootPath}`, q)
  )
  const panes = workspace?.panes ?? []
  const matchedPanes = panes.filter((p) => !q || matchesTokens(paneLabel(p), q))
  const matchedActions = actions.filter((a) => {
    if (a.disabled) return false
    if (!q) return true
    return matchesTokens(`${a.title} ${a.subtitle ?? ''} ${(a.keywords ?? []).join(' ')}`, q)
  })
  const actionGroups = new Map<string, CommandPaletteAction[]>()
  for (const a of matchedActions) {
    const key = a.category ?? 'General'
    const arr = actionGroups.get(key) ?? []
    arr.push(a)
    actionGroups.set(key, arr)
  }

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
      title="Search"
      description="Search files and run commands"
    >
      <CommandInput value={query} onValueChange={setQuery} placeholder="Search files and commands…" />
      <CommandList>
        {matchedWorkspaces.length > 0 ? (
          <CommandGroup heading="Workspaces">
            {matchedWorkspaces.map((w) => (
              <CommandItem
                key={`ws-${w.id}`}
                value={`ws-${w.id}`}
                onSelect={() => runAction(() => onSelectWorkspace(w.id))}
              >
                <FolderGit2 />
                <span className="shrink-0">{workspaceLabel(w)}</span>
                <span className="truncate text-xs text-muted-foreground">{w.rootPath}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {matchedPanes.length > 0 ? (
          <CommandGroup heading="Agents">
            {matchedPanes.map((p) => (
              <CommandItem
                key={`pane-${p.id}`}
                value={`pane-${p.id}`}
                onSelect={() => runAction(() => onSelectPane(p.id))}
              >
                <Bot />
                <span className="shrink-0">{paneLabel(p)}</span>
                {p.agentName && p.displayName ? (
                  <span className="truncate text-xs text-muted-foreground">{p.agentName}</span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {[...actionGroups].map(([category, items]) => (
          <CommandGroup key={category} heading={category}>
            {items.map((a) => {
              const Icon = a.icon
              return (
                <CommandItem key={a.id} value={`cmd-${a.id}`} onSelect={() => runAction(a.run)}>
                  {Icon ? <Icon /> : null}
                  <span className="shrink-0">{a.title}</span>
                  {a.subtitle ? (
                    <span className="truncate text-xs text-muted-foreground">{a.subtitle}</span>
                  ) : null}
                </CommandItem>
              )
            })}
          </CommandGroup>
        ))}

        {q && nameMatches.length > 0 ? (
          <CommandGroup heading="Files">
            {nameMatches.map((p) => {
              const { name, dir } = splitPath(p)
              return (
                <CommandItem key={`name-${p}`} value={`name-${p}`} onSelect={() => openFile(p)}>
                  <FileText />
                  <span className="shrink-0">{name}</span>
                  {dir ? <span className="truncate text-xs text-muted-foreground">{dir}</span> : null}
                </CommandItem>
              )
            })}
          </CommandGroup>
        ) : null}

        {q && semanticHits.length > 0 ? (
          <CommandGroup heading="Semantic · e5-base">
            {semanticHits.map((h) => {
              const rel = workspace ? toRelative(h.filePath, workspace.rootPath) : h.filePath
              const { name, dir } = splitPath(rel)
              return (
                <CommandItem key={`sem-${h.filePath}`} value={`sem-${h.filePath}`} onSelect={() => openFile(rel)}>
                  <Brain />
                  <span className="shrink-0">{name}</span>
                  {dir ? <span className="truncate text-xs text-muted-foreground">{dir}</span> : null}
                </CommandItem>
              )
            })}
          </CommandGroup>
        ) : null}

        {q ? (
          <CommandGroup heading={loading ? 'Searching contents…' : `In file contents · ${results?.totalMatches ?? 0}`}>
            {files.flatMap((f) =>
              f.matches.slice(0, MATCHES_PER_FILE).map((m, i) => (
                <CommandItem
                  key={`${f.path}-${m.lineNumber}-${i}`}
                  value={`content-${f.path}-${m.lineNumber}-${i}`}
                  onSelect={() => openFile(f.path)}
                >
                  <FileText />
                  <span className="truncate">{f.path}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">:{m.lineNumber}</span>
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
          <CommandEmpty>No results</CommandEmpty>
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}
