import { randomUUID } from 'node:crypto'
import type { ThreadEvent, ThreadFileChange, ThreadSnapshot } from '../../../../shared/types/thread'
import { splitThreadPatch } from '../../../../shared/threadPatch'
import { canonicalPath } from '../git-common-dir'
import { recordRuntime } from '../runtime-diagnostics'
import type { ThreadCheckpointService } from './thread-checkpoints'
import { execGit } from '../../utils/safe-git'

type TurnEnd = 'completed' | 'interrupted' | 'failed'
interface WorkingState { patch: string; untracked: Set<string> }

/**
 * What a running turn has recorded in each checkout it worked in: a checkpoint, so the turn can be undone, and
 * a working-tree baseline, so the files it changed without reporting them can be shown when it ends.
 */
export class ThreadTurnTracker {
  /** Checkpoints of a running turn: one per checkout the turn worked in (its root, then any worktree it moved into). */
  private readonly checkpointIds = new Map<string, string[]>()
  /** Checkouts a running turn has a checkpoint and a baseline in, by thread (canonical paths). */
  private readonly roots = new Map<string, { turnId: string; roots: Set<string> }>()
  private readonly baselines = new Map<string, Array<{ root: string } & WorkingState>>()

  constructor(
    private readonly checkpoints: ThreadCheckpointService,
    private readonly read: (id: string) => ThreadSnapshot,
    private readonly emit: (id: string, event: ThreadEvent) => void
  ) {}

  hasBaseline(id: string): boolean { return this.baselines.has(id) }
  hasCheckpoints(turnId: string): boolean { return this.checkpointIds.has(turnId) }

  /** Drops what a deleted conversation left. */
  forget(id: string): void {
    this.baselines.delete(id)
    this.roots.delete(id)
  }

  clear(): void {
    this.baselines.clear()
    this.checkpointIds.clear()
    this.roots.clear()
  }

  /**
   * Takes a turn's checkpoint and working-tree baseline in one checkout. Called when the turn starts and
   * again when the provider moves into another checkout of the repository during the turn, so changes made
   * there are reviewable and undoable too. Both reads finish before the caller lets the agent continue.
   */
  async begin(id: string, turnId: string, root: string, label: string, baseline = true): Promise<void> {
    const key = canonicalPath(root)
    const current = this.roots.get(id)
    const roots = current?.turnId === turnId ? current.roots : new Set<string>()
    if (roots.has(key)) return
    roots.add(key)
    this.roots.set(id, { turnId, roots })
    const [checkpointId, state] = await Promise.all([
      // No checkpoint means this turn cannot be undone; say so in diagnostics instead of dropping the reason.
      this.checkpoints.begin({ threadId: id, turnId, rootPath: root, label }).catch((error: unknown) => { recordRuntime('checkpoint-failed', { thread: id, turn: turnId, state: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }); return undefined }),
      baseline ? this.workingState(root) : Promise.resolve(undefined)
    ])
    // The turn may have finished while these reads ran (a move reported right before completion). Its records
    // were already finalized, so this late pair must not leak into the next turn.
    if (this.roots.get(id)?.turnId !== turnId) {
      if (checkpointId) await this.checkpoints.finalize(checkpointId).catch(() => undefined)
      return
    }
    if (checkpointId) this.checkpointIds.set(turnId, [...this.checkpointIds.get(turnId) ?? [], checkpointId])
    if (state !== undefined) this.baselines.set(id, [...this.baselines.get(id) ?? [], { root, ...state }])
  }

  /** Ends a turn: reports the files it changed without saying so, when asked, and finalizes its checkpoints. */
  async finalize(id: string, status: TurnEnd, turnId: string | undefined, captureDiff: boolean): Promise<void> {
    // The turn is over from here: a checkout reported while this runs belongs to no turn.
    if (turnId && this.roots.get(id)?.turnId === turnId) this.roots.delete(id)
    try {
      if (captureDiff) await this.captureDiff(id, status, turnId)
      for (const checkpointId of turnId ? this.checkpointIds.get(turnId) ?? [] : []) await this.checkpoints.finalize(checkpointId)
    } finally {
      if (turnId) this.checkpointIds.delete(turnId)
      if (turnId && this.roots.get(id)?.turnId === turnId) this.roots.delete(id)
    }
  }

  /** The working tree of one checkout: its diff against HEAD and its untracked files. Undefined outside a repository. */
  async workingState(rootPath: string): Promise<WorkingState | undefined> {
    const run = async (args: string[]) => (await execGit(rootPath, args, { maxBuffer: 16 * 1024 * 1024, timeout: 15000 })).stdout
    try {
      const [patch, status] = await Promise.all([
        run(['--no-pager', 'diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--']),
        run(['status', '--porcelain=v1', '-z', '--untracked-files=all'])
      ])
      const untracked = new Set(status.split('\0').flatMap(entry => entry.startsWith('?? ') ? [entry.slice(3)] : []))
      return { patch, untracked }
    } catch { return undefined }
  }

  private async captureDiff(id: string, status: TurnEnd, turnId?: string): Promise<void> {
    const baselines = this.baselines.get(id) ?? []
    this.baselines.delete(id)
    try {
      const snapshot = this.read(id)
      const turnStart = snapshot.events.findIndex(event => event.type === 'message' && event.id === turnId)
      const pathKey = (path: string): string => process.platform === 'win32' ? path.replace(/\\/g, '/').toLowerCase() : path
      const reportedPaths = new Set(snapshot.events.slice(Math.max(0, turnStart)).flatMap(event => event.type === 'turn-diff' && event.id.startsWith('turn-diff:') ? event.files.map(file => pathKey(file.path)) : []))
      const files: ThreadFileChange[] = []
      // Every checkout the turn worked in: its root, and any worktree it moved into during the turn.
      for (const before of baselines) {
        const after = await this.workingState(before.root)
        if (after === undefined || (after.patch === before.patch && ![...after.untracked].some(path => !before.untracked.has(path)))) continue
        const previous = new Map(splitThreadPatch(before.patch).map(file => [file.path, file.patch]))
        files.push(...splitThreadPatch(after.patch)
          .filter(file => previous.get(file.path) !== file.patch && !reportedPaths.has(pathKey(file.path)))
          .map(file => ({ ...file, source: 'working-tree-observation' as const, authorship: 'indeterminate' as const, state: status === 'completed' ? 'completed' as const : 'failed' as const })))
        for (const path of after.untracked) if (!before.untracked.has(path) && !reportedPaths.has(pathKey(path))) files.push({ path, kind: 'add', source: 'working-tree-observation', authorship: 'indeterminate', state: status === 'completed' ? 'completed' : 'failed' })
      }
      if (files.length) this.emit(id, { type: 'turn-diff', id: `verified-diff:${turnId ?? randomUUID()}`, turnId: turnId ?? '', files })
    } catch { /* Repository may have been removed after the turn. */ }
  }
}
