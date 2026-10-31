import type { WorkspaceMessageParams } from '../../shared/messages/workspace'

/** The parameter names each workspace code carries, as the catalogs must interpolate them (C3 contract, S0.1 part 2b). */
export const WORKSPACE_PARAMETERS: Record<keyof WorkspaceMessageParams, string[]> = {
  'project.file.changedMeanwhile': ['file'],
  'workspace.root.empty': [],
  'workspace.root.notAbsolute': ['path'],
  'workspace.root.notFound': ['path'],
  'workspace.root.notDirectory': ['path'],
  'workspace.root.unreadable': ['path']
}
