import { useEffect } from 'react'
import { useTerminalStore } from '../store/terminal.store'
import { useWorkspaceStore } from '../store/workspace.store'
import { useSettingsStore } from '../store/settings.store'
import { deriveStatusTone, type PaneDisplayTone } from '../utils/paneDisplay'

/**
 * Horizon 1 · item 1+2 — native desktop notifications driven by the fine-grained
 * agent state machine (`deriveStatusTone`).
 *
 * Polls every POLL_MS and fires a notification when a pane the user is NOT
 * watching transitions to a state that wants attention:
 *   - `awaiting`  → the agent finished and is waiting for input (the big one)
 *   - `exited`    → the agent's terminal closed
 *   - `error`     → the agent hit an error
 *
 * The `awaiting` signal has a stability gate: an agent that merely pauses
 * mid-stream for a moment flips through `awaiting` briefly before resuming, so
 * we only notify once it has stayed `awaiting` for AWAITING_STABLE_MS. This is
 * what keeps notifications meaningful instead of spammy.
 */

const POLL_MS = 1500
const AWAITING_STABLE_MS = 4000

interface PaneTrack {
  tone: PaneDisplayTone
  awaitingSince: number | null
  notifiedAwaiting: boolean
}

export function useAgentNotifications(): void {
  useEffect(() => {
    const tracks = new Map<string, PaneTrack>()

    const fire = (title: string, body: string, paneId: string, workspaceId: string): void => {
      void window.oxe?.notifications?.notify({ title, body, paneId, workspaceId }).catch(() => undefined)
    }

    const tick = (): void => {
      if (!useSettingsStore.getState().notificationsEnabled) return
      const { panes: termPanes, activePaneId } = useTerminalStore.getState()
      const workspaces = useWorkspaceStore.getState().workspaces
      const windowFocused = typeof document !== 'undefined' ? document.hasFocus() : true
      const now = Date.now()

      for (const ws of workspaces) {
        for (const pane of ws.panes) {
          if (pane.type !== 'terminal') continue
          const entry = termPanes[pane.id]
          if (!entry) continue

          const tone = deriveStatusTone(entry)
          const existing = tracks.get(pane.id)
          // First sighting — record state, never notify (avoids a burst on load).
          if (!existing) {
            tracks.set(pane.id, { tone, awaitingSince: tone === 'awaiting' ? now : null, notifiedAwaiting: false })
            continue
          }

          // Don't ping about the pane the user is actively looking at.
          const isViewing = windowFocused && activePaneId === pane.id
          const label = (pane.displayName || pane.agentName || 'Agente').trim()

          if (tone === 'awaiting') {
            if (existing.tone !== 'awaiting') {
              existing.awaitingSince = now
              existing.notifiedAwaiting = false
            }
            if (
              !existing.notifiedAwaiting &&
              existing.awaitingSince !== null &&
              now - existing.awaitingSince >= AWAITING_STABLE_MS &&
              !isViewing
            ) {
              existing.notifiedAwaiting = true
              fire(`${label} — aguardando você`, `${ws.name}: o agente terminou e espera sua resposta.`, pane.id, ws.id)
            }
          } else {
            existing.awaitingSince = null
            existing.notifiedAwaiting = false
          }

          // exited / error fire once on the transition into that tone.
          if (tone !== existing.tone && !isViewing) {
            if (tone === 'exited') {
              fire(`${label} — sessão encerrada`, `${ws.name}: o terminal do agente foi finalizado.`, pane.id, ws.id)
            } else if (tone === 'error') {
              fire(`${label} — precisa de atenção`, `${ws.name}: ${entry.error ?? 'o agente encontrou um erro.'}`, pane.id, ws.id)
            }
          }

          existing.tone = tone
        }
      }
    }

    const id = window.setInterval(tick, POLL_MS)
    return () => window.clearInterval(id)
  }, [])
}
