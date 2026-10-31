import { parseThreadWorktreePrefs, withThreadWorktreePref } from '../../../shared/threadWorktree'

const KEY = 'oxe.thread.worktreeDefault'

/** Whether new conversations in this project start in a worktree of their own: off until the person turns it on. */
export function readThreadWorktreePref(projectId: string | undefined): boolean {
  if (!projectId) return false
  try { return parseThreadWorktreePrefs(window.localStorage.getItem(KEY))[projectId] === true } catch { return false }
}

/** Remembers the choice made when a conversation was created, for the next one in the same project. */
export function writeThreadWorktreePref(projectId: string, enabled: boolean): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(withThreadWorktreePref(parseThreadWorktreePrefs(window.localStorage.getItem(KEY)), projectId, enabled))) } catch { /* private mode: the choice just is not remembered */ }
}
