// AG-08 (OXE-190): terminal-to-OxeChat routing and draft formatting.
// Resolves the matching OxeChat conversation (or new-conversation draft) from a terminal's cwd/workspace
// using normalized paths (Windows-safe drive casing, slashes and trailing slash), appends the selected
// text in a fenced ```text block (using a wider fence when the selection itself contains backticks),
// focuses the composer below the block, and never sends automatically (RN-1).
import type { ConversationThread, ThreadProjectSummary } from '../../../shared/types/thread'
import { useTerminalStore } from '../../store/terminal.store'
import { useThreadStore } from '../../store/thread.store'
import { useWorkspaceStore } from '../../store/workspace.store'

export type TerminalChatTarget =
  | { kind: 'thread'; threadId: string; rootPath: string }
  | { kind: 'new-draft'; projectId: string | null; rootPath: string }

export interface ResolveTerminalChatTargetInput {
  cwd?: string | null
  workspaceRootPath?: string | null
  threads: readonly ConversationThread[]
  projects: readonly ThreadProjectSummary[]
  selectedThreadId?: string | null
  hiddenProjects?: readonly string[]
}

export interface SendSelectionResult {
  target: TerminalChatTarget
  draft: string
}

/** Normalizes a filesystem path for cross-platform matching (slashes, trailing slash, Windows drive/case). */
export function normalizePathForMatch(raw: string | null | undefined): string {
  if (!raw) return ''
  let normalized = raw.trim().replace(/\\/g, '/')
  if (!normalized) return ''
  // Collapse duplicate slashes except leading UNC //
  normalized = normalized.replace(/(?!^)\/+/g, '/')
  // Strip trailing slash unless it's the filesystem root ("/" or "c:/")
  while (normalized.length > 1 && normalized.endsWith('/') && !/^[a-zA-Z]:\/$/.test(normalized)) {
    normalized = normalized.slice(0, -1)
  }
  const isWindowsPath = /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('//')
  return isWindowsPath ? normalized.toLowerCase() : normalized
}

/** Returns true when `candidate` is the exact same directory as `root` or nested inside it. */
function isSameOrInside(candidate: string, root: string): boolean {
  if (!candidate || !root) return false
  if (candidate === root) return true
  const prefix = root.endsWith('/') ? root : `${root}/`
  return candidate.startsWith(prefix)
}

/** Builds a markdown fenced code block for `selection`, widening the fence past any backtick run inside it. */
export function formatSelectionBlock(selection: string): string {
  const cleaned = selection.replace(/\r\n/g, '\n').replace(/\n+$/, '')
  let maxBackticks = 0
  for (const match of cleaned.matchAll(/`+/g)) {
    if (match[0].length > maxBackticks) maxBackticks = match[0].length
  }
  const fence = '`'.repeat(Math.max(3, maxBackticks + 1))
  return `${fence}text\n${cleaned}\n${fence}\n`
}

/** Appends a fenced selection block to an existing draft without mutating or sending. */
export function appendSelectionToDraft(existingDraft: string, selection: string): string {
  const block = formatSelectionBlock(selection)
  if (!existingDraft.trim()) return block
  const separator = existingDraft.endsWith('\n\n')
    ? ''
    : existingDraft.endsWith('\n')
      ? '\n'
      : '\n\n'
  return `${existingDraft}${separator}${block}`
}

function pickBestThread(
  matches: readonly ConversationThread[],
  selectedThreadId?: string | null
): ConversationThread | null {
  if (!matches.length) return null
  if (selectedThreadId) {
    const selected = matches.find((t) => t.id === selectedThreadId)
    if (selected) return selected
  }
  return [...matches].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] ?? null
}

/** Resolves which OxeChat thread (or new-conversation draft) should receive a terminal selection. */
export function resolveTerminalChatTarget(input: ResolveTerminalChatTargetInput): TerminalChatTarget {
  const cwdNorm = normalizePathForMatch(input.cwd)
  const wsNorm = normalizePathForMatch(input.workspaceRootPath)
  const hidden = new Set(input.hiddenProjects ?? [])
  const activeThreads = input.threads.filter((thread) => !thread.archived && !hidden.has(thread.projectId))

  // 1. Exact or nested match against a thread's worktree (ownedWorktree or observedLocation).
  if (cwdNorm) {
    const exactWorktree = activeThreads.filter((thread) => {
      const wt = normalizePathForMatch(thread.ownedWorktree?.path)
      const obs = normalizePathForMatch(thread.observedLocation?.cwd)
      return (wt && wt === cwdNorm) || (obs && obs === cwdNorm)
    })
    const bestExactWt = pickBestThread(exactWorktree, input.selectedThreadId)
    if (bestExactWt) {
      return {
        kind: 'thread',
        threadId: bestExactWt.id,
        rootPath: bestExactWt.ownedWorktree?.path ?? bestExactWt.rootPath
      }
    }

    const nestedWorktree = activeThreads.filter((thread) => {
      const wt = normalizePathForMatch(thread.ownedWorktree?.path)
      const obs = normalizePathForMatch(thread.observedLocation?.cwd)
      return (wt && isSameOrInside(cwdNorm, wt)) || (obs && isSameOrInside(cwdNorm, obs))
    })
    const bestNestedWt = pickBestThread(nestedWorktree, input.selectedThreadId)
    if (bestNestedWt) {
      return {
        kind: 'thread',
        threadId: bestNestedWt.id,
        rootPath: bestNestedWt.ownedWorktree?.path ?? bestNestedWt.rootPath
      }
    }
  }

  // 2. Match against a thread's rootPath using cwd first, then workspaceRootPath.
  const probes = [cwdNorm, wsNorm].filter(Boolean)
  for (const probe of probes) {
    const exactRoot = activeThreads.filter((thread) => normalizePathForMatch(thread.rootPath) === probe)
    const bestExact = pickBestThread(exactRoot, input.selectedThreadId)
    if (bestExact) {
      return { kind: 'thread', threadId: bestExact.id, rootPath: bestExact.rootPath }
    }
    const nestedRoot = activeThreads.filter((thread) => isSameOrInside(probe, normalizePathForMatch(thread.rootPath)))
    const bestNested = pickBestThread(nestedRoot, input.selectedThreadId)
    if (bestNested) {
      return { kind: 'thread', threadId: bestNested.id, rootPath: bestNested.rootPath }
    }
  }

  // 3. No existing conversation: resolve the matching project for a new-conversation draft (OXE-168).
  const visibleProjects = input.projects.filter((project) => !project.hidden && !hidden.has(project.projectId))
  for (const probe of probes) {
    for (const project of visibleProjects) {
      const exactContext = project.contexts.find((ctx) => normalizePathForMatch(ctx.rootPath) === probe)
      if (exactContext) {
        return { kind: 'new-draft', projectId: project.projectId, rootPath: exactContext.rootPath }
      }
    }
    for (const project of visibleProjects) {
      const nestedContext = project.contexts.find((ctx) => isSameOrInside(probe, normalizePathForMatch(ctx.rootPath)))
      if (nestedContext) {
        return { kind: 'new-draft', projectId: project.projectId, rootPath: nestedContext.rootPath }
      }
    }
  }

  return {
    kind: 'new-draft',
    projectId: null,
    rootPath: input.cwd ?? input.workspaceRootPath ?? ''
  }
}

/** Subscribes the App shell to AG-08 terminal-to-OxeChat draft routing events without bloating App.tsx. */
export function attachOpenThreadDraftListener(handlers: {
  selectThreadMode: () => void
  openNewThread: (projectId: string | null, rootPath?: string) => void
}): () => void {
  const onOpenDraft = (event: Event): void => {
    const detail = (
      event as CustomEvent<{ threadId: string | null; projectId?: string | null; rootPath?: string; draftLength?: number }>
    ).detail
    if (!detail) return
    handlers.selectThreadMode()
    if (!detail.threadId) {
      handlers.openNewThread(detail.projectId ?? null, detail.rootPath || undefined)
    }
    requestAnimationFrame(() => {
      const composer = document.querySelector<HTMLTextAreaElement>('[data-thread-composer="true"]')
      if (!composer) return
      composer.focus()
      const pos = detail.draftLength ?? composer.value.length
      composer.setSelectionRange(pos, pos)
    })
  }
  window.addEventListener('oxe:open-thread-draft', onOpenDraft)
  return () => window.removeEventListener('oxe:open-thread-draft', onOpenDraft)
}

export const newProjectDraftKey = (projectIdOrPath: string): string => `new:${projectIdOrPath}`

/** Moves any pending AG-08 new-conversation draft for this project/path into the newly created thread. */
export function consumePendingNewDraft(args: {
  threadId: string
  projectId?: string | null
  rootPath?: string | null
}): string | null {
  const store = useThreadStore.getState()
  const normRoot = normalizePathForMatch(args.rootPath)
  const candidates = Object.entries(store.drafts).filter(([key, text]) => {
    if (!key.startsWith('new:') || !text) return false
    const target = key.slice(4)
    if (args.projectId && target === args.projectId) return true
    if (normRoot && normalizePathForMatch(target) === normRoot) return true
    return false
  })
  if (!candidates.length) return null
  const [matchedKey, pendingText] = candidates[0]
  const current = store.drafts[args.threadId] ?? ''
  const merged = current ? `${current}\n\n${pendingText}` : pendingText
  store.setDraft(args.threadId, merged)
  store.setDraft(matchedKey, '')
  return merged
}

/** Resolves the pane's current working directory and routes the selected text into the OxeChat composer draft. */
export async function sendTerminalSelectionToChat(args: {
  selection: string
  workspaceId?: string
  paneId?: string
  cwd?: string | null
  workspaceRootPath?: string | null
}): Promise<SendSelectionResult | null> {
  if (!args.selection) return null

  const workspaces = useWorkspaceStore.getState().workspaces
  const workspace = args.workspaceId ? workspaces.find((w) => w.id === args.workspaceId) : undefined
  const pane = args.paneId ? workspace?.panes.find((p) => p.id === args.paneId) : undefined
  const liveCwd = args.paneId ? useTerminalStore.getState().panes[args.paneId]?.location?.cwd : null

  const cwd = args.cwd ?? liveCwd ?? pane?.rootPath ?? workspace?.rootPath ?? null
  const workspaceRootPath = args.workspaceRootPath ?? workspace?.rootPath ?? null

  const store = useThreadStore.getState()
  if (!store.listLoaded && window.oxe?.thread?.list) {
    await Promise.all([store.load().catch(() => undefined), store.loadProjects().catch(() => undefined)])
  }

  const latest = useThreadStore.getState()
  const target = resolveTerminalChatTarget({
    cwd,
    workspaceRootPath,
    threads: latest.threads,
    projects: latest.projects,
    selectedThreadId: latest.selectedId,
    hiddenProjects: latest.hiddenProjects
  })

  if (target.kind === 'thread') {
    const current = latest.drafts[target.threadId] ?? ''
    const nextDraft = appendSelectionToDraft(current, args.selection)
    latest.setDraft(target.threadId, nextDraft)
    void latest.select(target.threadId)
    window.dispatchEvent(
      new CustomEvent('oxe:open-thread-draft', {
        detail: { threadId: target.threadId, rootPath: target.rootPath, draftLength: nextDraft.length }
      })
    )
    return { target, draft: nextDraft }
  }

  let resolvedProjectId = target.projectId
  if (!resolvedProjectId && target.rootPath && window.oxe?.thread?.addProject) {
    const added = await window.oxe.thread.addProject(target.rootPath).catch(() => null)
    if (added?.projectId) resolvedProjectId = added.projectId
    await useThreadStore.getState().loadProjects().catch(() => undefined)
  }

  const resolvedTarget: TerminalChatTarget = { kind: 'new-draft', projectId: resolvedProjectId, rootPath: target.rootPath }
  const draftKey = newProjectDraftKey(resolvedProjectId ?? target.rootPath)
  const current = useThreadStore.getState().drafts[draftKey] ?? ''
  const nextDraft = appendSelectionToDraft(current, args.selection)
  useThreadStore.getState().setDraft(draftKey, nextDraft)
  window.dispatchEvent(
    new CustomEvent('oxe:open-thread-draft', {
      detail: {
        threadId: null,
        projectId: resolvedProjectId,
        rootPath: target.rootPath,
        draftLength: nextDraft.length
      }
    })
  )
  return { target: resolvedTarget, draft: nextDraft }
}
