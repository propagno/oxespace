/** Where the thread project catalog stands: not read yet, read, or its read failed. */
export type ProjectsState = 'pending' | 'loaded' | 'failed'

export interface FirstRunGateInput {
  /** The workspace store is still loading. */
  isLoading: boolean
  /** Nothing else rules the first run out: not dismissed, not exited, no remembered view, no saved workspace. */
  firstRunOpen: boolean
  projectsState: ProjectsState
  projectCount: number
  /** The first run already started in this session (picking the folder in step 1 adds a project). */
  started: boolean
}

/**
 * The first run (BRD-12, OXE-77) is for a profile with nothing in it. "Nothing" has to be known: a restart where the
 * project catalog has not been read yet, or failed to read, is not an empty profile. So the first run starts only on a
 * catalog read as empty, then stays until the person leaves it; while the catalog is still pending, the app shows its
 * loading state instead of another screen.
 */
export function firstRunGate(input: FirstRunGateInput): { start: boolean; show: boolean; pending: boolean } {
  const knownEmpty = input.projectsState === 'loaded' && input.projectCount === 0
  const start = !input.isLoading && input.firstRunOpen && knownEmpty
  const started = input.started || start
  return {
    start,
    show: !input.isLoading && input.firstRunOpen && (knownEmpty || started),
    pending: !input.isLoading && input.firstRunOpen && !started && input.projectsState === 'pending'
  }
}
