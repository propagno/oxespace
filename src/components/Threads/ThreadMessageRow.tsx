import { useState } from 'react'
import { threadAgentName } from '../../../shared/threadProviders'
import { Check, Clock3, Copy, FileText, Image as ImageIcon, Paperclip, Pencil, Quote } from 'lucide-react'
import { Button, Checkbox, IconButton, TextArea } from '../../ui'
import { editablePrompt } from '../../../shared/threadPromptEdit'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'
import { formatNumber } from '../../utils/formatTime'
import type { ThreadEvent, ThreadSnapshot } from '../../../shared/types/thread'
import { formatNativeUserText, taskNotification } from '../../../shared/native-session-text'
import { useThreadStore } from '../../store/thread.store'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { ThreadMarkdown } from './ThreadMarkdown'
import { ThreadDeliveryNote } from './ThreadDeliveryNote'
import { ThreadHistoricalQuestions } from './ThreadHistoricalQuestions'
import { threadTurnPresentation } from './threadTurnPresentation'
import './ThreadMessagesChrome.css'

export function authText(text: string): boolean { return /^Failed to authenticate:|^OAuth token (?:has expired|revoked)/i.test(text) }

const kilobytes = (bytes: number): string => i18n.t('thread:message.kilobytes', { size: formatNumber(Math.ceil(bytes / 1024)) })

export function ThreadMessageBody({ text, role }: { text: string; role: 'user' | 'assistant' }) {
  const { t } = useTranslation('thread')
  const [expanded, setExpanded] = useState(false)
  const longPrompt = role === 'user' && (text.length > 800 || text.split('\n').length > 12)
  if (!longPrompt) return <ThreadMarkdown text={text} />
  return <div className="thread-long-prompt">
    {expanded ? <ThreadMarkdown text={text} /> : <p className="thread-long-prompt-preview">{text.replace(/\s+/g, ' ').slice(0, 240).trimEnd()}…</p>}
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? t('message.showLess') : t('message.showFull')}</button>
  </div>
}

/**
 * The prompt card's own parts (AG-10 §2.1, OXE-167): Copy prompt on every prompt and Edit prompt on the one
 * editablePrompt names, shown under the pointer or with focus inside; the editor in the card; and, once edited, the
 * "Edited · resent below" line in place of Edit (the old turn and its changes stay where they are).
 */
function PromptCardTools({ event, turnId, turnEvents, snapshot, running, copied, text, action, onCopy }: {
  event: Extract<ThreadEvent, { type: 'message' }>
  turnId: string
  turnEvents: ThreadEvent[]
  snapshot: ThreadSnapshot | null
  running: boolean
  copied: boolean
  text: string
  action: (run: () => Promise<unknown>) => Promise<void>
  onCopy: (id: string, text: string) => void
}) {
  const { t } = useTranslation('thread')
  const [editing, setEditing] = useState<string | null>(null)
  const [restoreFiles, setRestoreFiles] = useState(false)
  const api = window.oxe?.thread
  const edited = Boolean(snapshot?.turns?.find(turn => turn.id === turnId)?.editedInto)
  const canEdit = !edited && !running && Boolean(api?.editPrompt) && editablePrompt(snapshot)?.messageId === event.id
  const changedFiles = turnEvents.some(value => value.type === 'tool' && Boolean(value.files?.length))
  if (editing !== null && snapshot && canEdit) {
    const send = (): void => {
      const value = editing
      void action(() => api!.editPrompt!(snapshot.thread.id, turnId, value, { restoreFiles })).then(() => setEditing(null))
    }
    return <div className="thread-prompt-editor">
      <TextArea label={t('message.editPrompt')} value={editing} rows={3} onChange={changed => setEditing(changed.target.value)} />
      {changedFiles && <Checkbox label={t('message.undoTurnChanges')} checked={restoreFiles} onChange={changed => setRestoreFiles(changed.target.checked)} />}
      <div className="thread-prompt-editor-actions">
        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
        <Button size="sm" variant="primary" disabled={!editing.trim()} onClick={send}>{t('composer.send')}</Button>
      </div>
    </div>
  }
  return <>
    {edited && <p className="thread-prompt-edited">{t('message.promptEdited')}</p>}
    <div className="thread-prompt-actions">
      <IconButton label={t('message.copyPrompt')} icon={copied ? <Check size={14} className="oxe-confirm" /> : <Copy size={14} />} onClick={() => onCopy(event.id, text)} />
      {canEdit && <IconButton label={t('message.editPrompt')} icon={<Pencil size={14} />} onClick={() => { setRestoreFiles(false); setEditing(text) }} />}
    </div>
  </>
}

/** One user or assistant message of the timeline, with its attachments, delivery state and actions. */
export function ThreadMessageRow({ event, turnId, turnEvents, snapshot, running, pending, copied, quickReplies, action, onCopy, onQuickReply, onQuote }: {
  event: Extract<ThreadEvent, { type: 'message' }>
  /** The turn this message belongs to (the prompt's turn shares its id). */
  turnId?: string
  turnEvents: ThreadEvent[]
  snapshot: ThreadSnapshot | null
  running: boolean
  pending: boolean
  copied: boolean
  /** Suggested replies; only passed for the latest assistant message. */
  quickReplies: { label: string; value: string }[]
  action: (run: () => Promise<unknown>) => Promise<void>
  onCopy: (id: string, text: string) => void
  onQuickReply: (value: string) => void
  /** Adds the text to the composer as a Markdown quote. */
  onQuote: (text: string) => void
}) {
  const { t } = useTranslation('thread')
  const api = window.oxe?.thread
  if (event.role === 'assistant' && authText(event.text)) return null
  const notice = event.role === 'user' ? taskNotification(event.text) : null
  if (notice) return <p className="thread-task-notice" role="note"><Clock3 size={12} aria-hidden="true" />{notice.summary ? t('message.taskNoticeSummary', { status: notice.status, summary: notice.summary }) : t('message.taskNotice', { status: notice.status })}</p>
  const displayText = event.role === 'user' && event.id.startsWith('native:') ? formatNativeUserText(event.text) : event.text
  if (!displayText && !event.historicalQuestions?.length) return null
  const copyText = event.historicalQuestions?.length ? [displayText, t('message.recovered'), ...event.historicalQuestions.flatMap(question => [question.title, ...(question.options ?? []).map(option => `- ${option}`)])].filter(Boolean).join('\n\n') : displayText
  const final = event.role === 'assistant' && threadTurnPresentation(turnEvents).finalMessageId === event.id
  const showAvatar = event.role === 'assistant' && (final || turnEvents.find(value => value.type === 'message' && value.role === 'assistant') === event)
  const provider = snapshot?.thread.provider ?? 'claude'
  return <article className={`thread-message thread-message-${event.role}${final ? ' is-final-response' : ''}`} data-ui={event.role === 'user' ? 'prompt-card' : undefined}>
    {showAvatar && (
      <div className="thread-agent-label">
        <span className="thread-agent-avatar" aria-hidden="true">
          <AgentProviderIcon provider={provider} size={18} />
        </span>
        <span className="thread-agent-name">{threadAgentName(provider)}</span>
      </div>
    )}
    {event.role === 'user' && event.attachments?.length ? <ul className="thread-sent-attachments" aria-label={t('message.attachments')}>{event.attachments.map(attachment => <li key={attachment.id} title={attachment.name}><ImageIcon size={14} aria-hidden="true" /><span>{attachment.name}</span><small>{kilobytes(attachment.bytes)}</small></li>)}</ul> : null}
    <ThreadMessageBody text={displayText} role={event.role} />
    {event.role === 'user' && event.context?.length ? <ul className="thread-sent-context" aria-label={t('message.context')}>{event.context.map(file => <li key={file.path} title={t(file.truncated ? 'message.bytesTruncated' : 'message.bytes', { bytes: formatNumber(file.bytes) })}><FileText size={12} aria-hidden="true" /><span>{file.path}</span>{file.truncated && <small>{t('message.truncated')}</small>}</li>)}</ul> : null}
    {event.role === 'user' && event.brief ? <details className="thread-sent-brief"><summary>{t('message.brief')}</summary><pre>{event.brief}</pre></details> : null}
    {event.role === 'user' && snapshot?.deliveries?.[event.id] && snapshot.deliveries[event.id].state !== 'delivered' ? <ThreadDeliveryNote delivery={snapshot.deliveries[event.id]} disabled={pending} onResend={() => void action(() => api!.send(snapshot.thread.id, event.text, event.attachments?.map(attachment => attachment.id) ?? []))} /> : null}
    {event.historicalQuestions?.length ? <ThreadHistoricalQuestions questions={event.historicalQuestions} /> : null}
    {event.role === 'assistant' && quickReplies.length > 0 && <div className="thread-quick-replies" aria-label={t('message.suggested')}><small>{t('message.suggestedHint')}</small><div>{quickReplies.map(option => <button type="button" key={option.value} onClick={() => onQuickReply(option.value)}>{option.label}</button>)}</div></div>}
    {event.role !== 'user' && event.attachments?.length ? <div className="thread-message-attachments" aria-label={t('message.attachments')}>{event.attachments.map(attachment => <span key={attachment.id}><Paperclip size={12} />{attachment.name}<small>{kilobytes(attachment.bytes)}</small></span>)}</div> : null}
    {event.role === 'user' && <PromptCardTools event={event} turnId={turnId ?? event.id} turnEvents={turnEvents} snapshot={snapshot} running={running} copied={copied} text={displayText} action={action} onCopy={onCopy} />}
    {event.role === 'assistant' && <div className="thread-message-actions">
      <button type="button" aria-label={t('message.quote')} title={t('message.quote')} onClick={() => onQuote(copyText)}><Quote size={14} /></button>
      <button type="button" aria-label={copied ? t('message.copiedLabel') : final ? t('message.copyFinal') : t('message.copyResponse')} title={copied ? t('message.copied') : final ? t('message.copyFinal') : t('message.copyResponse')} onClick={() => onCopy(event.id, copyText)}>{copied ? <Check size={14} className="oxe-confirm" /> : <Copy size={14} />}</button>
    </div>}
  </article>
}
