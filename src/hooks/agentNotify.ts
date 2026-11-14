import { i18n } from '../i18n'
import { useSettingsStore } from '../store/settings.store'
import type { AgentNotificationPayload } from '../../shared/types/ipc'

/**
 * One way out for every agent notification, OxeChat conversation or OxeCode pane (OXE-130):
 *   - the title is the name alone, at most NOTICE_TITLE_MAX characters (a longer one is cut with an ellipsis);
 *   - "needs you" always plays the system sound; "finished" plays it only when Settings › Notifications says so;
 *   - within GROUP_WINDOW_MS the first GROUP_AFTER finished notices go one by one, the rest are held and leave as
 *     one grouped notice ("N agents finished") when the window ends. "Needs you" is never grouped.
 * The system's do-not-disturb mode is never bypassed: no urgency, no timeout, no toast XML.
 */
export const NOTICE_TITLE_MAX = 80
export const GROUP_WINDOW_MS = 10_000
export const GROUP_AFTER = 3

export type AgentNoticeKind = 'finished' | 'needs-you' | 'other'

export interface AgentNotice {
  kind: AgentNoticeKind
  title: string
  body: string
  paneId: string
  workspaceId: string
}

/** The name as a notification title: whole when it fits, otherwise its start and an ellipsis, within the limit. */
export function noticeTitle(name: string): string {
  const chars = [...name.trim()]
  if (chars.length <= NOTICE_TITLE_MAX) return chars.join('')
  return `${chars.slice(0, NOTICE_TITLE_MAX - 1).join('')}…`
}

interface GroupWindow {
  start: number
  sent: number
  held: Array<{ paneId: string; workspaceId: string }>
  timer: ReturnType<typeof setTimeout>
}

let group: GroupWindow | null = null

const finishSilent = (): boolean => !useSettingsStore.getState().finishSound

function send(payload: AgentNotificationPayload): void {
  void window.oxe?.notifications?.notify(payload).catch(() => undefined)
}

function closeGroup(): void {
  if (!group) return
  clearTimeout(group.timer)
  const held = group.held
  group = null
  if (held.length === 0) return
  send({
    title: noticeTitle(i18n.t('notify.agentsFinished', { ns: 'thread', count: held.length })),
    body: i18n.t('notify.agentsFinishedBody', { ns: 'thread' }),
    paneId: held[0].paneId,
    workspaceId: held[0].workspaceId,
    silent: finishSilent()
  })
}

export function sendAgentNotice({ kind, title, body, paneId, workspaceId }: AgentNotice): void {
  const base = { title: noticeTitle(title), body, paneId, workspaceId }
  if (kind !== 'finished') {
    send({ ...base, silent: false })
    return
  }
  const now = Date.now()
  // A window whose timer never ran (a clock that jumped) is over all the same.
  if (group && now - group.start >= GROUP_WINDOW_MS) closeGroup()
  if (!group) group = { start: now, sent: 0, held: [], timer: setTimeout(closeGroup, GROUP_WINDOW_MS) }
  if (group.sent < GROUP_AFTER) {
    group.sent += 1
    send({ ...base, silent: finishSilent() })
  } else {
    group.held.push({ paneId, workspaceId })
  }
}
