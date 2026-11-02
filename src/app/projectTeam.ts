import type { TeamScope } from '../../shared/types/team'
import { i18n } from '../i18n'
import type { AppView } from '../keyboard/keybindings'
import { toast } from '../ui/Toast'

export interface ProjectTeam {
  /** The project whose Team opens here, or null when there is none. */
  target: TeamScope | null
  /** Why it can't open here: the palette's description, the Tools menu's second line and the shortcut's toast. */
  unavailable: string | undefined
  open(): void
  /** Mod+Shift+T: opens the Team, or says why it can't (never a silent no-op). */
  openOrSay(): void
}

/**
 * The Team belongs to a project: the selected workspace in OxeCode, the selected project in OxeChat. Off the title
 * bar since F35; the palette, Tools › Project team…, Mod+Shift+T and the OxeChat project ⋯ open it.
 */
export function projectTeam(view: AppView, workspaceId: string | null | undefined, threadProjectId: string | null | undefined, show: (scope: TeamScope) => void): ProjectTeam {
  const target: TeamScope | null = view === 'thread' ? (threadProjectId ? { kind: 'thread', id: threadProjectId } : null)
    : view === 'code' ? (workspaceId ? { kind: 'code', id: workspaceId } : null) : null
  const unavailable = target ? undefined : i18n.t(view === 'code' ? 'team.button.needsWorkspace' : view === 'thread' ? 'team.button.needsProject' : 'team.button.otherViews')
  const open = (): void => { if (target) show(target) }
  return {
    target, unavailable, open,
    openOrSay: () => {
      if (target) show(target)
      else toast({ title: i18n.t('tools.team.label', { ns: 'code' }), description: unavailable, intent: 'info' })
    }
  }
}
