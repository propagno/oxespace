import { useEffect } from 'react'
import { useTerminalStore } from '../store/terminal.store'
import { useWorkspaceStore } from '../store/workspace.store'
import { useSettingsStore } from '../store/settings.store'
import { useActivityStore } from '../store/activity.store'
import { agentErrorDetail, paneNoticeLabel } from '../utils/agentNotice'
import { deriveStatusTone, resolvePaneIdentity, type PaneDisplayTone } from '../utils/paneDisplay'
import type { WorkspacePane } from '../../shared/types/workspace'
import { i18n } from '../i18n'

const tc = i18n.getFixedT(null, 'code')

/**
 * The name a notice and an activity entry use: the pane's own name, its agent, or the agent its shell profile
 * launches (Claude, Codex...). The generic "Agent" only when none of them is known.
 */
export function noticeLabel(pane: WorkspacePane, shellProfileName: string | null): string {
  // B10: a name an agent chose never passes for one of the app's own; the translated word stands in for it.
  const named = (pane.displayName || pane.agentName)?.trim()
  if (named) return paneNoticeLabel(pane, tc('pane.notice.agent'))
  const identity = resolvePaneIdentity({ pane, profile: null, shellProfileName })
  return identity.key === 'shell' ? tc('pane.notice.agent') : identity.label
}

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
 *
 * `needs-decision` (an agent stopped on an approval or a question) is none of
 * that: it comes from the agent's lifecycle, not output timing, so it is
 * recorded and pinged on entry, focused or not, and outside the cooldown — a
 * finished turn a minute ago must not hide a request now. Only the pane being
 * looked at is spared the ping.
 */

const POLL_MS = 1500
const AWAITING_STABLE_MS = 10_000
const COOLDOWN_MS = 5 * 60_000

interface PaneTrack {
  tone: PaneDisplayTone
  awaitingSince: number | null
  notifiedAwaiting: boolean
  recordedAwaiting: boolean
  recordedDecision: boolean
  lastNotifiedAt: number | null
}

export function useAgentNotifications(): void {
  useEffect(() => {
    const tracks = new Map<string, PaneTrack>()

    const fire = (title: string, body: string, paneId: string, workspaceId: string): void => {
      void window.oxe?.notifications?.notify({ title, body, paneId, workspaceId }).catch(() => undefined)
    }

    // The activity center records every transition; the OS ping keeps its own gates.
    const tick = (): void => {
      const notificationsEnabled = useSettingsStore.getState().notificationsEnabled
      const activity = useActivityStore.getState()
      const { panes: termPanes, activePaneId } = useTerminalStore.getState()
      const { workspaces, shellProfiles } = useWorkspaceStore.getState()
      const windowFocused = typeof document !== 'undefined' ? document.hasFocus() : true
      const now = Date.now()

      for (const ws of workspaces) {
        for (const pane of ws.panes) {
          if (pane.type !== 'terminal') continue
          const entry = termPanes[pane.id]
          if (!entry) continue

          const tone = deriveStatusTone(entry)
          const existing = tracks.get(pane.id)
          const label = noticeLabel(pane, shellProfiles.find(profile => profile.id === (pane.shellProfileId ?? ws.defaultShellProfileId))?.name ?? null)
          const errorBody = (): string => tc('pane.notice.errorBody', { workspace: ws.name, error: agentErrorDetail(entry.error, tc('pane.notice.errorFallback')) })
          const target = { type: 'pane' as const, workspaceId: ws.id, paneId: pane.id }
          // Don't ping about the pane the user is actively looking at.
          const isViewing = windowFocused && activePaneId === pane.id
          const recordDecision = (): void => activity.record({ source: 'code', id: pane.id, kind: 'needs-you', target, title: label, detail: tc('pane.decisionNotice.body', { workspace: ws.name }), read: isViewing })
          // First sighting — record state, never notify (avoids a burst on load).
          if (!existing) {
            // A request already waiting at load is listed (never pinged): it still needs the person.
            if (tone === 'needs-decision') recordDecision()
            tracks.set(pane.id, { tone, awaitingSince: tone === 'awaiting' ? now : null, notifiedAwaiting: false, recordedAwaiting: false, recordedDecision: tone === 'needs-decision', lastNotifiedAt: null })
            continue
          }
          // Global per-pane rate limit: at most one ping per cooldown window,
          // whatever the tone does in between.
          const onCooldown = existing.lastNotifiedAt !== null && now - existing.lastNotifiedAt < COOLDOWN_MS
          const notify = (title: string, body: string): void => {
            if (onCooldown || !notificationsEnabled) return
            existing.lastNotifiedAt = now
            fire(title, body, pane.id, ws.id)
          }

          if (tone === 'needs-decision') {
            if (existing.tone !== 'needs-decision') {
              existing.recordedDecision = true
              recordDecision()
              if (notificationsEnabled && !isViewing) fire(tc('pane.decisionNotice.title', { agent: label }), tc('pane.decisionNotice.body', { workspace: ws.name }), pane.id, ws.id)
            }
          } else if (existing.recordedDecision) {
            existing.recordedDecision = false
            activity.resolve('code', pane.id)
          }

          if (tone === 'awaiting') {
            if (existing.tone !== 'awaiting') {
              existing.awaitingSince = now
              existing.notifiedAwaiting = false
            }
            // Same stability gate as the ping, so token gaps do not fill the list.
            if (!existing.recordedAwaiting && existing.awaitingSince !== null && now - existing.awaitingSince >= AWAITING_STABLE_MS) {
              existing.recordedAwaiting = true
              activity.record({ source: 'code', id: pane.id, kind: 'needs-you', target, title: label, detail: tc('pane.notice.finishedBody', { workspace: ws.name }), read: isViewing })
            }
            if (
              !existing.notifiedAwaiting &&
              existing.awaitingSince !== null &&
              now - existing.awaitingSince >= AWAITING_STABLE_MS &&
              // Away-only: while OXESpace is focused the status dots cover it.
              !windowFocused
            ) {
              existing.notifiedAwaiting = true
              notify(tc('pane.notice.finishedTitle', { agent: label }), tc('pane.notice.finishedBody', { workspace: ws.name }))
            }
          } else {
            existing.awaitingSince = null
            existing.notifiedAwaiting = false
            // A decision just took the same entry's place; resolving would drop it.
            if (existing.recordedAwaiting && tone !== 'needs-decision') activity.resolve('code', pane.id)
            existing.recordedAwaiting = false
          }

          // exited / error fire once on the transition into that tone.
          if (tone !== existing.tone && (tone === 'exited' || tone === 'error')) {
            activity.record(tone === 'exited'
              ? { source: 'code', id: pane.id, kind: 'finished', target, title: label, detail: tc('pane.notice.endedBody', { workspace: ws.name }), read: isViewing }
              : { source: 'code', id: pane.id, kind: 'failed', target, title: label, detail: errorBody(), read: isViewing })
          }
          if (tone !== existing.tone && !isViewing) {
            if (tone === 'exited') {
              notify(tc('pane.notice.endedTitle', { agent: label }), tc('pane.notice.endedBody', { workspace: ws.name }))
            } else if (tone === 'error') {
              notify(tc('pane.notice.errorTitle', { agent: label }), errorBody())
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
