import { useTranslation } from 'react-i18next'
import type { ThreadSnapshot } from '../../../shared/types/thread'
import { Button } from '../../ui'

/**
 * Plan mode in a Read only conversation (CHAT-5). There Claude runs without the tool that hands a plan over for
 * approval, so the plan arrives as text and nothing offers to run it. True for the latest turn once it finished,
 * while the conversation is still in Plan and Read only: changing either one makes the line moot.
 */
export function planOnlyTurn(snapshot: Pick<ThreadSnapshot, 'thread' | 'turns'> | null | undefined, turnId: string): boolean {
  if (!snapshot || snapshot.thread.provider !== 'claude') return false
  const last = snapshot.turns?.at(-1)
  return last?.id === turnId && last.status === 'completed' && snapshot.thread.mode === 'plan' && (snapshot.thread.access ?? 'read-only') === 'read-only'
}

/** Says what it takes to run the plan, and opens the access menu. */
export function ThreadPlanOnlyHint({ agent, onChangeAccess }: { agent: string; onChangeAccess: () => void }) {
  const { t } = useTranslation('thread')
  return <div className="thread-plan-only-hint" role="note" data-testid="plan-only-hint">
    <span>{t('planOnly.hint', { agent })}</span>
    <Button size="sm" variant="ghost" onClick={onChangeAccess}>{t('planOnly.changeAccess')}</Button>
  </div>
}
