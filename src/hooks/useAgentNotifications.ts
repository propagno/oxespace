import { useEffect } from 'react'
import { useTerminalStore } from '../store/terminal.store'
import { useWorkspaceStore } from '../store/workspace.store'
import { useSettingsStore } from '../store/settings.store'
import { deriveStatusTone, type PaneDisplayTone } from '../utils/paneDisplay'

/**
 * Horizon 1 · item 1+2 — native desktop notifications driven by the fine-grained
 * agent state machine (`deriveStatusTone`).
 *
 * Polls every POLL_MS and fires a notification when a pane wants attention:
 *   - `awaiting`  → the agent finished and is waiting for input (the big one)
 *   - `exited`    → the agent's terminal closed
 *   - `error`     → the agent hit an error
 *
 * Anti-spam, in layers (an agent streams with frequent >1.5s pauses, so the
 * tone naturally flaps thinking↔awaiting — without these guards it would ping
 * constantly):
 *   1. Away-only: `awaiting` only notifies when the OXESpace window is NOT
 *      focused. While you're in the app, the sidebar/pane status dots already
 *      signal "your turn" — an OS notification would just be noise. OS pings
 *      are for when you've switched to another window.
 *   2. Per-pane cooldown: at most one notification per pane per COOLDOWN_MS,
 *      regardless of how often the tone flaps.
 *   3. Stability gate: only notify after the pane has held `awaiting` for
 *      AWAITING_STABLE_MS — a real "done, prompting you" pause, not a token gap.
 */

const POLL_MS = 1500
const AWAITING_STABLE_MS = 10_000
const COOLDOWN_MS = 5 * 60_000

interface PaneTrack {
  tone: PaneDisplayTone
  awaitingSince: number | null
  notifiedAwaiting: boolean
  lastNotifiedAt: number | null
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
            tracks.set(pane.id, { tone, awaitingSince: tone === 'awaiting' ? now : null, notifiedAwaiting: false, lastNotifiedAt: null })
            continue
          }

          // Don't ping about the pane the user is actively looking at.
          const isViewing = windowFocused && activePaneId === pane.id
          const label = (pane.displayName || pane.agentName || 'Agente').trim()
          // Global per-pane rate limit: at most one ping per cooldown window,
          // whatever the tone does in between.
          const onCooldown = existing.lastNotifiedAt !== null && now - existing.lastNotifiedAt < COOLDOWN_MS
          const notify = (title: string, body: string): void => {
            if (onCooldown) return
            existing.lastNotifiedAt = now
            fire(title, body, pane.id, ws.id)
          }

          if (tone === 'awaiting') {
            if (existing.tone !== 'awaiting') {
              existing.awaitingSince = now
              existing.notifiedAwaiting = false
            }
            if (
              !existing.notifiedAwaiting &&
              existing.awaitingSince !== null &&
              now - existing.awaitingSince >= AWAITING_STABLE_MS &&
              // Away-only: while OXESpace is focused the status dots cover it.
              !windowFocused
            ) {
              existing.notifiedAwaiting = true
              notify(`${label} — aguardando você`, `${ws.name}: o agente terminou e espera sua resposta.`)
            }
          } else {
            existing.awaitingSince = null
            existing.notifiedAwaiting = false
          }

          // exited / error fire once on the transition into that tone.
          if (tone !== existing.tone && !isViewing) {
            if (tone === 'exited') {
              notify(`${label} — sessão encerrada`, `${ws.name}: o terminal do agente foi finalizado.`)
            } else if (tone === 'error') {
              notify(`${label} — precisa de atenção`, `${ws.name}: ${entry.error ?? 'o agente encontrou um erro.'}`)
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
