import { threadConfirmation, type ThreadConfirmation } from '../../../shared/threadConfirmations'
import { i18n } from '../../i18n'

type Action = 'archive' | 'archiveChildren' | 'delete' | 'rewind'
const ACTION_BY_COMMAND: Record<string, Action> = { '/archive confirm': 'archive', '/archive confirm-with-children': 'archiveChildren', '/delete confirm': 'delete', '/rewind 1': 'rewind' }

/**
 * A confirmation in the interface language. shared/threadConfirmations keeps the English wording the main process
 * sends with a slash command; the command it carries says which action it is. An unknown one is shown as sent.
 */
export function localizeConfirmation(confirmation: ThreadConfirmation, conversation?: string): ThreadConfirmation {
  const action = ACTION_BY_COMMAND[confirmation.command]
  if (!action) return confirmation
  const t = i18n.t.bind(i18n)
  // Archiving with children counts the ones still working, which stop and are archived with it.
  const count = { count: confirmation.childConversations?.active ?? 0 }
  return {
    ...confirmation,
    title: t(`thread:confirm.${action}.title`),
    confirmLabel: t(`thread:confirm.${action}.confirm`),
    description: conversation && action !== 'rewind' ? t(`thread:confirm.${action}.descriptionNamed`, { name: conversation, ...count }) : t(`thread:confirm.${action}.description`, count)
  }
}

/** The confirmation for an action started from the interface, naming the conversation when there is one. */
export function threadConfirmationText(action: Exclude<Action, 'archiveChildren'>, conversation?: string): ThreadConfirmation {
  return localizeConfirmation(threadConfirmation(action, conversation), conversation)
}
