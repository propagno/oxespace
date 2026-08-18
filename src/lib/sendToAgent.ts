import { useTerminalStore } from '../store/terminal.store'
import { useUIStore } from '../store/ui.store'
import { useWorkspaceStore } from '../store/workspace.store'

/**
 * Wrap multi-line text in bracketed-paste markers so agent CLIs (Claude Code,
 * Codex, PSReadLine) receive it as one pasted block instead of submitting each
 * line. The user reviews it in the prompt and presses Enter to send.
 */
export function asBracketedPaste(text: string): string {
  return `\u001b[200~${text}\u001b[201~`
}

/**
 * Pastes a prompt into the workspace's agent terminal: the focused pane if it is
 * a terminal, else a running one, else the first. Starts the pane when stopped.
 * Deliberately does NOT press Enter — the user submits.
 */
export async function pasteIntoAgentTerminal(workspaceId: string, prompt: string): Promise<{ ok: boolean; message: string }> {
  const workspace = useWorkspaceStore.getState().workspaces.find((candidate) => candidate.id === workspaceId)
  const terminalPanes = workspace?.panes.filter((pane) => pane.type === 'terminal') ?? []
  const getStatus = useTerminalStore.getState().getStatus
  const activePaneId = useUIStore.getState().activePaneId
  const active = terminalPanes.find((pane) => pane.id === activePaneId) ?? null
  const running = terminalPanes.find((pane) => getStatus(pane.id).status === 'running') ?? null
  const target = active ?? running ?? terminalPanes[0] ?? null

  if (!target) return { ok: false, message: 'No terminal pane available to receive the prompt.' }

  const status = getStatus(target.id).status
  if (status !== 'running' && status !== 'starting') {
    await window.oxe.terminal.start({ paneId: target.id, workspaceId: target.workspaceId })
  }
  await window.oxe.terminal.write({ paneId: target.id, data: asBracketedPaste(prompt) })

  return { ok: true, message: 'Pasted into the agent — press Enter to submit.' }
}
