import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Copy, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadRequest, ThreadRequestResponse } from '../../../shared/types/thread'
import { Badge, Button, copyText, IconButton } from '../../ui'
import { threadApprovalRisk } from '../Threads/threadApprovalRisk'
import { ImpactFacts } from './ImpactFacts'
import styles from './Approvals.module.css'
import { focusIsEditable } from './typingFocus'

const TOAST_MS = 12_000

function hasOpenModal(): boolean {
  if (typeof document === 'undefined') return false
  return document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]') !== null
}

export function ApprovalToast({
  request,
  agent,
  conversation,
  place,
  queued = 0,
  onRespond,
  onSeeImpact,
  onOpenConversation,
  onClose
}: {
  request: ThreadRequest
  agent: string
  conversation?: string
  place?: string
  queued?: number
  onRespond: (response: ThreadRequestResponse) => Promise<void>
  onSeeImpact: () => void
  onOpenConversation?: () => void
  onClose: () => void
}): ReactElement | null {
  const { t } = useTranslation('thread')
  const { t: tCommon } = useTranslation('common')
  const [modalOpen, setModalOpen] = useState<boolean>(hasOpenModal)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const denyRef = useRef<HTMLButtonElement>(null)
  const programmaticFocus = useRef(false)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const sync = (): void => setModalOpen(hasOpenModal())
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role', 'aria-modal']
    })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (modalOpen) return
    // OXE-175: someone typing keeps their focus; the polite status announces the toast and Ctrl+Shift+A reaches it.
    if (focusIsEditable()) return
    programmaticFocus.current = true
    denyRef.current?.focus()
    programmaticFocus.current = false
  }, [modalOpen, request.id])

  useEffect(() => {
    if (modalOpen || hovered || focused) return
    const timer = setTimeout(() => {
      onCloseRef.current()
    }, TOAST_MS)
    return () => clearTimeout(timer)
  }, [modalOpen, hovered, focused, request.id])

  if (modalOpen) return null

  const impact = request.impact
  const impactRisk = impact?.risk ?? 'low'
  const policyRisk = threadApprovalRisk(request, false)
  const level = policyRisk === 'critical' ? 'critical' : impactRisk
  const canAllow = Boolean(impact?.reversible) && (level === 'low' || level === 'medium')
  const riskIntent = level === 'medium' ? 'warning' : level === 'high' || level === 'critical' ? 'danger' : 'neutral'

  return (
    <div
      data-ui="approval-toast"
      className={styles.toast}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => {
        if (!programmaticFocus.current) setFocused(true)
      }}
      onBlur={event => {
        const next = event.relatedTarget as Node | null
        if (!next || !event.currentTarget.contains(next)) setFocused(false)
      }}
    >
      <span role="status" aria-live="polite" className={styles.srOnly}>
        {t('f7.toast.needsYou', { title: request.title, agent })}
      </span>
      <div className={styles.toastHeader}>
        <span className={styles.toastKicker}>
          <Sun size={15} aria-hidden="true" className={styles.toastIcon} />
          <span>{t('f7.card.needsApproval', { agent })}</span>
        </span>
        {queued >= 1 ? (
          <Badge data-ui="approval-toast-queue" intent="neutral">
            {t('f7.toast.moreInQueue', { count: queued })}
          </Badge>
        ) : null}
      </div>
      {conversation || place ? (
        <div className={styles.toastContext}>
          {conversation ? <span data-ui="approval-toast-conversation" className={styles.toastConversation}>{conversation}</span> : null}
          {place ? <span data-ui="approval-toast-place" className={styles.toastPlace}>{place}</span> : null}
        </div>
      ) : null}
      {impact ? (
        <div data-ui="approval-toast-command" className={styles.toastCommand}>
          <code className={styles.toastCommandCode}>{impact.text}</code>
          <IconButton
            className={styles.toastCopy}
            label={t('approvalDetails.copyExact')}
            icon={<Copy size={14} aria-hidden="true" />}
            onClick={() => {
              if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(impact.text)
              else void copyText(impact.text, t('f7.card.copyWhat'))
            }}
          />
        </div>
      ) : null}
      <div className={styles.toastFacts}>
        {impact ? <ImpactFacts impact={impact} layout="chips" /> : null}
        <Badge
          data-ui="risk-label"
          data-risk={level}
          intent={riskIntent}
          className={level === 'critical' ? styles.critical : undefined}
        >
          {tCommon('approvals.risk.label', { level: tCommon(`approvals.risk.${level}`) })}
        </Badge>
      </div>
      <div className={styles.toastActions}>
        <Button ref={denyRef} variant="secondary" size="sm" onClick={() => void onRespond({ decision: 'decline' })}>
          {t('request.deny')}
        </Button>
        {canAllow ? (
          <>
            {onOpenConversation ? (
              <Button variant="secondary" size="sm" onClick={onOpenConversation}>
                {t('f7.toast.openConversation')}
              </Button>
            ) : null}
            <Button variant="primary" size="sm" onClick={() => void onRespond({ decision: 'accept' })}>
              {t('f7.card.allowOnce')}
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" onClick={onSeeImpact}>
            {t('f7.card.seeImpact')}
          </Button>
        )}
      </div>
    </div>
  )
}
