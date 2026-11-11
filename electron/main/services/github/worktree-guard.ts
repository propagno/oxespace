export interface WorktreeRemoveGuardRefusal {
  code: string
  params: Record<string, unknown>
}

export type WorktreeRemoveGuardResult =
  | { ok: true; branchDeleted: boolean }
  | { ok: false; refusal: WorktreeRemoveGuardRefusal }

/**
 * Narrow agent-facing worktree removal guard (A63 / S1): allows an agent tool to request only a non-forced
 * worktree removal that keeps its branch (`deleteBranch: false, via: 'agent'`), without exposing person-only
 * branch deletion or panel listing to agent-facing modules.
 */
export interface WorktreeRemoveGuard {
  remove(input: { rootPath: string; path: string; deleteBranch: false; via: 'agent' }): Promise<WorktreeRemoveGuardResult>
}

let activeGuard: WorktreeRemoveGuard | null = null

export function setWorktreeRemoveGuard(guard: WorktreeRemoveGuard | null): void {
  activeGuard = guard
}

export function worktreeRemoveGuard(): WorktreeRemoveGuard | null {
  return activeGuard
}
