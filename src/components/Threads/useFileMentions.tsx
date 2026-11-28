import { File, Folder, GitCompareArrows, MessageSquareText, TerminalSquare } from 'lucide-react'
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createChangesContextItem,
  createFileContextItem,
  createTerminalContextItem,
  createThreadContextItem,
  extractWorkspaceFolders,
  type ComposerContextItem
} from '../../../shared/types/composer-context'
import type { ConversationThread } from '../../../shared/types/thread'
import { getCachedFileList, getFileListCacheEpoch, setCachedFileList } from '../../lib/fileListCache'
import { useTerminalStore } from '../../store/terminal.store'
import { useThreadStore } from '../../store/thread.store'
import { Button } from '../../ui'
import { displayThreadTitle } from './threadTitle'

/** Matches the `@partial/path` or `@source:query` the caret is currently inside. */
const MENTION = /(^|\s)@([^\s@]*)$/
const MAX_RESULTS = 8
const MAX_PICKER_RESULTS = 8

export type ContextSourceKey = 'changes' | 'terminal' | 'folder' | 'thread'

interface ContextSourceSpec {
  key: ContextSourceKey
  token: string
  keywords: readonly string[]
}

export const CONTEXT_SOURCE_SPECS: readonly ContextSourceSpec[] = [
  { key: 'changes', token: '@changes', keywords: ['changes', 'git', 'diff', 'status', 'alteracoes', 'mudancas'] },
  { key: 'terminal', token: '@terminal', keywords: ['terminal', 'shell', 'console', 'output', 'screen', 'saida'] },
  { key: 'folder', token: '@folder', keywords: ['folder', 'dir', 'directory', 'tree', 'pasta', 'diretorio'] },
  { key: 'thread', token: '@thread', keywords: ['thread', 'conversation', 'chat', 'conversa'] }
]

function fuzzySubsequence(haystack: string, needle: string): boolean {
  let cursor = 0
  for (let i = 0; i < haystack.length && cursor < needle.length; i += 1) {
    if (haystack[i] === needle[cursor]) cursor += 1
  }
  return cursor === needle.length
}

/** Matches built-in `@changes`, `@terminal`, `@folder`, `@thread` sources with prefix/substring/fuzzy ranking. */
export function rankContextSources(query: string): ContextSourceKey[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return CONTEXT_SOURCE_SPECS.map(spec => spec.key)
  const scored: Array<{ key: ContextSourceKey; score: number }> = []
  for (const spec of CONTEXT_SOURCE_SPECS) {
    let best = -1
    for (const word of spec.keywords) {
      if (word.startsWith(needle)) { best = best < 0 ? 0 : Math.min(best, 0); break }
      if (word.includes(needle)) best = best < 0 ? 1 : Math.min(best, 1)
      else if (needle.length >= 2 && fuzzySubsequence(word, needle)) best = best < 0 ? 2 : Math.min(best, 2)
    }
    if (best >= 0) scored.push({ key: spec.key, score: best })
  }
  return scored.sort((a, b) => a.score - b.score).map(entry => entry.key)
}

/**
 * Ranks basename prefix matches first, then path substring matches. Pure, so it is testable. Every file is scored: a
 * cut after the first few hundred partial matches missed the exact name in a big repository (OXE-372).
 */
export function rankMentionFiles(files: string[], query: string, limit = MAX_RESULTS): string[] {
  const needle = query.trim().toLowerCase().replace(/\\/g, '/')
  if (!needle) return files.slice(0, limit)
  const scored: Array<{ file: string; score: number }> = []
  for (const file of files) {
    const lower = file.toLowerCase()
    const base = lower.slice(lower.lastIndexOf('/') + 1)
    const score = base.startsWith(needle) ? 0 : base.includes(needle) ? 1 : lower.includes(needle) ? 2 : -1
    if (score >= 0) scored.push({ file, score })
  }
  return scored.sort((a, b) => a.score - b.score || a.file.length - b.file.length).slice(0, limit).map(entry => entry.file)
}

export function rankMentionFolders(folders: readonly string[], query: string, limit = MAX_PICKER_RESULTS): string[] {
  const needle = query.trim().toLowerCase().replace(/\\/g, '/')
  if (!needle) return folders.slice(0, limit)
  const scored: Array<{ folder: string; score: number }> = []
  for (const folder of folders) {
    const lower = folder.toLowerCase()
    const base = lower.slice(lower.lastIndexOf('/') + 1)
    const score = base.startsWith(needle) ? 0 : base.includes(needle) ? 1 : lower.includes(needle) ? 2 : fuzzySubsequence(lower, needle) ? 3 : -1
    if (score >= 0) scored.push({ folder, score })
  }
  return scored.sort((a, b) => a.score - b.score || a.folder.length - b.folder.length).slice(0, limit).map(entry => entry.folder)
}

export function activeMention(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret)
  const match = MENTION.exec(before)
  return match ? { query: match[2], start: before.length - match[2].length - 1 } : null
}

/** Finds the best active terminal pane ID for a thread (integrated thread shell first, then active workspace pane). */
export function resolveActiveTerminalPaneId(threadId?: string): string | undefined {
  const state = useTerminalStore.getState()
  if (threadId) {
    const prefix = `thread-shell:${threadId}:`
    const runningShell = Object.entries(state.panes)
      .filter(([id, entry]) => id.startsWith(prefix) && entry.status === 'running')
      .sort((a, b) => (b[1].lastActivityAt ?? 0) - (a[1].lastActivityAt ?? 0))[0]
    if (runningShell) return runningShell[0]
  }
  if (state.activePaneId && state.panes[state.activePaneId]?.status === 'running') {
    return state.activePaneId
  }
  return undefined
}

type MentionOption =
  | { id: string; kind: 'source'; source: ContextSourceKey }
  | { id: string; kind: 'file'; file: string }
  | { id: string; kind: 'folder-pick'; folder: string }
  | { id: string; kind: 'thread-pick'; thread: ConversationThread }
  | { id: string; kind: 'terminal-pick'; paneId?: string; label: string; detail: string }

function parseSubmode(query: string): { mode: 'root' | 'folder' | 'thread' | 'terminal'; subQuery: string } {
  const lower = query.toLowerCase()
  if (lower.startsWith('folder:')) return { mode: 'folder', subQuery: query.slice('folder:'.length) }
  if (lower.startsWith('thread:')) return { mode: 'thread', subQuery: query.slice('thread:'.length) }
  if (lower.startsWith('terminal:')) return { mode: 'terminal', subQuery: query.slice('terminal:'.length) }
  return { mode: 'root', subQuery: query }
}

function sourceIcon(source: ContextSourceKey): ReactElement {
  switch (source) {
    case 'changes': return <GitCompareArrows size={14} aria-hidden="true" />
    case 'terminal': return <TerminalSquare size={14} aria-hidden="true" />
    case 'folder': return <Folder size={14} aria-hidden="true" />
    case 'thread': return <MessageSquareText size={14} aria-hidden="true" />
  }
}

/**
 * `@` mentions for the Thread composer: fuzzy-matches built-in context sources
 * (`@changes`, `@terminal`, `@folder`, `@thread`) alongside the project's tracked files,
 * and opens scoped inline pickers for `@folder:`, `@thread:`, and `@terminal:`.
 */
export function useFileMentions({ workspaceId, rootPath, threadId, projectId, draft, caret, enabled, onApply, onAttachContext }: {
  workspaceId?: string
  rootPath?: string
  threadId?: string
  projectId?: string
  draft: string
  caret: number
  enabled: boolean
  /** Receives the new text and the caret position that should follow it. */
  onApply(text: string, caret: number): void
  /** Attaches a structured context chip when the user selects a context source. */
  onAttachContext?(item: ComposerContextItem): void
}): { popup: ReactElement | null; onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean } {
  const { t } = useTranslation('thread')
  const mention = enabled ? activeMention(draft, caret) : null
  const hasMention = Boolean(mention)
  const mentionQuery = mention?.query ?? ''
  const [fetched, setFetched] = useState<{ key: string; files: string[] } | null>(null)
  const [treeDirs, setTreeDirs] = useState<string[]>([])
  const [threadPanes, setThreadPanes] = useState<Array<{ paneId: string; title: string }>>([])
  const [selection, setSelection] = useState<{ query: string; index: number }>({ query: '', index: 0 })
  // The start of the mention Escape closed: it stays closed while that mention is typed, a new one lists again (OXE-372).
  const [dismissed, setDismissed] = useState<number | null>(null)
  const key = workspaceId && rootPath ? `${workspaceId}:${rootPath}` : null
  const cachedHit = hasMention && rootPath ? getCachedFileList(rootPath) : null
  const files = useMemo(
    () => (fetched?.key === key ? fetched.files : cachedHit?.files ?? []),
    [fetched, key, cachedHit]
  )
  const threads = useThreadStore(state => state.threads)
  const terminalPanes = useTerminalStore(state => state.panes)
  const { mode, subQuery } = mention ? parseSubmode(mention.query) : { mode: 'root' as const, subQuery: '' }
  const selected = selection.query === mentionQuery ? selection.index : 0
  const setSelected = (next: number | ((current: number) => number)): void => {
    setSelection(prev => {
      const current = prev.query === mentionQuery ? prev.index : 0
      const index = typeof next === 'function' ? next(current) : next
      return { query: mentionQuery, index }
    })
  }

  useEffect(() => {
    if (!hasMention || !key || !workspaceId || !rootPath) return
    // OXE-299: the shared file-list cache (src/lib/fileListCache.ts), with CommandMenu and Design Grab: a fresh entry
    // answers at once, a stale one shows while it is fetched again.
    const hit = getCachedFileList(rootPath)
    if (hit?.fresh) return
    let active = true
    const epoch = getFileListCacheEpoch()
    void window.oxe?.search?.listFiles({ workspaceId, rootPath }).then(result => {
      if (result?.error) return
      const list = Array.isArray(result?.files) ? result.files : []
      setCachedFileList(rootPath, list, Date.now(), epoch)
      if (active) setFetched({ key, files: list })
    }, () => undefined)
    return () => { active = false }
  }, [hasMention, key, workspaceId, rootPath])

  useEffect(() => {
    if (mode !== 'folder' || !workspaceId || !rootPath || files.length > 0) return
    let active = true
    void window.oxe?.fs?.listTree({ workspaceId, rootPath }).then(nodes => {
      if (!active || !Array.isArray(nodes)) return
      const dirs = nodes.filter(node => node.type === 'directory').map(node => node.relativePath)
      setTreeDirs(dirs)
    }, () => undefined)
    return () => { active = false }
  }, [mode, workspaceId, rootPath, files.length])

  useEffect(() => {
    if (mode !== 'terminal' || !threadId) return
    let active = true
    void window.oxe?.thread?.panes?.(threadId).then(panes => {
      if (!active || !Array.isArray(panes)) return
      setThreadPanes(panes.map(pane => ({ paneId: pane.paneId, title: pane.title })))
    }, () => undefined)
    return () => { active = false }
  }, [mode, threadId])

  const folders = useMemo(() => {
    if (files.length > 0) return extractWorkspaceFolders(files)
    const unique = [...new Set(treeDirs)].sort((a, b) => a.localeCompare(b))
    return ['.', ...unique]
  }, [files, treeDirs])

  const options = useMemo<MentionOption[]>(() => {
    if (!mention) return []
    if (mode === 'folder') {
      return rankMentionFolders(folders, subQuery).map(folder => ({
        id: `folder:${folder}`,
        kind: 'folder-pick',
        folder
      }))
    }
    if (mode === 'thread') {
      const needle = subQuery.trim().toLowerCase()
      const candidates = threads
        .filter(item => !item.archived && item.id !== threadId)
        .sort((a, b) => {
          const sameA = projectId && a.projectId === projectId ? 0 : 1
          const sameB = projectId && b.projectId === projectId ? 0 : 1
          return sameA - sameB || b.updatedAt - a.updatedAt
        })
        .filter(item => {
          if (!needle) return true
          const title = displayThreadTitle(item.title).toLowerCase()
          return title.includes(needle) || item.id.toLowerCase().includes(needle) || fuzzySubsequence(title, needle)
        })
        .slice(0, MAX_PICKER_RESULTS)
      return candidates.map(item => ({ id: `thread:${item.id}`, kind: 'thread-pick', thread: item }))
    }
    if (mode === 'terminal') {
      const needle = subQuery.trim().toLowerCase()
      const list: Array<{ paneId?: string; label: string; detail: string }> = [
        { label: t('composer.contextSources.terminalActive'), detail: '@terminal' }
      ]
      const seen = new Set<string>()
      if (threadId) {
        const prefix = `thread-shell:${threadId}:`
        for (const [id, entry] of Object.entries(terminalPanes)) {
          if (!id.startsWith(prefix) || entry.status !== 'running' || seen.has(id)) continue
          seen.add(id)
          const slot = id.slice(prefix.length)
          list.push({ paneId: id, label: t('terminal.tab', { number: Number(slot) || 1 }), detail: id })
        }
      }
      for (const pane of threadPanes) {
        if (seen.has(pane.paneId)) continue
        seen.add(pane.paneId)
        list.push({ paneId: pane.paneId, label: pane.title, detail: pane.paneId })
      }
      return list
        .filter(item => !needle || item.label.toLowerCase().includes(needle) || (item.paneId ?? '').toLowerCase().includes(needle))
        .slice(0, MAX_PICKER_RESULTS)
        .map(item => ({ id: `terminal:${item.paneId ?? 'active'}`, kind: 'terminal-pick', ...item }))
    }

    // Root `@` menu: show matching context sources only when `onAttachContext` is provided
    // (or when the user explicitly types a source prefix), alongside ranked project files.
    const matchedSources = onAttachContext ? rankContextSources(mention.query) : []
    const matchedFiles = rankMentionFiles(files, mention.query)
    return [
      ...matchedSources.map(source => ({ id: `source:${source}`, kind: 'source' as const, source })),
      ...matchedFiles.map(file => ({ id: `file:${file}`, kind: 'file' as const, file }))
    ]
  }, [mention, mode, subQuery, folders, threads, threadId, projectId, terminalPanes, threadPanes, files, onAttachContext, t])

  const mentionStart = mention?.start ?? null
  if (dismissed !== null && dismissed !== mentionStart) setDismissed(null)
  const isSubmode = mode !== 'root'
  const open = Boolean(mention && (options.length > 0 || isSubmode) && dismissed !== mentionStart)

  const stripMention = (): void => {
    if (!mention) return
    const before = draft.slice(0, mention.start)
    const after = draft.slice(caret)
    const next = before.endsWith(' ') && after.startsWith(' ') ? before + after.slice(1) : before + after
    onApply(next, mention.start)
  }

  const replaceMention = (insert: string): void => {
    if (!mention) return
    const next = draft.slice(0, mention.start) + insert + draft.slice(caret)
    onApply(next, mention.start + insert.length)
  }

  const pick = (option: MentionOption): void => {
    if (!mention) return
    switch (option.kind) {
      case 'file':
        replaceMention(`@${option.file} `)
        return
      case 'source':
        if (option.source === 'folder') {
          replaceMention('@folder:')
          return
        }
        if (option.source === 'thread') {
          replaceMention('@thread:')
          return
        }
        if (option.source === 'changes') {
          if (onAttachContext) {
            onAttachContext(createChangesContextItem())
            stripMention()
          } else {
            replaceMention('@changes ')
          }
          return
        }
        if (option.source === 'terminal') {
          if (onAttachContext) {
            const activePane = resolveActiveTerminalPaneId(threadId)
            onAttachContext(createTerminalContextItem(activePane))
            stripMention()
          } else {
            replaceMention('@terminal ')
          }
          return
        }
        return
      case 'folder-pick': {
        const chip = createFileContextItem(option.folder, rootPath, 'folder')
        if (chip && onAttachContext) {
          onAttachContext(chip)
          stripMention()
        } else {
          replaceMention(`@folder:${option.folder} `)
        }
        return
      }
      case 'thread-pick': {
        const title = displayThreadTitle(option.thread.title)
        if (onAttachContext) {
          onAttachContext(createThreadContextItem(option.thread.id, title))
          stripMention()
        } else {
          replaceMention(`@thread:${option.thread.id} `)
        }
        return
      }
      case 'terminal-pick': {
        if (onAttachContext) {
          onAttachContext(createTerminalContextItem(option.paneId, option.paneId ? option.label : undefined))
          stripMention()
        } else {
          replaceMention(option.paneId ? `@terminal:${option.paneId} ` : '@terminal ')
        }
        return
      }
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false
    if (event.key === 'Escape' && mention) { event.preventDefault(); setDismissed(mention.start); return true }
    if (!options.length) return false
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(value => (value + 1) % options.length); return true }
    if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(value => (value - 1 + options.length) % options.length); return true }
    if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); pick(options[selected] ?? options[0]); return true }
    return false
  }

  const listLabel = mode === 'folder'
    ? t('composer.contextSources.pickFolders')
    : mode === 'thread'
      ? t('composer.contextSources.pickThreads')
      : mode === 'terminal'
        ? t('composer.contextSources.pickTerminals')
        : t('composer.files')

  const emptyMessage = mode === 'folder'
    ? t('composer.contextSources.noFolders')
    : mode === 'thread'
      ? t('composer.contextSources.noThreads')
      : t('composer.contextSources.noTerminals')

  const popup = open ? <div className="thread-mention-menu" role="listbox" aria-label={listLabel} data-mention-mode={mode}>
    {options.length === 0 ? (
      <p className="thread-mention-empty" role="status">{emptyMessage}</p>
    ) : options.map((option, index) => {
      const isSelected = index === selected
      if (option.kind === 'source') {
        return <Button key={option.id} variant="ghost" size="sm" role="option" aria-selected={isSelected} className={isSelected ? 'is-selected' : undefined}
          onMouseDown={event => { event.preventDefault(); pick(option) }} onMouseEnter={() => setSelected(index)}>
          {sourceIcon(option.source)}
          <strong>@{option.source}</strong>
          <small className="thread-mention-hint">{t(`composer.contextSources.${option.source}Hint`)}</small>
        </Button>
      }
      if (option.kind === 'folder-pick') {
        const display = option.folder === '.' ? t('composer.contextSources.folderRoot') : option.folder
        return <Button key={option.id} variant="ghost" size="sm" role="option" aria-selected={isSelected} className={isSelected ? 'is-selected' : undefined}
          onMouseDown={event => { event.preventDefault(); pick(option) }} onMouseEnter={() => setSelected(index)}>
          <Folder size={14} aria-hidden="true" />
          <strong>{display}</strong>
          <small className="thread-mention-hint">{option.folder === '.' ? './' : `${option.folder}/`}</small>
        </Button>
      }
      if (option.kind === 'thread-pick') {
        const title = displayThreadTitle(option.thread.title)
        return <Button key={option.id} variant="ghost" size="sm" role="option" aria-selected={isSelected} className={isSelected ? 'is-selected' : undefined}
          onMouseDown={event => { event.preventDefault(); pick(option) }} onMouseEnter={() => setSelected(index)}>
          <MessageSquareText size={14} aria-hidden="true" />
          <strong>{title}</strong>
          <small className="thread-mention-hint">{option.thread.provider}</small>
        </Button>
      }
      if (option.kind === 'terminal-pick') {
        return <Button key={option.id} variant="ghost" size="sm" role="option" aria-selected={isSelected} className={isSelected ? 'is-selected' : undefined}
          onMouseDown={event => { event.preventDefault(); pick(option) }} onMouseEnter={() => setSelected(index)}>
          <TerminalSquare size={14} aria-hidden="true" />
          <strong>{option.label}</strong>
          <small className="thread-mention-hint">{option.detail}</small>
        </Button>
      }
      const slash = option.file.lastIndexOf('/')
      return <Button key={option.id} variant="ghost" size="sm" role="option" aria-selected={isSelected} className={isSelected ? 'is-selected' : undefined}
        onMouseDown={event => { event.preventDefault(); pick(option) }} onMouseEnter={() => setSelected(index)}>
        <File size={14} aria-hidden="true" /><strong>{option.file.slice(slash + 1)}</strong><small>{slash > 0 ? option.file.slice(0, slash) : ''}</small>
      </Button>
    })}
  </div> : null

  return { popup, onKeyDown }
}
