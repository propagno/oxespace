/**
 * B18 · "Abrir em…" (F33, V16): a project file opened in an editor installed on the computer, or shown in its folder.
 *
 * The window names a file of an open workspace and a target id; main resolves everything else. Nothing the window
 * sends becomes a command line: main checks the path against the workspace root by its real path (links followed),
 * picks the editor's executable from the ones it detected itself, and starts it with an argument list, never a shell.
 * Refusals are C3 codes (`app.openIn.*`). Agents can't reach any of it over MCP in 1.4 (`app.open_in`).
 */

/** The external editors main looks for, in the order "Automático" picks them. */
export const OPEN_IN_EDITORS = ['vscode', 'cursor', 'zed'] as const
export type OpenInEditorId = typeof OPEN_IN_EDITORS[number]

/** Every target the window may ask for: a detected editor, or the file shown in its folder. */
export const OPEN_IN_TARGETS = [...OPEN_IN_EDITORS, 'reveal'] as const
export type OpenInTarget = typeof OPEN_IN_TARGETS[number]

/** The person's preferred editor: `auto` is the first detected one in `OPEN_IN_EDITORS` order. */
export type OpenInPreference = OpenInEditorId | 'auto'

/** Product names, shown as they are in every language. */
export const OPEN_IN_EDITOR_NAMES: Record<OpenInEditorId, string> = { vscode: 'VS Code', cursor: 'Cursor', zed: 'Zed' }

/** The largest line or column main passes on; anything past it is malformed. */
export const OPEN_IN_MAX_POSITION = 10_000_000

export interface OpenInInput {
  /** The workspace (or `thread:<projectId>`) whose root the path must stay inside, as the file system channels take it. */
  workspaceId: string
  /** That workspace's root (or one of its linked worktrees), as the window has it. */
  rootPath: string
  /** Relative to `rootPath`, or absolute inside it. `..` and links are resolved before the check. */
  path: string
  /** 1-based. */
  line?: number
  /** 1-based; ignored without a line. */
  column?: number
  target: OpenInTarget
}

export interface OpenInEditor { id: OpenInEditorId; name: string }

export interface OpenInTargets {
  /** Only the editors installed now, in `OPEN_IN_EDITORS` order. Read again when the window regains focus. */
  editors: OpenInEditor[]
  preferred: OpenInPreference
}

/** The refusals `app.openIn` rejects with, as C3 codes. */
export const OPEN_IN_REFUSALS = [
  'app.openIn.outsideRoot',
  'app.openIn.notFound',
  'app.openIn.notAFile',
  'app.openIn.unknownTarget',
  'app.openIn.editorMissing',
  'app.openIn.launchFailed',
  'app.openIn.revealFailed'
] as const
export type OpenInRefusal = typeof OPEN_IN_REFUSALS[number]

export function isOpenInTarget(value: unknown): value is OpenInTarget {
  return typeof value === 'string' && (OPEN_IN_TARGETS as readonly string[]).includes(value)
}

export function isOpenInPreference(value: unknown): value is OpenInPreference {
  return value === 'auto' || (typeof value === 'string' && (OPEN_IN_EDITORS as readonly string[]).includes(value))
}
