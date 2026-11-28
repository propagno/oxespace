import { ChevronDown, MoreHorizontal, X } from 'lucide-react'
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { messageKey, messageValues } from '../../../../shared/messages'
import { THREAD_MESSAGE_MAX_CHARS } from '../../../../shared/threadLimits'
import { THREAD_PROVIDERS, threadAgentName } from '../../../../shared/threadProviders'
import type { ThreadProvider, ThreadSideOpenOptions } from '../../../../shared/types/thread'
import { formatNumber } from '../../../utils/formatTime'
import { Badge, Button, ConfirmDialog, ErrorState, IconButton, Menu, TextArea } from '../../../ui'
import { shortcutLabel } from '../../../keyboard/keybindings'
import { formatThreadCost } from '../threadCost'
import { compactTokens } from '../ThreadUsagePanel'
import { initialSideChat, SIDE_SEND_FAILED, type SideChatCost } from './sideChatModel'
import {
  discardSideChat,
  ensureSideChat,
  sendSideChat,
  setSideChatDraft,
  sideChatHasAnswers,
  switchSideChatProvider,
  useSideChatStore
} from './sideChatStore'
import styles from './ThreadSideChat.module.css'

/** What the side chat has cost so far: the price when the provider reports one, the tokens always. */
export function sideChatCostLabel(cost: SideChatCost, t: (key: string, values?: Record<string, unknown>) => string): string {
  const tokens = cost.inputTokens + cost.outputTokens
  if (!cost.pricedTurns && !tokens) return t('side.noCostYet')
  const parts = [t('spending.tokens', { tokens: compactTokens(tokens) })]
  if (cost.pricedTurns) parts.unshift(t('spending.cost', { cost: formatThreadCost(cost.usd) }))
  return parts.join(' · ')
}

/** Why main would refuse this question (the same rule: no NUL, at most THREAD_MESSAGE_MAX_CHARS), or null. */
export function sideQuestionProblem(text: string): 'nul' | 'tooLong' | null {
  if (text.includes('\0')) return 'nul'
  if (text.length > THREAD_MESSAGE_MAX_CHARS) return 'tooLong'
  return null
}

/** Quiet inline-code formatting for editorial side-chat answers without unsafe HTML or extra parser weight. */
function renderInlineCode(text: string): ReactNode {
  if (!text.includes('`')) return text
  const parts = text.split(/(`[^`\n]+`)/g)
  return parts.map((part, index) => (
    part.length >= 2 && part.startsWith('`') && part.endsWith('`')
      ? <code key={index} className={styles.inlineCode}>{part.slice(1, -1)}</code>
      : <Fragment key={index}>{part}</Fragment>
  ))
}

const OPENING = initialSideChat()

export interface ThreadSideChatProps {
  threadId: string
  /** Provider of the main conversation (or active pane's agent), used for cross-provider indicator and initial label. */
  defaultProvider?: ThreadProvider
  /** Providers offered in the header switcher (defaults to Claude, Codex, Antigravity). */
  availableProviders?: readonly ThreadProvider[]
  /** Extra open options (e.g. OxeCode terminal ScreenMirror source). */
  openOptions?: ThreadSideOpenOptions
  /** Keybinding id shown on the Hide button (`thread.sideChat` in OxeChat, `code.sideChat` in OxeCode). */
  shortcutId?: 'thread.sideChat' | 'code.sideChat'
  onClose: () => void
  onLeave: () => void
}

/**
 * The side chat drawer (B1.2, OXE-466, Ctrl+. / /btw): read-only questions about this conversation or active OxeCode
 * terminal, answered by Antigravity, Claude or Codex without touching the main conversation, PTY or database.
 * Switching provider cleanly discards the previous ephemeral copy and opens a fresh read-only side session.
 */
export function ThreadSideChat({
  threadId,
  defaultProvider,
  availableProviders = THREAD_PROVIDERS,
  openOptions,
  shortcutId = 'thread.sideChat',
  onClose,
  onLeave
}: ThreadSideChatProps): ReactElement {
  const { t } = useTranslation('thread')
  const { t: tMain, i18n } = useTranslation('main')
  const tm = tMain as unknown as (key: string, values: Record<string, string>) => string
  const state = useSideChatStore(store => store.chats[threadId]) ?? OPENING
  const openOptionsKey = openOptions ? JSON.stringify(openOptions) : ''
  useEffect(() => {
    void ensureSideChat(threadId, openOptions)
    // Re-open only when the target id or explicit open options change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, openOptionsKey])

  const [confirming, setConfirming] = useState(false)
  const actions = useRef<HTMLButtonElement>(null)
  const discard = (): void => { setConfirming(false); void discardSideChat(threadId); onClose() }
  const draft = useSideChatStore(store => store.drafts[threadId] ?? '')
  const setDraft = (value: string): void => setSideChatDraft(threadId, value)
  const problem = sideQuestionProblem(draft)
  const input = useRef<HTMLTextAreaElement>(null)
  const log = useRef<HTMLOListElement>(null)
  const ready = state.phase === 'open' && !state.busy

  useEffect(() => { if (state.phase === 'open') input.current?.focus() }, [state.phase])
  useEffect(() => { log.current?.lastElementChild?.scrollIntoView?.({ block: 'nearest' }) }, [state.entries])

  const isTerminal = state.source === 'terminal' || openOptions?.source === 'terminal'
  const activeProvider: ThreadProvider | null = state.provider ?? openOptions?.provider ?? defaultProvider ?? null
  const providerChoices = availableProviders.length
    ? (activeProvider && !availableProviders.includes(activeProvider) ? [...availableProviders, activeProvider] : availableProviders)
    : THREAD_PROVIDERS
  const isCrossProvider = !isTerminal && Boolean(activeProvider && defaultProvider && activeProvider !== defaultProvider)

  const handleProviderChange = (next: string): void => {
    if (next !== 'claude' && next !== 'codex' && next !== 'antigravity') return
    if (next === activeProvider && (state.phase === 'open' || state.phase === 'opening')) return
    const baseOptions = openOptions
      ? { model: openOptions.model, source: openOptions.source, paneId: openOptions.paneId, workspaceId: openOptions.workspaceId, rootPath: openOptions.rootPath }
      : undefined
    void switchSideChatProvider(threadId, next, baseOptions)
  }

  const submit = (): void => {
    if (!ready || !draft.trim() || problem) return
    void sendSideChat(threadId, draft)
    setDraft('')
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() }
  }
  const costLabel = sideChatCostLabel(state.cost, t as unknown as (key: string, values?: Record<string, unknown>) => string)
  const noteText = isTerminal
    ? t('side.terminalNote')
    : isCrossProvider && activeProvider
      ? t('side.crossProviderNote', { provider: threadAgentName(activeProvider) })
      : t('side.note')

  return <aside className={styles.drawer} aria-label={t('side.region')} data-testid="thread-side-chat" data-side-id={state.sideId ?? undefined} data-side-provider={activeProvider ?? undefined} data-side-source={isTerminal ? 'terminal' : 'thread'}
    onKeyDown={event => {
      // The menu and the confirmation are portalled: their Esc closes them and bubbles here through React, not the DOM.
      if (event.key === 'Escape' && !event.defaultPrevented && event.currentTarget.contains(event.target as Node)) { event.preventDefault(); onLeave() }
    }}>
    <header className={styles.header}>
      <div className={styles.title}>
        <h2>{t('side.title')}</h2>
        <Badge>{isTerminal ? t('side.terminalBadge') : t('side.readOnly')}</Badge>
      </div>
      <div className={styles.headerControls}>
        {providerChoices.length > 0 && (
          <Menu
            label={t('side.providerSwitch')}
            align="end"
            items={[{
              type: 'radio',
              value: activeProvider ?? '',
              onValueChange: handleProviderChange,
              options: providerChoices.map(provider => ({
                value: provider,
                label: threadAgentName(provider)
              }))
            }]}
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={styles.providerTrigger}
                aria-label={t('side.providerLabel')}
                title={t('side.providerSwitch')}
                data-testid="thread-side-chat-provider"
              >
                <span className={styles.providerDot} data-provider={activeProvider ?? undefined} aria-hidden="true" />
                <span>{activeProvider ? threadAgentName(activeProvider) : t('side.providerLabel')}</span>
                <ChevronDown size={12} aria-hidden="true" />
              </Button>
            }
          />
        )}
        <Menu label={t('side.actions')} align="end" items={[{ label: t('side.discard'), onSelect: () => { if (sideChatHasAnswers(state)) setConfirming(true); else discard() } }]}
          trigger={<IconButton ref={actions} label={t('side.actions')} icon={<MoreHorizontal size={14} />} data-testid="thread-side-chat-actions" />} />
        <IconButton label={t('side.close', { shortcut: shortcutLabel(shortcutId) })} icon={<X size={14} />} onClick={onClose} data-testid="thread-side-chat-close" />
      </div>
    </header>
    <div className={styles.meta}>
      <p className={styles.note}>{noteText}</p>
      <p className={styles.cost} data-testid="thread-side-chat-cost"><span>{t('side.costLabel')}</span> {costLabel}</p>
    </div>
    <div className={styles.body}>
      {state.phase === 'refused' && state.refusal
        ? <div data-testid="thread-side-chat-refused"><ErrorState compact title={tm(messageKey(state.refusal.code), messageValues(state.refusal, i18n.language))} /></div>
        : state.phase === 'failed'
          ? <ErrorState compact title={t('side.openFailed')} />
          : <ol ref={log} className={styles.log} aria-label={t('side.messages')} aria-live="polite" data-testid="thread-side-chat-log">
            {state.phase === 'opening' && <li className={styles.status}>{isTerminal ? t('side.openingTerminal') : t('side.opening')}</li>}
            {state.phase === 'open' && !state.entries.length && <li className={styles.status}>{isTerminal ? t('side.emptyTerminal') : t('side.empty')}</li>}
            {state.entries.map(entry => <li key={entry.id} className={entry.role === 'user' ? styles.question : styles.answer}>
              <span className="sr-only">{entry.role === 'user' ? t('side.you') : t('side.copy')}: </span>
              {entry.role === 'assistant' ? renderInlineCode(entry.text) : entry.text}
            </li>)}
          </ol>}
      {state.busy && <p className={styles.status} role="status">{state.activity ? t('side.working', { activity: state.activity }) : t('side.thinking')}</p>}
      {state.error !== null && <ErrorState compact title={state.error === SIDE_SEND_FAILED ? t('side.sendFailed') : t('side.turnFailed')}
        detail={state.error === SIDE_SEND_FAILED || !state.error ? undefined : state.error} />}
      {problem && <ErrorState compact title={problem === 'nul' ? t('side.nul') : t('composer.tooLong', { length: formatNumber(draft.length), limit: formatNumber(THREAD_MESSAGE_MAX_CHARS) })} />}
    </div>
    <form className={styles.composer} onSubmit={event => { event.preventDefault(); submit() }}>
      <TextArea ref={input} className={styles.input} rows={3} value={draft} disabled={state.phase !== 'open'} aria-label={t('side.ask')} placeholder={isTerminal ? t('side.placeholderTerminal') : t('side.placeholder')}
        onChange={event => setDraft(event.target.value)} onKeyDown={onKeyDown} data-testid="thread-side-chat-input" />
      <Button type="submit" variant="primary" size="sm" disabled={!ready || !draft.trim() || problem !== null} loading={state.busy}>{t('side.send')}</Button>
    </form>
    {confirming && <ConfirmDialog title={t('side.discardTitle')} description={t('side.discardBody')} confirmLabel={t('side.discardConfirm')} cancelLabel={t('side.keep')} danger
      returnFocusTo={() => actions.current} onCancel={() => setConfirming(false)} onConfirm={discard} />}
  </aside>
}
