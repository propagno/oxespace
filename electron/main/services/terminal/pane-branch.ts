import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { execGit } from '../../utils/safe-git'

/**
 * A18 (T73) · Each pane's branch, and the branch it started on, so the pane header can say "switched from X".
 * null outside a repository or on a detached HEAD.
 */
export interface PaneBranch {
  branch: string | null
  startedOn: string | null
  switched: boolean
}

export type PaneBranchReader = (cwd: string) => Promise<string | null>

const fold = (path: string): string => {
  const full = resolve(path)
  return process.platform === 'win32' ? full.toLowerCase() : full
}

/** A repository whose top is the home folder or a drive root is not a checkout the pane works in (A13 v2, CR-35). */
export function outsideRepositoryTop(top: string, home: string = homedir()): boolean {
  const full = resolve(top)
  return dirname(full) === full || (!!home && fold(full) === fold(home))
}

/** The checked-out branch at `cwd` through safe git (local, no hooks), or null. */
export async function readPaneBranch(cwd: string, home: string = homedir()): Promise<string | null> {
  if (!cwd || !existsSync(cwd)) return null
  try {
    const options = { timeout: 5_000, maxBuffer: 8192 }
    const top = (await execGit(cwd, ['rev-parse', '--show-toplevel'], options)).stdout.trim()
    if (!top || outsideRepositoryTop(top, home)) return null
    return (await execGit(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'], options)).stdout.trim() || null
  } catch {
    return null
  }
}

interface TrackedPane {
  cwd: string
  startedOn: string | null
  branch: string | null
  generation: number
}

const viewOf = (pane: Pick<TrackedPane, 'branch' | 'startedOn'>): PaneBranch => ({
  branch: pane.branch,
  startedOn: pane.startedOn,
  switched: pane.startedOn !== null && pane.branch !== pane.startedOn
})

export const samePaneBranch = (a: PaneBranch | null, b: PaneBranch | null): boolean =>
  a === b || (!!a && !!b && a.branch === b.branch && a.startedOn === b.startedOn && a.switched === b.switched)

export class PaneBranchTracker {
  private readonly panes = new Map<string, TrackedPane>()
  /** The track() in flight for a pane; forget() or a newer track() makes an older one a no-op. */
  private readonly tracking = new Map<string, symbol>()

  constructor(private readonly read: PaneBranchReader = readPaneBranch) {}

  /** Starts following a pane at `cwd`: its branch now is where it started. */
  async track(paneId: string, cwd: string): Promise<PaneBranch> {
    const token = Symbol(paneId)
    this.tracking.set(paneId, token)
    const branch = await this.read(cwd)
    if (this.tracking.get(paneId) !== token) return this.get(paneId) ?? viewOf({ branch, startedOn: branch })
    this.tracking.delete(paneId)
    const pane: TrackedPane = { cwd, startedOn: branch, branch, generation: 0 }
    this.panes.set(paneId, pane)
    return viewOf(pane)
  }

  /** Reads the pane's branch again, at a new cwd when the shell reported one; null for a pane not tracked. */
  async refresh(paneId: string, cwd?: string): Promise<PaneBranch | null> {
    const pane = this.panes.get(paneId)
    if (!pane) return null
    if (cwd) pane.cwd = cwd
    const generation = ++pane.generation
    const branch = await this.read(pane.cwd)
    // The newest read wins; a pane forgotten meanwhile stays forgotten.
    if (this.panes.get(paneId) !== pane) return this.get(paneId)
    if (pane.generation === generation) pane.branch = branch
    return viewOf(pane)
  }

  get(paneId: string): PaneBranch | null {
    const pane = this.panes.get(paneId)
    return pane ? viewOf(pane) : null
  }

  isTracked(paneId: string): boolean {
    return this.panes.has(paneId)
  }

  forget(paneId: string): void {
    this.panes.delete(paneId)
    this.tracking.delete(paneId)
  }
}
