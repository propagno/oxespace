import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { ArrowLeftRight, CheckCircle2, Circle, ChevronDown, ChevronLeft, ChevronRight, FileMinus2, FilePlus2, FileDiff, FileSymlink, FolderGit2, Info, RefreshCw, Search, ShieldCheck, X } from 'lucide-react'
import type { GitCompareMode, GitDiffSummary, GitDiffSummaryFile, GitFileOriginal } from '../../../shared/types/git'
import type { GitHubWorktree } from '../../../shared/types/github'
import type { ThreadProvider } from '../../../shared/types/thread'
import { threadProductName } from '../../../shared/threadProviders'
import { formatDiffComments } from '../../../shared/types/diff-comments'
import { useTreeKeyboard } from '../../hooks/useTreeKeyboard'
import { useDiffCommentsStore } from '../../store/diff-comments.store'
import { buildChangeTree, chooseBase, comparisonKey, filterChangedFiles, formatCount, headLabel, isLargeDiff, isValidRef, languageFor, normalizeBranchName, orderedFiles, splitPath, swapSides, type ChangeTreeNode, type CompareHead, type CompareMode } from './changesModel'
import { loadLastTurnDiff } from './lastTurnDiff'
import { ReviewWithAgentDialog } from './ReviewWithAgentDialog'
import { scopeTranslationKey, type ReviewScopeKind } from './reviewWithAgent'
import { RefPicker, type RefPickerBranch } from './RefPicker'
import { resolveRequestedRef, useChangesRequestStore } from '../../store/changes-request.store'
import './ChangesPanel.css'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'
import { Button, ConfirmDialog, TextField, EmptyState, ErrorState, LoadingState, Menu, Skeleton, Spinner } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import { chunk, lazyFrom } from '../../lib/chunk'

const MonacoDiff = lazyFrom(chunk(() => import('./MonacoDiff')), m => m.default)

type Scope = ReviewScopeKind
const POLL_MS = 10_000

function StatusIcon({ file }: { file: GitDiffSummaryFile }): ReactElement {
  const Icon = file.status === 'A' ? FilePlus2 : file.status === 'D' ? FileMinus2 : file.status === 'R' ? FileSymlink : FileDiff
  const status = file.status === 'A' ? 'added' : file.status === 'D' ? 'deleted' : file.status === 'R' ? 'renamed' : 'modified'
  return <Icon size={14} className={`changes-status is-${file.status}`} role="img" aria-label={i18n.t(`changes.status.${status}`, { ns: 'code' })} />
}

const KIND: Record<string, [string, string]> = {
  ts: ['TS', 'var(--intent-info-fg)'], tsx: ['TSX', 'var(--intent-info-fg)'], js: ['JS', 'var(--intent-warning-fg)'], jsx: ['JSX', 'var(--intent-warning-fg)'], mjs: ['JS', 'var(--intent-warning-fg)'], cjs: ['JS', 'var(--intent-warning-fg)'],
  json: ['{}', 'var(--tx-muted)'], md: ['MD', 'var(--tx-muted)'], css: ['CSS', 'var(--intent-info-fg)'], html: ['<>', 'var(--intent-warning-fg)'], py: ['PY', 'var(--intent-success-fg)'], rs: ['RS', 'var(--intent-warning-fg)'],
  go: ['GO', 'var(--intent-info-fg)'], yml: ['YML', 'var(--intent-danger-fg)'], yaml: ['YML', 'var(--intent-danger-fg)'], sh: ['SH', 'var(--intent-success-fg)'], sql: ['SQL', 'var(--intent-info-fg)']
}

/** Small language chip so the tree reads like a file explorer, not a list of statuses. */
function KindBadge({ path }: { path: string }): ReactElement {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const [label, color] = KIND[extension] ?? ['•', 'var(--tx-muted)']
  return <span className="changes-kind" style={{ ['--kind' as string]: color }} aria-hidden="true">{label}</span>
}

const signature = (file: GitDiffSummaryFile): string => `${file.path}@${file.additions}:${file.deletions}`

const samePath = (a: string, b: string): boolean => a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

interface SavedComparison { base: string; head: CompareHead | null; mode: CompareMode }
const comparisonStorageKey = (rootPath: string): string => `oxe.changes.compare:${rootPath}`

/** The last pair chosen for this checkout. Storage can be missing or blocked, so any failure means "none". */
function readSavedComparison(rootPath: string): SavedComparison | null {
  try {
    const value = JSON.parse(localStorage.getItem(comparisonStorageKey(rootPath)) ?? 'null') as Partial<SavedComparison> | null
    if (!value || typeof value.base !== 'string' || !isValidRef(value.base)) return null
    const head = value.head
    const validHead = head == null ? null
      : head.kind === 'ref' && typeof head.ref === 'string' && isValidRef(head.ref) ? { kind: 'ref' as const, ref: head.ref }
      : head.kind === 'worktree' && typeof head.path === 'string' ? { kind: 'worktree' as const, path: head.path, branch: typeof head.branch === 'string' ? head.branch : null }
      : null
    return { base: value.base, head: validHead, mode: value.mode === 'direct' ? 'direct' : 'merge-base' }
  } catch { return null }
}

function saveComparison(rootPath: string, value: SavedComparison): void {
  try { localStorage.setItem(comparisonStorageKey(rootPath), JSON.stringify(value)) } catch { /* private mode */ }
}

function Counts({ additions, deletions }: { additions: number; deletions: number }): ReactElement | null {
  if (!additions && !deletions) return null
  return <span className="changes-counts">{additions > 0 && <span className="is-add">+{formatCount(additions)}</span>}{deletions > 0 && <span className="is-del">−{formatCount(deletions)}</span>}</span>
}

function TreeNode({ node, depth, selected, collapsed, viewed, onToggle, onSelect }: {
  node: ChangeTreeNode; depth: number; selected: string | null; collapsed: Set<string>; viewed: Set<string>; onToggle(path: string): void; onSelect(path: string): void
}): ReactElement {
  if (node.kind === 'file') {
    return <li role="none"><button type="button" role="treeitem" aria-level={depth + 1} aria-selected={selected === node.path} className={`changes-tree-row is-${node.file!.status}${viewed.has(signature(node.file!)) ? ' is-viewed' : ''}`} aria-current={selected === node.path ? 'true' : undefined} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => onSelect(node.path)} title={node.path}>
      <KindBadge path={node.path} /><span className="changes-tree-name">{node.name}</span><Counts additions={node.additions} deletions={node.deletions} />
    </button></li>
  }
  const open = !collapsed.has(node.path)
  return <li role="none">
    <button type="button" role="treeitem" aria-level={depth + 1} className="changes-tree-row is-dir" aria-expanded={open} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => onToggle(node.path)} title={node.path}>
      {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}<span className="changes-tree-name">{node.name}</span>
    </button>
    {open && <ul role="none">{node.children.map(child => <TreeNode key={`${child.kind}:${child.path}`} node={child} depth={depth + 1} selected={selected} collapsed={collapsed} viewed={viewed} onToggle={onToggle} onSelect={onSelect} />)}</ul>}
  </li>
}

/**
 * Branch changes against a base ref: toolbar with scope and `branch → base`
 * pickers, one file at a time in a side-by-side diff, tree of files on the right.
 */
export function ChangesPanel({ workspaceId, rootPath, threadId, currentProvider, onClose, onSendComments }: {
  workspaceId: string; rootPath: string; threadId?: string; currentProvider?: ThreadProvider; onClose?: () => void
  /** Receives the formatted review comments; resolve true when they were delivered so they can be cleared. */
  onSendComments?: (text: string) => boolean | Promise<boolean>
}): ReactElement {
  const { t } = useTranslation('code')
  const [scope, setScope] = useState<Scope>('branch')
  const [base, setBase] = useState<string | null>(null)
  const [branches, setBranches] = useState<RefPickerBranch[]>([])
  const [worktrees, setWorktrees] = useState<GitHubWorktree[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  // Side B: null is this checkout's work tree (the default); otherwise a ref or another worktree.
  const [headChoice, setHeadChoice] = useState<CompareHead | null>(null)
  // Branches, worktrees and the default pair are loaded.
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState<CompareMode>('merge-base')
  const [summary, setSummary] = useState<GitDiffSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const treeNav = useTreeKeyboard<HTMLUListElement>()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [content, setContent] = useState<{ path: string; original: GitFileOriginal; modified: string } | null>(null)
  const [contentError, setContentError] = useState('')
  const request = useRef(0)
  // Line comments are shared with the classic review, keyed by workspace + file + side + line.
  const allComments = useDiffCommentsStore(state => state.comments)
  const addComment = useDiffCommentsStore(state => state.add)
  const removeComment = useDiffCommentsStore(state => state.remove)
  const clearComments = useDiffCommentsStore(state => state.clear)
  const markSent = useDiffCommentsStore(state => state.markSent)
  const workspaceComments = useMemo(() => allComments.filter(comment => comment.workspaceId === workspaceId), [allComments, workspaceId])
  // A comment already sent is kept (its card says so) but is no longer pending.
  const pendingComments = useMemo(() => workspaceComments.filter(comment => comment.sentAt == null), [workspaceComments])
  const [sendNotice, setSendNotice] = useState<{ kind: 'sent' | 'failed'; text: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [reviewAgentOpen, setReviewAgentOpen] = useState(false)
  const [lastTurnRoot, setLastTurnRoot] = useState(rootPath)
  // The workspace whose comments are waiting for a confirmation, so switching workspaces never discards the other's.
  const [discardFor, setDiscardFor] = useState<string | null>(null)
  useEffect(() => {
    if (sendNotice?.kind !== 'sent') return
    const timer = window.setTimeout(() => setSendNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [sendNotice])
  const effectiveBase = scope !== 'branch' ? 'HEAD' : base
  // `current` reads `detached@<sha>` for a detached HEAD, which is a label, not a ref.
  const thisTree: CompareHead = { kind: 'worktree', path: rootPath, branch: current?.startsWith('detached@') ? null : current }
  const head: CompareHead = scope !== 'branch' ? thisTree : headChoice ?? thisTree
  const effectiveMode: CompareMode = scope !== 'branch' ? 'merge-base' : mode
  // What git is asked: the staged scope is the index against HEAD (OXE-323).
  const requestMode: GitCompareMode = scope === 'staged' ? 'staged' : effectiveMode
  const defaultPair = head.kind === 'worktree' && head.path === rootPath && effectiveMode === 'merge-base'
  // The work tree being compared, which is where git and file reads run; a ref side runs in this checkout.
  const diffRoot = scope === 'last-turn' ? lastTurnRoot : head.kind === 'worktree' ? head.path : rootPath
  const headRef = head.kind === 'ref' ? head.ref : undefined
  // "Viewed" marks persist per repository + comparison and reset when a file's numbers change. The default
  // pair keeps the key it always had, so marks made before both sides could be chosen survive.
  const [viewed, setViewed] = useState<Set<string>>(new Set())
  const viewedKey = scope === 'staged' ? `oxe.changes.viewed:${rootPath}:staged`
    : scope === 'last-turn' ? `oxe.changes.viewed:${rootPath}:last-turn`
    : defaultPair ? `oxe.changes.viewed:${rootPath}:${effectiveBase ?? ''}` : `oxe.changes.viewed:${rootPath}:${comparisonKey(effectiveBase ?? '', head, effectiveMode)}`
  useEffect(() => {
    try { setViewed(new Set(JSON.parse(localStorage.getItem(viewedKey) ?? '[]') as string[])) } catch { setViewed(new Set()) }
  }, [viewedKey])
  const toggleViewed = (file: GitDiffSummaryFile): void => setViewed(value => {
    const next = new Set(value); const key = signature(file)
    if (next.has(key)) next.delete(key); else next.add(key)
    try { localStorage.setItem(viewedKey, JSON.stringify([...next].slice(-2000))) } catch { /* private mode */ }
    return next
  })

  // Current branch, branch list and the default base are resolved once per root.
  useEffect(() => {
    let active = true
    const input = { workspaceId, rootPath }
    void window.oxe.git.getBranch(input).then(value => { if (active) setCurrent(value.branch ?? (value.shortSha ? `detached@${value.shortSha}` : null)) }, () => undefined)
    const listed = window.oxe.github.listBranches(input).then(list => (list ?? []).flatMap(branch => {
      const name = normalizeBranchName(branch.name)
      return name ? [{ name, remote: branch.remote }] : []
    }), () => [] as RefPickerBranch[])
    const resolved = window.oxe.github.resolveWorktreeBase(input).then(value => value?.baseRef ?? null, () => null)
    const trees = window.oxe.github.listWorktrees(input).then(list => list ?? [], () => [] as GitHubWorktree[])
    void Promise.all([listed, resolved, trees]).then(([list, baseRef, treeList]) => {
      if (!active) return
      const unique = [...new Map(list.map(branch => [branch.name, branch])).values()]
      setBranches(unique)
      setWorktrees(treeList)
      const saved = readSavedComparison(rootPath)
      setBase(saved?.base ?? chooseBase(baseRef, unique.map(branch => branch.name)))
      setMode(saved?.mode ?? 'merge-base')
      // A saved worktree side is restored only while that worktree still exists.
      setHeadChoice(saved?.head?.kind === 'worktree' ? (treeList.some(tree => samePath(tree.path, (saved.head as { path: string }).path)) ? saved.head : null) : saved?.head ?? null)
      setReady(true)
    })
    return () => { active = false; setReady(false) }
  }, [workspaceId, rootPath])

  // A comparison another panel asked for (a pull request's branches, one file from the editor). Applied
  // after the branches are known, so the default choice above does not overwrite it.
  const pendingRequest = useChangesRequestStore(state => state.byWorkspace[workspaceId])
  useEffect(() => {
    if (!ready || !pendingRequest) return
    useChangesRequestStore.getState().clear(workspaceId)
    const names = branches.map(branch => branch.name)
    setScope('branch')
    choose({
      ...(pendingRequest.base ? { base: resolveRequestedRef(pendingRequest.base, names) } : {}),
      ...(pendingRequest.head ? { head: { kind: 'ref' as const, ref: resolveRequestedRef(pendingRequest.head, names) } } : {})
    })
    if (pendingRequest.path) { setQuery(pendingRequest.path); setSelectedPath(pendingRequest.path) }
    // `choose` reads the current state; the request is applied once, when it arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pendingRequest, workspaceId])

  const choose = (next: { base?: string; head?: CompareHead | null; mode?: CompareMode }): void => {
    const nextBase = next.base ?? base
    const nextHead = next.head === undefined ? headChoice : next.head
    const nextMode = next.mode ?? mode
    if (next.base !== undefined) setBase(next.base)
    if (next.head !== undefined) setHeadChoice(next.head)
    if (next.mode !== undefined) setMode(next.mode)
    setSelectedPath(null)
    if (nextBase) saveComparison(rootPath, { base: nextBase, head: nextHead, mode: nextMode })
  }

  const load = useCallback(async (quiet = false) => {
    if (scope === 'last-turn') {
      const id = ++request.current
      if (!quiet) setLoading(true)
      try {
        const result = await loadLastTurnDiff({ workspaceId, rootPath, threadId })
        if (id !== request.current) return
        setLastTurnRoot(result.rootPath)
        setSummary(result.summary); setError('')
      } catch (cause) {
        if (id === request.current) setError(humanizeError(cause))
      } finally { if (id === request.current) setLoading(false) }
      return
    }
    if (!effectiveBase) return
    const id = ++request.current
    if (!quiet) setLoading(true)
    try {
      const value = await window.oxe.git.getDiffSummary({ workspaceId, rootPath: diffRoot, base: effectiveBase, includeUncommitted: requestMode !== 'staged', head: headRef, mode: requestMode })
      if (id !== request.current) return
      setSummary(value); setError(value.error ?? '')
    } catch (cause) {
      if (id === request.current) setError(humanizeError(cause))
    } finally { if (id === request.current) setLoading(false) }
  }, [scope, workspaceId, rootPath, threadId, diffRoot, effectiveBase, headRef, requestMode])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    // Two refs do not change on their own; only a work-tree side is polled.
    if (headRef) return
    const refresh = (): void => { if (document.visibilityState !== 'hidden') void load(true) }
    const timer = window.setInterval(refresh, POLL_MS)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [load, headRef])

  const files = useMemo(() => filterChangedFiles(summary?.files ?? [], query), [summary, query])
  const tree = useMemo(() => buildChangeTree(files), [files])
  const ordered = useMemo(() => orderedFiles(tree), [tree])
  const selected = ordered.find(file => file.path === selectedPath) ?? ordered[0] ?? null
  const large = isLargeDiff(summary?.files.length ?? 0, (summary?.additions ?? 0) + (summary?.deletions ?? 0))
  const index = selected ? ordered.findIndex(file => file.path === selected.path) : -1

  // Fetch both sides of the selected file. A work-tree side B is read through the allowlisted fs API, a ref
  // side B from git.
  const compiledAt = summary?.compiledAt
  useEffect(() => {
    if (!selected || !effectiveBase || selected.binary) { setContent(null); return }
    let active = true
    setContentError('')
    const original = window.oxe.git.getFileOriginal({ workspaceId, rootPath: diffRoot, base: effectiveBase, includeUncommitted: requestMode !== 'staged', path: selected.path, oldPath: selected.oldPath, head: headRef, mode: requestMode })
    const modified = selected.status === 'D' ? Promise.resolve('')
      : requestMode === 'staged' ? window.oxe.git.getFileOriginal({ workspaceId, rootPath: diffRoot, base: effectiveBase, includeUncommitted: false, path: selected.path, mode: 'staged', side: 'index' }).then(result => result.content, () => '')
      : headRef ? window.oxe.git.getFileAtRef({ workspaceId, rootPath, ref: headRef, path: selected.path }).then(result => result.content, () => '')
      : window.oxe.fs.readFile({ workspaceId, rootPath: diffRoot, relativePath: selected.path }).then(result => result.content, () => '')
    void Promise.all([original, modified]).then(([originalValue, modifiedValue]) => {
      if (active) setContent({ path: selected.path, original: originalValue, modified: modifiedValue })
    }, cause => { if (active) setContentError(humanizeError(cause)) })
    return () => { active = false }
  }, [selected?.path, selected?.status, selected?.oldPath, selected?.binary, effectiveBase, compiledAt, workspaceId, rootPath, diffRoot, headRef, requestMode])

  const sendComments = async (): Promise<void> => {
    if (!onSendComments || !pendingComments.length || sending) return
    const batch = pendingComments
    setSending(true)
    let delivered: boolean
    try { delivered = await onSendComments(formatDiffComments(batch)) } catch { delivered = false } finally { setSending(false) }
    if (delivered) {
      markSent(batch.map(item => item.id), Date.now())
      setSendNotice({ kind: 'sent', text: t('changes.comments.sent', { count: batch.length }) })
    } else setSendNotice({ kind: 'failed', text: t('changes.comments.notSent') })
  }
  const go = (offset: number): void => { const next = ordered[index + offset]; if (next) setSelectedPath(next.path) }
  const swapped = effectiveBase ? swapSides(effectiveBase, head.kind === 'worktree' && head.path === rootPath ? thisTree : head) : null
  const headSelected = head.kind === 'ref' ? `ref:${head.ref}` : `tree:${worktrees.find(tree => samePath(tree.path, head.path))?.path ?? head.path}`
  const headText = head.kind === 'worktree' && head.path === rootPath ? (current ?? 'HEAD') : headLabel(head)
  const toggleDir = (path: string): void => setCollapsed(value => { const next = new Set(value); if (next.has(path)) next.delete(path); else next.add(path); return next })
  const name = selected ? splitPath(selected.path) : null
  // Stable identity: the diff redraws its comment zones whenever this object changes.
  const selectedPathForReview = selected?.path ?? null
  const fileReview = useMemo(() => selectedPathForReview ? {
    comments: workspaceComments.filter(comment => comment.filePath === selectedPathForReview),
    onRemove: removeComment,
    onAdd: (side: 'old' | 'new', lineNo: number, lineContent: string, body: string) => addComment({ workspaceId, filePath: selectedPathForReview, side, lineNo, lineContent, body })
  } : undefined, [workspaceComments, selectedPathForReview, removeComment, addComment, workspaceId])
  const viewedCount = (summary?.files ?? []).filter(file => viewed.has(signature(file))).length
  const scopeKey = scopeTranslationKey(scope)

  return <section className="changes-panel" aria-label={t('panels.changes')} data-testid="changes-panel">
    {/* A plain bar, not a <header>: inside the dock the DockPanel's header is the panel's one header (BRD-15). */}
    <div className="changes-toolbar">
      <Menu label={t('changes.scope.label')} trigger={<button type="button" className="changes-pill" aria-label={`${t('changes.scope.label')}: ${t(`changes.scope.${scopeKey}`)}${effectiveMode === 'direct' ? ` · ${t('changes.scope.directShort')}` : ''}`}>{t(`changes.scope.${scopeKey}`)}{effectiveMode === 'direct' ? ` · ${t('changes.scope.directShort')}` : ''}<ChevronDown size={12} aria-hidden="true" /></button>} items={[
        { type: 'check', label: t('changes.scope.compareBranches'), checked: scope === 'branch', onSelect: () => { setScope('branch'); setSelectedPath(null) } },
        { type: 'check', label: t('changes.scope.uncommittedChanges'), checked: scope === 'uncommitted', onSelect: () => { setScope('uncommitted'); setSelectedPath(null) } },
        { type: 'check', label: t('changes.scope.staged'), checked: scope === 'staged', onSelect: () => { setScope('staged'); setSelectedPath(null) } },
        { type: 'check', label: t('changes.scope.lastTurn'), checked: scope === 'last-turn', onSelect: () => { setScope('last-turn'); setSelectedPath(null) } },
        { type: 'separator' },
        { type: 'label', label: t('changes.scope.from') },
        { type: 'check', label: t('changes.scope.mergeBase'), checked: mode === 'merge-base', disabled: scope !== 'branch', onSelect: () => choose({ mode: 'merge-base' }) },
        { type: 'check', label: t('changes.scope.direct'), checked: mode === 'direct', disabled: scope !== 'branch', onSelect: () => choose({ mode: 'direct' }) }
      ]} />
      {summary && (summary.additions > 0 || summary.deletions > 0) && <span className="changes-totals" role="img" aria-label={t('changes.totals', { additions: formatCount(summary.additions), deletions: formatCount(summary.deletions) })}><span className="is-add" aria-hidden="true">+{formatCount(summary.additions)}</span><span className="is-del" aria-hidden="true">−{formatCount(summary.deletions)}</span></span>}
      <span className="changes-sides" role="group" aria-label={t('changes.sides')}>
        <RefPicker label={t('changes.base')} value={effectiveBase ?? '…'} branches={branches} selected={`ref:${effectiveBase ?? ''}`} disabled={scope !== 'branch'} onPickRef={ref => choose({ base: ref })} />
        <button type="button" className="changes-icon" aria-label={t('changes.swap')} title={swapped ? t('changes.swap') : t('changes.swapDetached')} disabled={scope !== 'branch' || !swapped} onClick={() => { if (swapped) choose({ base: swapped.base, head: swapped.head }) }}><ArrowLeftRight size={14} aria-hidden="true" /></button>
        <RefPicker label={t('changes.head')} value={headText} icon={head.kind === 'worktree' ? <FolderGit2 size={14} aria-hidden="true" /> : undefined} branches={branches} worktrees={worktrees} selected={headSelected} disabled={scope !== 'branch'}
          onPickRef={ref => choose({ head: { kind: 'ref', ref } })}
          onPickWorktree={tree => choose({ head: samePath(tree.path, rootPath) ? null : { kind: 'worktree', path: tree.path, branch: tree.branch } })} />
      </span>
      <span className="changes-toolbar-spacer" />
      <Button
        variant="secondary"
        size="sm"
        icon={<ShieldCheck size={14} aria-hidden="true" />}
        disabled={(summary?.files.length ?? 0) === 0}
        title={(summary?.files.length ?? 0) === 0 ? t('changes.reviewAgent.noFilesTitle') : t('changes.reviewAgent.triggerTitle')}
        onClick={() => setReviewAgentOpen(true)}
      >
        {t('changes.reviewAgent.trigger')}
      </Button>
      {pendingComments.length > 0 && <span className="changes-review-comments" role="group" aria-label={t('changes.comments.label')}>
        {/* The send button already says the count; the separate count shows only when there is no send button. */}
        {!onSendComments && <span><b>{pendingComments.length}</b><span className="changes-review-label"> {t('changes.comments.count', { count: pendingComments.length })}</span></span>}
        <button type="button" aria-label={t('changes.comments.discard')} title={t('changes.comments.discardTitle')} onClick={() => setDiscardFor(workspaceId)}><X size={14} aria-hidden="true" /></button>
      </span>}
      {pendingComments.length > 0 && onSendComments && <Button variant="primary" size="sm" loading={sending} title={t('changes.comments.sendTitle')} onClick={() => void sendComments()}>{t('changes.comments.sendCount', { count: pendingComments.length })}</Button>}
      <button type="button" className="changes-icon" aria-label={t('changes.refresh')} title={t('changes.refresh')} onClick={() => void load()} disabled={loading}>{loading ? <Spinner size="sm" decorative /> : <RefreshCw size={14} aria-hidden="true" />}</button>
      {onClose && <button type="button" className="changes-icon" aria-label={t('changes.close')} title={t('changes.close')} onClick={onClose}><X size={14} aria-hidden="true" /></button>}
    </div>
    {large && <div className="changes-banner" role="note"><Info size={14} aria-hidden="true" /><span>{t('changes.large')}</span>
      <span className="changes-banner-nav"><button type="button" aria-label={t('changes.previousFile')} onClick={() => go(-1)} disabled={index <= 0}><ChevronLeft size={14} aria-hidden="true" /></button><button type="button" aria-label={t('changes.nextFile')} onClick={() => go(1)} disabled={index < 0 || index >= ordered.length - 1}><ChevronRight size={14} aria-hidden="true" /></button></span></div>}
    {error && <ErrorState compact title={t('changes.readFailed')} message={error} onRetry={() => void load()} />}
    {sendNotice && <div role="status" className="changes-note changes-send-notice"><span>{sendNotice.text}</span>{sendNotice.kind === 'failed' && <Button variant="secondary" size="sm" loading={sending} onClick={() => void sendComments()}>{t('changes.comments.retry')}</Button>}</div>}
    {discardFor === workspaceId && <ConfirmDialog danger title={t('changes.comments.discardConfirm')} description={t('changes.comments.discardConsequence', { count: workspaceComments.length })} confirmLabel={t('changes.comments.discardAction')}
      onCancel={() => setDiscardFor(null)} onConfirm={() => { clearComments(workspaceId); setDiscardFor(null) }} />}
    {reviewAgentOpen && summary && (
      <ReviewWithAgentDialog
        workspaceId={workspaceId}
        rootPath={diffRoot}
        scope={scope}
        base={effectiveBase}
        head={headText}
        files={summary.files}
        additions={summary.additions}
        deletions={summary.deletions}
        currentProvider={currentProvider}
        onClose={() => setReviewAgentOpen(false)}
        onStarted={provider => {
          setReviewAgentOpen(false)
          setSendNotice({ kind: 'sent', text: t('changes.reviewAgent.started', { agent: threadProductName(provider) }) })
        }}
      />
    )}
    <div className="changes-body">
      <div className="changes-diff">
        {/* On its way: reading the branches (not ready) or the first diff. Never 'No changes' before the first read. */}
        {!summary && !error && (loading || !ready) ? <Skeleton lines={6} label={t('changes.loading')} delay={300} />
          : !selected ? <div className="changes-state"><EmptyState icon={<FileDiff size={16} />} title={summary?.files.length ? t('changes.noMatch') : scope === 'last-turn' ? t('changes.noLastTurn') : t('changes.none')}>{summary?.files.length ? t('changes.noMatchHint') : scope === 'last-turn' ? t('changes.noLastTurnHint') : t('changes.noneHint', { base: effectiveBase ?? t('changes.theBase') })}</EmptyState></div>
          : <>
            <div className="changes-file-header">
              <StatusIcon file={selected} /><span className="changes-file-path" title={selected.path}><span>{name!.directory}</span><strong>{name!.name}</strong></span>
              {selected.oldPath && <small>{t('changes.renamedFrom', { path: selected.oldPath })}</small>}
              <Counts additions={selected.additions} deletions={selected.deletions} />
              <span className="changes-toolbar-spacer" />
              <button type="button" className="changes-viewed" aria-label={t('changes.viewed')} title={t('changes.markViewed')} aria-pressed={viewed.has(signature(selected))} onClick={() => toggleViewed(selected)}>{viewed.has(signature(selected)) ? <CheckCircle2 size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}<span className="changes-viewed-label">{t('changes.viewed')}</span></button>
              {!large && <span className="changes-banner-nav"><button type="button" aria-label={t('changes.previousFile')} onClick={() => go(-1)} disabled={index <= 0}><ChevronLeft size={14} aria-hidden="true" /></button><button type="button" aria-label={t('changes.nextFile')} onClick={() => go(1)} disabled={index >= ordered.length - 1}><ChevronRight size={14} aria-hidden="true" /></button></span>}
            </div>
            <div className="changes-editor">
              {selected.binary ? <EmptyState compact title={t('changes.binary')} />
                : contentError ? <ErrorState compact title={t('changes.fileFailed')} message={contentError} />
                : content?.path !== selected.path ? <div className="changes-state"><LoadingState label={t('changes.loadingDiff')} /></div>
                : <>
                  {content.original.truncated && <p className="changes-note">{t('changes.truncated')}</p>}
                  <Suspense fallback={<div className="changes-state"><LoadingState label={t('editor.loadingEditor')} /></div>}><MonacoDiff path={selected.path} original={content.original.content} modified={content.modified} language={languageFor(selected.path)} review={fileReview} /></Suspense>
                </>}
            </div>
          </>}
      </div>
      {((summary?.files.length ?? 0) > 0 || query.trim().length > 0) && (
        <aside className="changes-files" aria-label={t('changes.files')}>
          <label className="changes-filter"><Search size={14} aria-hidden="true" /><TextField aria-label={t('changes.filter')} placeholder={t('changes.filterPlaceholder')} value={query} onChange={event => setQuery(event.target.value)} /></label>
          <ul className="changes-tree" role="tree" aria-label={t('changes.files')} ref={treeNav.ref} onKeyDown={treeNav.onKeyDown}>{tree.map(node => <TreeNode key={`${node.kind}:${node.path}`} node={node} depth={0} selected={selected?.path ?? null} collapsed={collapsed} viewed={viewed} onToggle={toggleDir} onSelect={setSelectedPath} />)}</ul>
          {!!summary?.files.length && <footer className="changes-files-footer">{t('changes.viewedCount', { viewed: viewedCount, total: summary.files.length })}</footer>}
        </aside>
      )}
    </div>
  </section>
}
