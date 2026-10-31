/** A question Thread asks before an action that changes or removes a conversation. */
export interface ThreadConfirmation {
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
  /** The command that carries out the action once confirmed. */
  command: string
  /** Archiving a conversation whose children still run: they are archived with it (B1.3). */
  childConversations?: { active: number; total: number }
}

/** Archiving a conversation with active children asks once more and takes them along. */
export function threadArchiveWithChildren(children: { active: number; total: number }, conversation?: string): ThreadConfirmation {
  const subject = conversation ? `“${conversation}”` : 'this conversation'
  const count = children.active === 1 ? 'one conversation it started is still working' : `${children.active} conversations it started are still working`
  return { title: 'Archive this conversation and the ones it started?', confirmLabel: 'Archive all', command: '/archive confirm-with-children', childConversations: children,
    description: `Archive ${subject}? ${count[0].toUpperCase()}${count.slice(1)}; they stop and are archived with it. You can restore them from Archived in the sidebar.` }
}

/**
 * One wording for each action, whether it starts from a slash command or from the sidebar menu.
 * The sidebar names the conversation; the command acts on the open one.
 */
export function threadConfirmation(action: 'archive' | 'delete' | 'rewind', conversation?: string): ThreadConfirmation {
  const subject = conversation ? `“${conversation}”` : 'this conversation'
  switch (action) {
    case 'archive': return { title: 'Archive this conversation?', confirmLabel: 'Archive conversation', command: '/archive confirm',
      description: `Archive ${subject}? An active turn will stop. You can restore it from Archived in the sidebar or with /resume.` }
    case 'delete': return { title: 'Delete this conversation?', confirmLabel: 'Delete conversation', command: '/delete confirm', danger: true,
      description: `Delete ${subject} from OXESpace? An active turn will stop. The provider session and project files are kept.` }
    case 'rewind': return { title: 'Rewind the last turn?', confirmLabel: 'Rewind one turn', command: '/rewind 1', danger: true,
      description: 'Remove the most recent turn from the native conversation. Files are not reverted; restore them from a checkpoint if needed.' }
  }
}
