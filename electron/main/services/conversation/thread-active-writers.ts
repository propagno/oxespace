import { win32 } from 'node:path'
import type { ConversationThread } from '../../../../shared/types/thread'
import type { ThreadActiveWriter, ThreadPaneSource } from '../../../../shared/types/thread-places'
import { canonicalPath } from '../git-common-dir'
import { readThreadTitle } from './thread-title'

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/

function normalizeFolder(path: string | null | undefined): string | null {
  if (typeof path !== 'string') return null
  const trimmed = path.trim()
  if (!trimmed || trimmed.length > 4096 || trimmed.includes('\0')) return null
  if (process.platform !== 'win32' && WINDOWS_DRIVE_PATH.test(trimmed)) {
    const normalized = win32.normalize(trimmed).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    return normalized || null
  }
  try {
    const canonical = canonicalPath(trimmed).replace(/\/+$/, '')
    return canonical || '/'
  } catch {
    return null
  }
}

function isReadOnlyAccess(access: unknown): boolean {
  return access === 'read-only' || access === 'readonly'
}

function isThreadWorking(thread: ConversationThread): boolean {
  return thread.status === 'running' || (thread.background?.running ?? 0) > 0
}

function threadFolder(thread: ConversationThread): string {
  if (thread.observedLocation?.sameRepository && thread.observedLocation.checkoutRoot) {
    return thread.observedLocation.checkoutRoot
  }
  return thread.ownedWorktree?.path || thread.rootPath
}

function paneFolder(pane: ThreadPaneSource): string | null {
  for (const candidate of [pane.agentCwd, pane.shellCwd, pane.launchDir]) {
    if (typeof candidate === 'string' && candidate.trim() && !candidate.includes('\0')) return candidate
  }
  return null
}

/**
 * AG-07 (OXE-189): returns running OxeChat conversations with write access and running OxeCode agent panes
 * currently working in the same canonical folder (`rootPath` or `ownedWorktree`), excluding read-only sessions.
 */
export function activeWritersInFolder(
  rootPath: string,
  input: { threads: readonly ConversationThread[]; panes: readonly ThreadPaneSource[] }
): ThreadActiveWriter[] {
  const target = normalizeFolder(rootPath)
  if (!target) return []
  const writers: ThreadActiveWriter[] = []
  const seen = new Set<string>()

  for (const thread of input.threads) {
    if (thread.archived || !isThreadWorking(thread) || isReadOnlyAccess(thread.access)) continue
    const folder = normalizeFolder(threadFolder(thread))
    if (folder !== target) continue
    const key = `thread\0${thread.id}`
    if (seen.has(key)) continue
    seen.add(key)
    writers.push({ id: thread.id, title: readThreadTitle(thread.title), kind: 'thread' })
  }

  for (const pane of input.panes) {
    if (!pane.agent || pane.working === false || pane.readOnly) continue
    const folder = normalizeFolder(paneFolder(pane))
    if (folder !== target) continue
    const key = `pane\0${pane.paneId}`
    if (seen.has(key)) continue
    seen.add(key)
    writers.push({ id: pane.paneId, title: pane.title, kind: 'pane' })
  }

  return writers
}
