import type { OpenInTargets } from '../../shared/types/open-in'
import { i18n } from '../i18n'
import { copyText, type MenuEntry } from '../ui'
import { editorsInMenuOrder, fullPath, openPathIn, type OpenInRequest } from './openIn'

/**
 * F33 §4 · the path menu, the same items in the same order on every surface:
 *
 *   Abrir no editor do OXESpace        (when the surface isn't the editor itself)
 *   ──
 *   Abrir no <preferred> · linha N     ⇧Ctrl+clique
 *   Abrir no <other editors>
 *   ──
 *   Mostrar no Explorador de Arquivos  (Windows) · Abrir a pasta (Linux) · Mostrar no Finder (macOS)
 *   ──
 *   Copiar caminho relativo
 *   Copiar caminho completo
 *
 * Editors that aren't installed are left out, with no placeholder; a group with nothing in it leaves no separator.
 */
export interface PathMenuOptions {
  request: OpenInRequest
  targets: OpenInTargets | null
  platform: NodeJS.Platform
  /** Present when the surface isn't OXESpace's editor: opens the file there, at the line. */
  openInOxespace?: () => void
  /** A folder: editors only open files (B18 `notAFile`), so it gets reveal and copy. */
  folder?: boolean
  /** A file of another checkout (a worktree) main can't open from this scope: only the copy items (DESIGN #470). */
  copyOnly?: boolean
  /** Where Ctrl/Cmd+Shift+click opens the preferred editor (the terminal, §5.3): its item shows that shortcut. */
  externalClickHint?: boolean
}

const t = (key: string, options?: Record<string, unknown>): string => (i18n.t as unknown as (key: string, options: object) => string)(key, { ns: 'common', ...options })

/** The menu's accessible name: "Ações de src/app.ts". */
export function pathMenuLabel(relativePath: string): string {
  return t('openIn.menuLabel', { path: relativePath })
}

/** The shortcut hint on the preferred editor: ⇧Ctrl+click, or ⇧⌘+click on macOS. */
export function externalClickHint(platform: NodeJS.Platform): string {
  return t(platform === 'darwin' ? 'openIn.shortcutMac' : 'openIn.shortcut')
}

export function pathMenuEntries({ request, targets, platform, openInOxespace, folder, copyOnly, externalClickHint: showClickHint }: PathMenuOptions): MenuEntry[] {
  const groups: MenuEntry[][] = []
  if (copyOnly) return copyGroup(request)
  if (openInOxespace) groups.push([{ label: t('openIn.oxespace'), onSelect: openInOxespace }])
  const editors = folder ? [] : editorsInMenuOrder(targets)
  if (editors.length) {
    groups.push(editors.map((editor, index) => ({
      label: request.line ? t('openIn.editorAtLine', { editor: editor.name, line: request.line }) : t('openIn.editor', { editor: editor.name }),
      // Only where the modifier works: elsewhere the hint would promise a click that does nothing (DESIGN #470).
      ...(index === 0 && showClickHint ? { shortcut: externalClickHint(platform) } : {}),
      onSelect: () => { void openPathIn(request, editor.id) }
    })))
  }
  groups.push([{ label: t(platform === 'win32' ? 'openIn.revealWindows' : platform === 'darwin' ? 'openIn.revealMac' : 'openIn.revealLinux'), onSelect: () => { void openPathIn(request, 'reveal') } }])
  groups.push(copyGroup(request))
  return groups.flatMap((group, index) => index === 0 ? group : [{ type: 'separator' as const }, ...group])
}

function copyGroup(request: OpenInRequest): MenuEntry[] {
  return [
    { label: t('openIn.copyRelativePath'), onSelect: () => void copyText(request.relativePath, t('openIn.path'), t('openIn.relativePathCopied')) },
    { label: t('openIn.copyFullPath'), onSelect: () => void copyText(fullPath(request.rootPath, request.relativePath), t('openIn.path'), t('openIn.pathCopied')) }
  ]
}
