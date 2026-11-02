import { X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { messageKey, messageValues } from '../../../../shared/messages'
import { THREAD_MESSAGE_MAX_CHARS } from '../../../../shared/threadLimits'
import { formatNumber } from '../../../utils/formatTime'
import { Badge, Button, ErrorState, IconButton, TextArea } from '../../../ui'
import { shortcutLabel } from '../../../keyboard/keybindings'
import { formatThreadCost } from '../threadCost'
import { compactTokens } from '../ThreadUsagePanel'
import { SIDE_SEND_FAILED, type SideChatCost } from './sideChatModel'
import { useSideChat } from './useSideChat'
import styles from './ThreadSideChat.module.css'

/** What the side chat has cost so far: the price when the provider reports one, the tokens always. */
export function sideChatCostLabel(cost: SideChatCost, t: (key: string, values?: Record<string, unknown>) => string): string {
  const tokens = cost.inputTokens + cost.outputTokens
  if (!cost.pricedTurns && !tokens) return t('side.noCostYet')
  const parts = [t('spending.tokens', { tokens: compactTokens(tokens) })]
  if (cost.pricedTurns) parts.unshift(t('spending.cost', { cost: formatThreadCost(cost.usd) }))
  return parts.join(' · ')
}

/** What was typed in each conversation's side chat and not sent yet; it survives closing the drawer, not the app. */
const drafts = new Map<string, string>()

/** Why main would refuse this question (the same rule: no NUL, at most THREAD_MESSAGE_MAX_CHARS), or null. */
export function sideQuestionProblem(text: string): 'nul' | 'tooLong' | null {
  if (text.includes('\0')) return 'nul'
  if (text.length > THREAD_MESSAGE_MAX_CHARS) return 'tooLong'
  return null
}

/**
 * The side chat drawer (B1.2, Ctrl+.): questions about this conversation, answered by a read-only copy of its session.
 * Nothing asked here reaches the conversation; the copy is thrown away when the drawer closes. Its cost is always in
 * view, since the copy runs on the person's account like the conversation does.
 */
export function ThreadSideChat({ threadId, onClose }: { threadId: string; onClose: () => void }): ReactElement {
  const { t } = useTranslation('thread')
  const { t: tMain, i18n } = useTranslation('main')
  const tm = tMain as unknown as (key: string, values: Record<string, string>) => string
  const { state, send } = useSideChat(threadId)
  const [draft, setDraftState] = useState(() => drafts.get(threadId) ?? '')
  const setDraft = (value: string): void => {
    if (value) drafts.set(threadId, value)
    else drafts.delete(threadId)
    setDraftState(value)
  }
  const problem = sideQuestionProblem(draft)
  const input = useRef<HTMLTextAreaElement>(null)
  const log = useRef<HTMLOListElement>(null)
  const ready = state.phase === 'open' && !state.busy

  useEffect(() => { if (state.phase === 'open') input.current?.focus() }, [state.phase])
  useEffect(() => { log.current?.lastElementChild?.scrollIntoView?.({ block: 'nearest' }) }, [state.entries])

  const submit = (): void => {
    if (!ready || !draft.trim() || problem) return
    void send(draft)
    setDraft('')
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() }
  }
  const costLabel = sideChatCostLabel(state.cost, t as unknown as (key: string, values?: Record<string, unknown>) => string)

  return <aside className={styles.drawer} aria-label={t('side.region')} data-testid="thread-side-chat" data-side-id={state.sideId ?? undefined}
    onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose() } }}>
    <header className={styles.header}>
      <div className={styles.title}>
        <h2>{t('side.title')}</h2>
        <Badge>{t('side.readOnly')}</Badge>
      </div>
      <IconButton label={t('side.close', { shortcut: shortcutLabel('thread.sideChat') })} icon={<X size={14} />} onClick={onClose} data-testid="thread-side-chat-close" />
    </header>
    <p className={styles.note}>{t('side.note')}</p>
    <p className={styles.cost} data-testid="thread-side-chat-cost"><span>{t('side.costLabel')}</span> {costLabel}</p>
    {state.phase === 'refused' && state.refusal
      ? <div data-testid="thread-side-chat-refused"><ErrorState compact title={tm(messageKey(state.refusal.code), messageValues(state.refusal, i18n.language))} /></div>
      : state.phase === 'failed'
        ? <ErrorState compact title={t('side.openFailed')} />
        : <ol ref={log} className={styles.log} aria-label={t('side.messages')} aria-live="polite" data-testid="thread-side-chat-log">
          {state.phase === 'opening' && <li className={styles.status}>{t('side.opening')}</li>}
          {state.phase === 'open' && !state.entries.length && <li className={styles.status}>{t('side.empty')}</li>}
          {state.entries.map(entry => <li key={entry.id} className={entry.role === 'user' ? styles.question : styles.answer}>
            <span className="sr-only">{entry.role === 'user' ? t('side.you') : t('side.copy')}: </span>{entry.text}
          </li>)}
        </ol>}
    {state.busy && <p className={styles.status} role="status">{state.activity ? t('side.working', { activity: state.activity }) : t('side.thinking')}</p>}
    {state.error !== null && <ErrorState compact title={state.error === SIDE_SEND_FAILED ? t('side.sendFailed') : t('side.turnFailed')}
      detail={state.error === SIDE_SEND_FAILED || !state.error ? undefined : state.error} />}
    {problem && <ErrorState compact title={problem === 'nul' ? t('side.nul') : t('composer.tooLong', { length: formatNumber(draft.length), limit: formatNumber(THREAD_MESSAGE_MAX_CHARS) })} />}
    <form className={styles.composer} onSubmit={event => { event.preventDefault(); submit() }}>
      <TextArea ref={input} className={styles.input} rows={3} value={draft} disabled={state.phase !== 'open'} aria-label={t('side.ask')} placeholder={t('side.placeholder')}
        onChange={event => setDraft(event.target.value)} onKeyDown={onKeyDown} data-testid="thread-side-chat-input" />
      <Button type="submit" variant="primary" size="sm" disabled={!ready || !draft.trim() || problem !== null} loading={state.busy}>{t('side.send')}</Button>
    </form>
  </aside>
}
