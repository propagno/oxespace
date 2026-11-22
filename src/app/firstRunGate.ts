/** Where the thread project catalog stands: not read yet, read, or its read failed. */
export type ProjectsState = 'pending' | 'loaded' | 'failed'

export interface FirstRunGateInput {
  /** The workspace store is still loading. */
  isLoading: boolean
  /** Nothing else rules the first run out: not dismissed, not exited, no remembered view. */
  firstRunOpen: boolean
  /** The profile has a workspace: it rules the first run out, unless step 1 is what made it. */
  hasWorkspace?: boolean
  /** A workspace is being made, or was made, from this session's first run (OXE-331). */
  madeInFirstRun?: boolean
  projectsState: ProjectsState
  projectCount: number
  /** The first run already started in this session (picking the folder in step 1 adds a project). */
  started: boolean
}

/**
 * The first run (BRD-12, OXE-77) is for a profile with nothing in it. "Nothing" has to be known: a restart where the
 * project catalog has not been read yet, or failed to read, is not an empty profile. So the first run starts only on a
 * catalog read as empty, then stays until the person leaves it, also with the workspace its step 1 made (OXE-331);
 * while the catalog is still pending, the app shows its loading state instead of another screen.
 */
export function firstRunGate(input: FirstRunGateInput): { start: boolean; show: boolean; pending: boolean } {
  const knownEmpty = input.projectsState === 'loaded' && input.projectCount === 0
  const open = !input.isLoading && input.firstRunOpen
  const start = open && !input.hasWorkspace && knownEmpty
  const started = input.started || start
  return {
    start,
    show: open && started && (!input.hasWorkspace || input.madeInFirstRun === true),
    pending: open && !input.hasWorkspace && !started && input.projectsState === 'pending'
  }
}
