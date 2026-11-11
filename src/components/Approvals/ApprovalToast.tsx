import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThreadRequest, ThreadRequestResponse } from '../../../shared/types/thread'
import { Button } from '../../ui'

const TOAST_MS = 12_000

function hasOpenModal(): boolean {
  if (typeof document === 'undefined') return false
  return document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]') !== null
}

export function ApprovalToast({
  request,
  agent,
  onRespond,
  onSeeImpact,
  onClose
}: {
  request: ThreadRequest
  agent: string
  onRespond: (response: ThreadRequestResponse) => Promise<void>
  onSeeImpact: () => void
  onClose: () => void
}): ReactElement | null {
  const { t } = useTranslation('thread')
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

  const reversible = request.impact?.reversible === true

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => {
        if (!programmaticFocus.current) setFocused(true)
      }}
      onBlur={event => {
        const next = event.relatedTarget as Node | null
        if (!next || !event.currentTarget.contains(next)) setFocused(false)
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        padding: 'var(--space-3)',
        background: 'var(--surface-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)'
      }}
    >
      <span>{t('f7.toast.needsYou', { title: request.title, agent })}</span>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <Button ref={denyRef} variant="secondary" size="sm" onClick={() => void onRespond({ decision: 'decline' })}>
          {t('request.deny')}
        </Button>
        {reversible ? (
          <Button variant="primary" size="sm" onClick={() => void onRespond({ decision: 'accept' })}>
            {t('f7.card.allow')}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={onSeeImpact}>
            {t('f7.card.seeImpact')}
          </Button>
        )}
      </div>
    </div>
  )
}
