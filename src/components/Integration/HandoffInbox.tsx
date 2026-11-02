import { Archive, CheckCircle2, Send } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { IntegrationGroup, IntegrationHandoff } from '../../../shared/types/integration'
import { useIntegrationStore } from '../../store/integration.store'
import { Button, EmptyState, Notice, Select, TextField, TextArea } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import { formatRelative } from '../../utils/formatTime'

// One empty list for every group without handoffs: a fresh [] per read makes zustand 5 re-render forever.
const NO_HANDOFFS: IntegrationHandoff[] = []

interface HandoffInboxProps {
  group: IntegrationGroup
  currentMemberId: string | null
  onSelectMember: (memberId: string) => void
}

/**
 * Renders the integration group's handoff inbox: messages sent between
 * members. Closes the loop the schema was already built for — without this
 * panel the `integration_handoffs` table was write-only from the user's
 * perspective.
 *
 * The visible ordering puts unsaved handoffs first (sent > draft) so the
 * user is drawn to actionable items, with applied/saved handoffs collapsed
 * into a history footer. When the current member is the destination of a
 * 'sent' handoff and that member has a pane bound, the row shows an
 * "Apply to agent" button that writes the content to the recipient's pane
 * and flips the row to 'saved' so it stops competing for attention.
 */
export function HandoffInbox({ group, currentMemberId, onSelectMember }: HandoffInboxProps): ReactElement {
  const { t } = useTranslation('code')
  const handoffs = useIntegrationStore((s) => s.handoffs[group.id] ?? NO_HANDOFFS)
  const loadHandoffs = useIntegrationStore((s) => s.loadHandoffs)
  const updateHandoff = useIntegrationStore((s) => s.updateHandoff)
  const createHandoff = useIntegrationStore((s) => s.createHandoff)
  const [showHistory, setShowHistory] = useState(false)
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [targetMemberId, setTargetMemberId] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    void loadHandoffs(group.id)
  }, [group.id, loadHandoffs])

  const memberById = useMemo(() => {
    const map = new Map(group.members.map((m) => [m.id, m]))
    return map
  }, [group.members])
  const recipients = useMemo(
    () => group.members.filter((member) => member.id !== currentMemberId),
    [group.members, currentMemberId]
  )

  useEffect(() => {
    if (!recipients.some((member) => member.id === targetMemberId)) {
      setTargetMemberId(recipients[0]?.id ?? '')
    }
  }, [recipients, targetMemberId])

  const { active, history } = useMemo(() => {
    const a: IntegrationHandoff[] = []
    const h: IntegrationHandoff[] = []
    for (const handoff of handoffs) {
      if (handoff.status === 'saved') h.push(handoff)
      else a.push(handoff)
    }
    // Active sorted by status priority (sent first, then draft) then by recency.
    a.sort((x, y) => {
      const priority = (s: IntegrationHandoff['status']): number => s === 'sent' ? 0 : s === 'draft' ? 1 : 2
      return priority(x.status) - priority(y.status) || y.createdAt - x.createdAt
    })
    return { active: a, history: h }
  }, [handoffs])

  const handleApply = async (handoff: IntegrationHandoff): Promise<void> => {
    setError(null)
    const target = memberById.get(handoff.toMemberId)
    if (!target?.paneId) {
      setError(t('integration.handoff.bindFirst', { role: target?.role ?? t('integration.handoff.recipientFallback') }))
      return
    }
    setApplyingId(handoff.id)
    try {
      // Write the handoff body as input to the recipient's pane. The trailing
      // newline ensures the CLI processes the block as one turn — same
      // contract the slash dispatcher uses for context injection.
      await window.oxe.terminal.write({ paneId: target.paneId, data: handoff.content + '\n' })
      await updateHandoff({ handoffId: handoff.id, status: 'saved' })
    } catch (err) {
      setError(humanizeError(err))
    } finally {
      setApplyingId(null)
    }
  }

  const handleResend = async (handoff: IntegrationHandoff): Promise<void> => {
    // Treat "Re-open" as bumping status back to 'sent' so the row reappears
    // in active. Useful when the agent's first application was wrong and the
    // user wants to re-prompt.
    setError(null)
    try {
      await updateHandoff({ handoffId: handoff.id, status: 'sent' })
    } catch (err) {
      setError(humanizeError(err))
    }
  }

  const handleCreate = async (): Promise<void> => {
    setError(null)
    setNotice(null)
    if (!currentMemberId) {
      setError(t('integration.handoff.selectSender'))
      return
    }
    if (!targetMemberId || !content.trim()) {
      setError(t('integration.handoff.chooseRecipient'))
      return
    }
    const target = memberById.get(targetMemberId)
    setIsSending(true)
    try {
      await createHandoff({
        groupId: group.id,
        fromMemberId: currentMemberId,
        toMemberId: targetMemberId,
        title: title.trim() || t('integration.handoff.defaultTitle', { role: target?.role.toUpperCase() ?? t('integration.handoff.memberFallback') }),
        content: content.trim(),
        status: 'sent'
      })
      setTitle('')
      setContent('')
      setNotice(target?.paneId
        ? t('integration.handoff.sent', { member: target.alias })
        : t('integration.handoff.recorded', { member: target?.alias ?? t('integration.handoff.theRecipient') }))
    } catch (err) {
      setError(humanizeError(err))
    } finally {
      setIsSending(false)
    }
  }

  if (active.length === 0 && history.length === 0) {
    return (
      <div className="integration-handoff-block">
        <HandoffComposer
          content={content}
          currentMemberId={currentMemberId}
          isSending={isSending}
          onContentChange={setContent}
          onSend={() => void handleCreate()}
          onTargetChange={setTargetMemberId}
          onTitleChange={setTitle}
          recipients={recipients}
          targetMemberId={targetMemberId}
          title={title}
        />
        {error ? <Notice intent="danger">{error}</Notice> : null}
        {notice ? <div className="integration-notice" role="status">{notice}</div> : null}
        <EmptyState compact title={t('integration.handoff.empty')} />
      </div>
    )
  }

  return (
    <div className="integration-handoff-block">
      <HandoffComposer
        content={content}
        currentMemberId={currentMemberId}
        isSending={isSending}
        onContentChange={setContent}
        onSend={() => void handleCreate()}
        onTargetChange={setTargetMemberId}
        onTitleChange={setTitle}
        recipients={recipients}
        targetMemberId={targetMemberId}
        title={title}
      />
      {error ? <Notice intent="danger">{error}</Notice> : null}
      {notice ? <div className="integration-notice" role="status">{notice}</div> : null}
      <div className="integration-handoff-list">
        {active.map((handoff) => (
          <HandoffRow
            key={handoff.id}
            handoff={handoff}
            fromMember={memberById.get(handoff.fromMemberId)}
            toMember={memberById.get(handoff.toMemberId)}
            isCurrentRecipient={handoff.toMemberId === currentMemberId}
            isApplying={applyingId === handoff.id}
            onApply={() => void handleApply(handoff)}
            onFocusMember={onSelectMember}
          />
        ))}
      </div>
      {history.length > 0 ? (
        <Button
         
          variant="ghost" size="sm" className="integration-handoff-toggle"
          onClick={() => setShowHistory((value) => !value)}
        >
          <Archive size={12} aria-hidden="true" />
          {showHistory ? t('integration.handoff.hideApplied', { count: history.length }) : t('integration.handoff.showApplied', { count: history.length })}
        </Button>
      ) : null}
      {showHistory ? (
        <div className="integration-handoff-list integration-handoff-history">
          {history.map((handoff) => (
            <HandoffRow
              key={handoff.id}
              handoff={handoff}
              fromMember={memberById.get(handoff.fromMemberId)}
              toMember={memberById.get(handoff.toMemberId)}
              isCurrentRecipient={handoff.toMemberId === currentMemberId}
              isApplying={false}
              onApply={() => void handleResend(handoff)}
              onFocusMember={onSelectMember}
              isHistory
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

interface HandoffComposerProps {
  content: string
  currentMemberId: string | null
  isSending: boolean
  onContentChange: (value: string) => void
  onSend: () => void
  onTargetChange: (value: string) => void
  onTitleChange: (value: string) => void
  recipients: IntegrationGroup['members']
  targetMemberId: string
  title: string
}

function HandoffComposer({ content, currentMemberId, isSending, onContentChange, onSend, onTargetChange, onTitleChange, recipients, targetMemberId, title }: HandoffComposerProps): ReactElement {
  const { t } = useTranslation('code')
  const hasRecipients = recipients.length > 0
  return (
    <section className="integration-handoff-composer" aria-labelledby="handoff-composer-title">
      <div className="integration-handoff-composer-header">
        <div>
          <strong id="handoff-composer-title">{t('integration.handoff.composerTitle')}</strong>
          <span>{t('integration.handoff.composerHint')}</span>
        </div>
      </div>
      {!currentMemberId ? <p className="integration-handoff-composer-hint">{t('integration.handoff.selectMember')}</p> : null}
      {!hasRecipients ? <p className="integration-handoff-composer-hint">{t('integration.handoff.addMember')}</p> : null}
      <div className="integration-handoff-composer-fields">
        <label className="integration-field">
          <span>{t('integration.handoff.recipient')}</span>
          <Select value={targetMemberId} onChange={(event) => onTargetChange(event.currentTarget.value)} disabled={!currentMemberId || !hasRecipients || isSending}>
            {recipients.map((member) => <option key={member.id} value={member.id}>{member.role.toUpperCase()} · {member.alias}{member.paneId ? '' : ` — ${t('integration.handoff.noAgent')}`}</option>)}
          </Select>
        </label>
        <label className="integration-field">
          <span>{t('integration.handoff.subject')}</span>
          <TextField value={title} onChange={(event) => onTitleChange(event.currentTarget.value)} placeholder={t('integration.handoff.subjectPlaceholder')} disabled={!currentMemberId || !hasRecipients || isSending} />
        </label>
      </div>
      <label className="integration-field">
        <span>{t('integration.handoff.next')}</span>
        <TextArea value={content} onChange={(event) => onContentChange(event.currentTarget.value)} placeholder={t('integration.handoff.nextPlaceholder')} rows={3} disabled={!currentMemberId || !hasRecipients || isSending} />
      </label>
      <div className="integration-handoff-composer-actions">
        <Button variant="primary" size="sm" onClick={onSend} disabled={!currentMemberId || !hasRecipients || !targetMemberId || !content.trim() || isSending}>
          <Send size={12} aria-hidden="true" />
          {isSending ? t('integration.handoff.sending') : t('integration.handoff.send')}
        </Button>
      </div>
    </section>
  )
}

interface HandoffRowProps {
  handoff: IntegrationHandoff
  fromMember: IntegrationGroup['members'][number] | undefined
  toMember: IntegrationGroup['members'][number] | undefined
  isCurrentRecipient: boolean
  isApplying: boolean
  isHistory?: boolean
  onApply: () => void
  onFocusMember: (memberId: string) => void
}

function HandoffRow({ handoff, fromMember, toMember, isCurrentRecipient, isApplying, isHistory, onApply, onFocusMember }: HandoffRowProps): ReactElement {
  const { t } = useTranslation('code')
  const fromLabel = fromMember ? `${fromMember.role}/${fromMember.alias}` : t('integration.handoff.unknown')
  const toLabel = toMember ? `${toMember.role}/${toMember.alias}` : t('integration.handoff.unknown')
  const canApply = !isHistory && handoff.status === 'sent' && Boolean(toMember?.paneId)
  return (
    <article
      className={`integration-handoff-row status-${handoff.status}${isCurrentRecipient ? ' for-you' : ''}`}
      aria-label={t('integration.handoff.label', { from: fromLabel, to: toLabel })}
    >
      <header className="integration-handoff-header">
        <button
          type="button"
          className="integration-handoff-pill"
          onClick={() => fromMember && onFocusMember(fromMember.id)}
          title={t('integration.handoff.focus', { member: fromLabel })}
        >
          {fromLabel}
        </button>
        <span className="integration-handoff-arrow" aria-hidden="true">→</span>
        <button
          type="button"
          className="integration-handoff-pill"
          onClick={() => toMember && onFocusMember(toMember.id)}
          title={t('integration.handoff.focus', { member: toLabel })}
        >
          {toLabel}
        </button>
        <span className="integration-handoff-status">{t(`integration.handoff.status.${handoff.status}`)}</span>
        <time className="integration-handoff-time">{formatRelative(handoff.createdAt)}</time>
      </header>
      {handoff.title ? <strong className="integration-handoff-title">{handoff.title}</strong> : null}
      <pre className="integration-handoff-body">{handoff.content}</pre>
      <footer className="integration-handoff-actions">
        {isHistory ? (
          <Button variant="ghost" size="sm" onClick={onApply} title={t('integration.handoff.reopenTitle')}>
            <Send size={12} aria-hidden="true" />
            {t('integration.handoff.reopen')}
          </Button>
        ) : canApply ? (
          <Button variant="primary" size="sm" disabled={isApplying} onClick={onApply}>
            <CheckCircle2 size={12} aria-hidden="true" />
            {isApplying ? t('integration.handoff.applying') : t('integration.handoff.apply')}
          </Button>
        ) : !isHistory && handoff.status === 'sent' && !toMember?.paneId ? (
          <span className="integration-handoff-hint">{t('integration.handoff.bindToApply', { member: toLabel })}</span>
        ) : null}
      </footer>
    </article>
  )
}
