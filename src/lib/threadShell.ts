/**
 * Running a command for a conversation. Background jobs belong to OxeCode workspaces (`background_jobs` references
 * `workspaces`), and a conversation of an OxeChat project has none: its commands run in a terminal of the project, the
 * same ones the conversation's Terminal tab shows (slots 1 to 8), so the person sees and can stop what was started.
 */

/** A conversation has this many project terminals; main refuses any other slot. */
export const THREAD_SHELL_SLOTS = 8

export const threadShellPane = (threadId: string, slot: number): string => `thread-shell:${threadId}:${slot}`

const joinPath = (root: string, relative: string): string => `${root.replace(/[\\/]+$/, '')}${root.includes('\\') ? '\\' : '/'}${root.includes('\\') ? relative.replace(/\//g, '\\') : relative}`

export interface ThreadShellRun {
  threadId: string
  /** The conversation's workspace id (`thread:<project>` or an OxeCode workspace's): main checks the terminal against it. */
  workspaceId: string
  slot: number
  command: string
  /** Folder to run in, relative to `rootPath`; the project's folder when absent. */
  cwd?: string | null
  rootPath?: string
  /** Ends what the slot was running first, so the command starts in a fresh shell. */
  restart?: boolean
}

/**
 * Starts the conversation's terminal in a slot and types the command into it, as the person would. Returns the pane
 * id: `window.oxe.terminal.onData` and `onExit` on it give the output and the end.
 */
export async function runInThreadShell(run: ThreadShellRun): Promise<string> {
  if (!Number.isInteger(run.slot) || run.slot < 1 || run.slot > THREAD_SHELL_SLOTS) throw new Error(`A conversation has terminals 1 to ${THREAD_SHELL_SLOTS}`)
  const paneId = threadShellPane(run.threadId, run.slot)
  if (run.restart) await window.oxe.terminal.stop({ paneId }).catch(() => undefined)
  await window.oxe.terminal.start({ paneId, workspaceId: run.workspaceId })
  const enter = run.cwd && run.rootPath ? `cd ${JSON.stringify(joinPath(run.rootPath, run.cwd))}\r` : ''
  await window.oxe.terminal.write({ paneId, data: `${enter}${run.command}\r` })
  return paneId
}

export async function stopThreadShell(threadId: string, slot: number): Promise<void> {
  await window.oxe.terminal.stop({ paneId: threadShellPane(threadId, slot) })
}
