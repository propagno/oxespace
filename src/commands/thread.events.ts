import { i18n } from '../i18n'
import { toast } from '../ui'

/**
 * What the boot path needs from the thread commands, without them (T52): the commands themselves load after the first
 * frame (`CommandContributors`), and these stay small.
 */

/** ThreadView runs `{ text }` as if it was typed in the composer of the active conversation. */
export const THREAD_RUN_COMMAND_EVENT = 'oxe:thread-run-command'

export function sayAddProjectFirst(): void {
  toast({ title: i18n.t('thread:accounts.needProject'), description: i18n.t('thread:accounts.needProjectText') })
}
