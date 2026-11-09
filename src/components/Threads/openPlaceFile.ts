import { createElement } from 'react'
import { i18n } from '../../i18n'
import { Dialog, toast } from '../../ui'
import type { ThreadSnapshot } from '../../../shared/types/thread'
import type { ThreadPlace } from '../../../shared/types/thread-places'
import { useEditorStore } from '../../store/editor.store'
import { useThreadStore } from '../../store/thread.store'
import { useThreadWorkbenchStore } from '../../store/thread-workbench.store'
import { threadWorkingRoot } from './threadChanges'
import { OutsideFileTab, placeApi, relativeToPlace } from './OutsideFileTab'

async function snapshotOf(threadId: string): Promise<ThreadSnapshot | null> {
  const state = useThreadStore.getState()
  const cached = state.snapshotCache[threadId] ?? (state.snapshot?.thread.id === threadId ? state.snapshot : null)
  if (cached) return cached
  try { return (await window.oxe?.thread?.read(threadId)) ?? null } catch { return null }
}

/** One read-only dialog at a time, mounted on its own root so any caller (a link, a menu item) can open it. */
let closeOpen: (() => void) | null = null
async function showOutside(threadId: string, placeId: string, relativePath: string): Promise<void> {
  closeOpen?.()
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const close = (): void => {
    if (closeOpen === close) closeOpen = null
    root.unmount()
    host.remove()
  }
  closeOpen = close
  root.render(createElement(Dialog, { title: relativePath, size: 'lg', onClose: close },
    createElement(OutsideFileTab, { threadId, placeId, relativePath })))
}

/**
 * A16/A17: opens a path main resolved. A file of the thread's own checkout or one of its worktrees opens in the
 * editor at its line; a file of an outside folder or another repository opens read only (A17), never in an editable
 * surface. Anything else says it could not be opened.
 */
export async function openPlaceFile(input: { threadId: string; path: string; placeId: string | null; line?: number }): Promise<void> {
  const { threadId, path, placeId, line } = input
  const api = placeApi()
  const places: ThreadPlace[] = api?.places ? ((await api.places(threadId).catch(() => null))?.places ?? []) : []
  const place = placeId === null ? undefined : places.find(entry => entry.id === placeId)
  if (place && (place.kind === 'outside' || place.kind === 'checkout')) {
    const relativePath = relativeToPlace(place.path, path)
    if (relativePath) { await showOutside(threadId, place.id, relativePath); return }
  }
  const snapshot = await snapshotOf(threadId)
  if (snapshot) {
    const roots = [
      ...(place && (place.kind === 'root' || place.kind === 'worktree') ? [place.path] : []),
      threadWorkingRoot(snapshot.thread),
      snapshot.thread.rootPath
    ].filter((root): root is string => Boolean(root))
    for (const root of roots) {
      const relativePath = relativeToPlace(root, path)
      if (!relativePath) continue
      void useEditorStore.getState().openFile({ workspaceId: snapshot.thread.workspaceId, rootPath: root, relativePath, ...(line !== undefined ? { line } : {}) })
      useThreadWorkbenchStore.getState().setView(threadId, { panel: 'files' })
      return
    }
  }
  toast({ title: i18n.t('thread:inlinePath.notFound', { path }), intent: 'warning' })
}
