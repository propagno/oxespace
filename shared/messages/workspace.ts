/** C3 message codes of the workspace domain (`project.*`, `workspace.*`); merged into `MessageParams` and `MESSAGE_CODES` by shared/messages.ts. */

export interface WorkspaceMessageParams {
  /** A project file changed on disk after OXESpace read it (another editor, a git checkout); nothing was written. */
  'project.file.changedMeanwhile': { file: string }
  /** A workspace root that is not an absolute path (a relative one would depend on where the app started). */
  /** No folder was given: the text was empty, or only spaces or quotes. */
  'workspace.root.empty': Record<string, never>
  'workspace.root.notAbsolute': { path: string }
  /** A workspace root that does not exist. */
  'workspace.root.notFound': { path: string }
  /** A workspace root that is a file, not a folder. */
  'workspace.root.notDirectory': { path: string }
  /** A workspace root the app is not allowed to open or list. */
  'workspace.root.unreadable': { path: string }
}

export const WORKSPACE_MESSAGE_CODES = [
  'project.file.changedMeanwhile',
  'workspace.root.empty',
  'workspace.root.notAbsolute',
  'workspace.root.notFound',
  'workspace.root.notDirectory',
  'workspace.root.unreadable'
] as const satisfies readonly (keyof WorkspaceMessageParams)[]
