import { createContext, useContext, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { parseProjectPath, type ProjectPath } from '../../lib/projectPath'
import { usePathMenu } from './usePathMenu'

/** The project a piece of text belongs to, and how a path of it opens in OXESpace (F33 §3: agent text). */
export interface PathScope {
  workspaceId: string
  rootPath: string
  openInOxespace(path: ProjectPath): void
}

export const PathScopeContext = createContext<PathScope | null>(null)

/** Inside a fenced block or a link: code there is never a path link (only plain inline `code` is). */
export const InCodeBlockContext = createContext(false)

/**
 * Inline `code` that names a project file, with an optional `:line[:col]`, becomes a link-styled code span: a click
 * opens it in OXESpace's editor at the line, right click or Shift+F10 opens the path menu. Anything else, and any
 * code outside a project, stays plain code.
 */
export function InlineCode({ children, className }: { children?: ReactNode; className?: string }): ReactElement {
  const scope = useContext(PathScopeContext)
  const inBlock = useContext(InCodeBlockContext)
  const text = typeof children === 'string' ? children : Array.isArray(children) && children.every(part => typeof part === 'string') ? children.join('') : null
  const path = scope && !inBlock && text ? parseProjectPath(text, scope.rootPath) : null
  if (!scope || !path) return <code className={className}>{children}</code>
  return <PathCode scope={scope} path={path} text={text!} />
}

function PathCode({ scope, path, text }: { scope: PathScope; path: ProjectPath; text: string }): ReactElement {
  const { t } = useTranslation('common')
  const { menu, onContextMenu } = usePathMenu({ workspaceId: scope.workspaceId, rootPath: scope.rootPath, relativePath: path.relativePath, line: path.line, column: path.column }, { openInOxespace: () => scope.openInOxespace(path) })
  return <>
    <button type="button" className="path-link" onClick={() => scope.openInOxespace(path)} onContextMenu={onContextMenu}
      aria-label={path.line ? t('openIn.pathLink', { path: path.relativePath, line: path.line }) : path.relativePath}>
      <code>{text}</code>
    </button>
    {menu}
  </>
}
