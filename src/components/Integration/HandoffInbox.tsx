import { Archive, CheckCircle2, Send } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { IntegrationGroup, IntegrationHandoff } from '../../../shared/types/integration'
import { useIntegrationStore } from '../../store/integration.store'

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
  const handoffs = useIntegrationStore((s) => s.handoffs[group.id] ?? [])
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
      setError(`Bind a pane to "${target?.role ?? 'recipient'}" before applying — the handoff has nowhere to go yet.`)
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
      setError(err instanceof Error ? err.message : String(err))
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
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleCreate = async (): Promise<void> => {
    setError(null)
    setNotice(null)
    if (!currentMemberId) {
      setError('Select the member that is sending this handoff before continuing.')
      return
    }
    if (!targetMemberId || !content.trim()) {
      setError('Choose a recipient and describe the work they need to continue.')
      return
    }
    const target = memberById.get(targetMemberId)
    setIsSending(true)
    try {
      await createHandoff({
        groupId: group.id,
        fromMemberId: currentMemberId,
        toMemberId: targetMemberId,
        title: title.trim() || `Handoff for ${target?.role.toUpperCase() ?? 'member'}`,
        content: content.trim(),
        status: 'sent'
      })
      setTitle('')
      setContent('')
      setNotice(target?.paneId
        ? `Handoff sent to ${target.alias}. It is ready to apply in the linked agent terminal.`
        : `Handoff recorded for ${target?.alias ?? 'the recipient'}. Link an agent terminal before applying it.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
        {error ? <div className="integration-error" role="alert">{error}</div> : null}
        {notice ? <div className="integration-notice" role="status">{notice}</div> : null}
        <div className="integration-empty-inline">
          <span>No handoffs yet. Send a focused request to keep this delivery moving.</span>
        </div>
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
      {error ? <div className="integration-error" role="alert">{error}</div> : null}
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
        <button
          type="button"
          className="ghost-btn small integration-handoff-toggle"
          onClick={() => setShowHistory((value) => !value)}
        >
          <Archive size={12} aria-hidden="true" />
          {showHistory ? `Hide applied (${history.length})` : `Show applied (${history.length})`}
        </button>
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
  const hasRecipients = recipients.length > 0
  return (
    <section className="integration-handoff-composer" aria-labelledby="handoff-composer-title">
      <div className="integration-handoff-composer-header">
        <div>
          <strong id="handoff-composer-title">Send a handoff</strong>
          <span>Give the next agent the decision, context and action they need.</span>
        </div>
      </div>
      {!currentMemberId ? <p className="integration-handoff-composer-hint">Select your workspace member above before sending a handoff.</p> : null}
      {!hasRecipients ? <p className="integration-handoff-composer-hint">Add another workspace member before sending a handoff.</p> : null}
      <div className="integration-handoff-composer-fields">
        <label className="integration-field">
          <span>Recipient</span>
          <select value={targetMemberId} onChange={(event) => onTargetChange(event.currentTarget.value)} disabled={!currentMemberId || !hasRecipients || isSending}>
            {recipients.map((member) => <option key={member.id} value={member.id}>{member.role.toUpperCase()} · {member.alias}{member.paneId ? '' : ' — no agent linked'}</option>)}
          </select>
        </label>
        <label className="integration-field">
          <span>Subject</span>
          <input value={title} onChange={(event) => onTitleChange(event.currentTarget.value)} placeholder="e.g. Validate the checkout contract" disabled={!currentMemberId || !hasRecipients || isSending} />
        </label>
      </div>
      <label className="integration-field">
        <span>What should happen next?</span>
        <textarea value={content} onChange={(event) => onContentChange(event.currentTarget.value)} placeholder="Include the decision, relevant context and the next action." rows={3} disabled={!currentMemberId || !hasRecipients || isSending} />
      </label>
      <div className="integration-handoff-composer-actions">
        <button type="button" className="primary-btn small" onClick={onSend} disabled={!currentMemberId || !hasRecipients || !targetMemberId || !content.trim() || isSending}>
          <Send size={11} aria-hidden="true" />
          {isSending ? 'Sending handoff…' : 'Send handoff'}
        </button>
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
  const fromLabel = fromMember ? `${fromMember.role}/${fromMember.alias}` : 'unknown'
  const toLabel = toMember ? `${toMember.role}/${toMember.alias}` : 'unknown'
  const canApply = !isHistory && handoff.status === 'sent' && Boolean(toMember?.paneId)
  return (
    <article
      className={`integration-handoff-row status-${handoff.status}${isCurrentRecipient ? ' for-you' : ''}`}
      aria-label={`Handoff from ${fromLabel} to ${toLabel}`}
    >
      <header className="integration-handoff-header">
        <button
          type="button"
          className="integration-handoff-pill"
          onClick={() => fromMember && onFocusMember(fromMember.id)}
          title={`Focus ${fromLabel}`}
        >
          {fromLabel}
        </button>
        <span className="integration-handoff-arrow" aria-hidden="true">→</span>
        <button
          type="button"
          className="integration-handoff-pill"
          onClick={() => toMember && onFocusMember(toMember.id)}
          title={`Focus ${toLabel}`}
        >
          {toLabel}
        </button>
        <span className="integration-handoff-status">{handoff.status}</span>
        <time className="integration-handoff-time">{formatRelative(handoff.createdAt)}</time>
      </header>
      {handoff.title ? <strong className="integration-handoff-title">{handoff.title}</strong> : null}
      <pre className="integration-handoff-body">{handoff.content}</pre>
      <footer className="integration-handoff-actions">
        {isHistory ? (
          <button type="button" className="ghost-btn small" onClick={onApply} title="Mark as active again so it shows on top">
            <Send size={11} aria-hidden="true" />
            Re-open
          </button>
        ) : canApply ? (
          <button type="button" className="primary-btn small" disabled={isApplying} onClick={onApply}>
            <CheckCircle2 size={11} aria-hidden="true" />
            {isApplying ? 'Applying…' : 'Apply to agent'}
          </button>
        ) : !isHistory && handoff.status === 'sent' && !toMember?.paneId ? (
          <span className="integration-handoff-hint">Bind a pane to {toLabel} to apply.</span>
        ) : null}
      </footer>
    </article>
  )
}

function formatRelative(createdAtMs: number): string {
  const diff = Date.now() - createdAtMs
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
