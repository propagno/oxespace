/** A question Thread asks before an action that changes or removes a conversation. */
export interface ThreadConfirmation {
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
  /** The command that carries out the action once confirmed. */
  command: string
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
