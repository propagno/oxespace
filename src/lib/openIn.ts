import { useEffect } from 'react'
import { create } from 'zustand'
import { messageFromError } from '../../shared/messages'
import type { OpenInEditorId, OpenInTarget, OpenInTargets } from '../../shared/types/open-in'
import { i18n } from '../i18n'
import { formatMainMessage } from '../i18n/mainMessage'
import { announceFocus } from '../keyboard/terminalFocusActions'
import { copyText, toast } from '../ui'

/**
 * F33 · "Abrir em…" in the window: the editors main detected (B18 `app.openInTargets`), read on first use and again
 * whenever the window regains focus, so an editor installed meanwhile shows up without a restart.
 */
interface OpenInState {
  targets: OpenInTargets | null
  refresh(): Promise<void>
  setPreference(preference: OpenInTargets['preferred']): Promise<void>
}

export const useOpenInStore = create<OpenInState>(set => ({
  targets: null,
  refresh: async () => {
    const targets = await window.oxe?.app?.openInTargets?.().catch(() => null)
    if (targets) set({ targets })
  },
  setPreference: async preference => {
    const targets = await window.oxe?.app?.setOpenInPreference?.(preference).catch(() => null)
    if (targets) set({ targets })
  }
}))

let listening = false

/** The detected editors, preferred first, and the preference; loads on first use and on every window focus. */
export function useOpenInTargets(): OpenInTargets | null {
  const targets = useOpenInStore(state => state.targets)
  useEffect(() => {
    if (listening) return
    listening = true
    void useOpenInStore.getState().refresh()
    window.addEventListener('focus', () => { void useOpenInStore.getState().refresh() })
  }, [])
  return targets
}

/** The editor `Ctrl/Cmd+Shift+click` and the first menu item use: the chosen one if installed, else the first found. */
export function preferredEditor(targets: OpenInTargets | null): { id: OpenInEditorId; name: string } | null {
  if (!targets?.editors.length) return null
  return targets.editors.find(editor => editor.id === targets.preferred) ?? targets.editors[0]
}

/** The editors in menu order: the preferred one first, the others as main listed them. */
export function editorsInMenuOrder(targets: OpenInTargets | null): Array<{ id: OpenInEditorId; name: string }> {
  const first = preferredEditor(targets)
  if (!targets || !first) return []
  return [first, ...targets.editors.filter(editor => editor.id !== first.id)]
}

export interface OpenInRequest {
  workspaceId: string
  rootPath: string
  /** Relative to `rootPath`, "/" separators. */
  relativePath: string
  line?: number
  column?: number
}

const t = (key: string, options?: Record<string, unknown>): string => (i18n.t as unknown as (key: string, options: object) => string)(key, { ns: 'common', ...options })

/** The full path for "Copiar caminho completo", in the root's own separators. */
export function fullPath(rootPath: string, relativePath: string): string {
  const separator = rootPath.includes('\\') ? '\\' : '/'
  const base = rootPath.endsWith(separator) ? rootPath.slice(0, -1) : rootPath
  return relativePath ? `${base}${separator}${separator === '\\' ? relativePath.replace(/\//g, '\\') : relativePath}` : base
}

/**
 * Asks main to open the file. The live region says where it is opening; a refusal is a toast in main's words (C3),
 * with "Copiar caminho" where the person may still want the path, and a missing editor re-reads the list.
 */
export async function openPathIn(request: OpenInRequest, target: OpenInTarget): Promise<boolean> {
  const editor = target === 'reveal' ? null : useOpenInStore.getState().targets?.editors.find(found => found.id === target)
  if (editor) announceFocus(t('openIn.opening', { editor: editor.name }))
  try {
    await window.oxe.app.openIn!({ workspaceId: request.workspaceId, rootPath: request.rootPath, path: request.relativePath, line: request.line, column: request.column, target })
    return true
  } catch (cause) {
    const message = messageFromError(cause)
    const copy = { label: t('openIn.copyFullPath'), run: () => void copyText(fullPath(request.rootPath, request.relativePath), t('openIn.path'), t('openIn.pathCopied')) }
    if (message?.code === 'app.openIn.editorMissing') void useOpenInStore.getState().refresh()
    const danger = message?.code === 'app.openIn.launchFailed' || message?.code === 'app.openIn.revealFailed'
    const withCopy = message?.code === 'app.openIn.notFound' || message?.code === 'app.openIn.launchFailed'
    toast({ title: message ? formatMainMessage(message) : t('openIn.failed'), intent: danger || !message ? 'danger' : 'warning', ...(withCopy ? { action: copy } : {}) })
    return false
  }
}
