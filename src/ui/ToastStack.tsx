import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactElement } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { i18n } from '../i18n'
import { Button, IconButton } from './Button'
import { cx } from './cx'
import styles from './Display.module.css'
import { REPEAT_ANNOUNCE_MS, dismissToast, useToasts, type ToastItem } from './Toast'

/** How long a new region waits before taking the toasts already waiting, so assistive technology has registered it. */
export const ANNOUNCE_AFTER_MOUNT_MS = 150

const ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle }

/** Closes the toast after its timeout, counting only the time it is not paused; a merged repeat (a new item object) starts over. */
function useAutoDismiss(item: ToastItem, paused: boolean): void {
  const left = useRef({ item, ms: item.timeout })
  useEffect(() => {
    if (left.current.item !== item) left.current = { item, ms: item.timeout }
    if (!item.timeout || paused) return
    const started = Date.now()
    const timer = setTimeout(() => { dismissToast(item.id); item.onTimeout?.() }, left.current.ms)
    return () => { clearTimeout(timer); left.current.ms = Math.max(0, left.current.ms - (Date.now() - started)) }
  }, [item, paused])
}

/** The count screen readers hear: it settles once a burst of repeats stops, so four repeats are one announcement. */
function useSpokenCount(count: number): number {
  const [spoken, setSpoken] = useState(1)
  useEffect(() => {
    if (count === 1) return
    const timer = setTimeout(() => setSpoken(count), REPEAT_ANNOUNCE_MS)
    return () => clearTimeout(timer)
  }, [count])
  return spoken
}

function ToastView({ item, paused, close }: { item: ToastItem; paused: boolean; close: (id: number, element: HTMLElement | null) => void }): ReactElement {
  const intent = item.intent ?? 'info'
  const Icon = ICON[intent]
  const ref = useRef<HTMLDivElement>(null)
  useAutoDismiss(item, paused)
  const spoken = useSpokenCount(item.count)
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.preventDefault(); event.stopPropagation()
    close(item.id, ref.current)
  }
  // Failures are assertive; everything else is spoken by the polite region around the stack.
  return <div ref={ref} data-toast={intent} className={cx(styles.toast, styles[intent])} role={intent === 'danger' ? 'alert' : undefined} onKeyDown={onKeyDown}>
    <Icon size={16} className={styles.toastIcon} aria-hidden="true" />
    <div>
      <div className={styles.toastTitle}><strong>{item.title}</strong>{item.count > 1 && <span className={styles.toastCount} aria-hidden="true"> ×{item.count}</span>}</div>
      {item.description && <p>{item.description}</p>}
      <span className="sr-only">{spoken > 1 ? i18n.t('ui.toast.repeated', { count: spoken }) : ''}</span>
      {item.action && <div className={styles.toastActions}><Button size="sm" onClick={() => { item.action!.run(); dismissToast(item.id) }}>{item.action.label}</Button></div>}
    </div>
    <IconButton label={i18n.t('ui.toast.dismiss')} icon={<X size={14} />} size="sm" onClick={() => close(item.id, ref.current)} />
  </div>
}

/**
 * The toast stack (mounted by Toaster). The region is always in the page, so screen readers hear each new toast
 * without it taking focus. Hovering it or moving focus into it pauses every timer (WCAG 2.2.1).
 */
export default function ToastStack(): ReactElement {
  const items = useToasts(state => state.items)
  // Toasts already waiting (raised before the stack loaded) go in just after the region does, so screen readers,
  // which only hear changes to a region already in the page, announce them too.
  const [listening, setListening] = useState(() => !useToasts.getState().items.length)
  useEffect(() => {
    if (listening) return
    const timer = setTimeout(() => setListening(true), ANNOUNCE_AFTER_MOUNT_MS)
    return () => clearTimeout(timer)
  }, [listening])
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const region = useRef<HTMLElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const onFocus = (event: FocusEvent<HTMLElement>): void => {
    const from = event.relatedTarget as HTMLElement | null
    if (from && !event.currentTarget.contains(from)) returnTo.current = from
    setFocused(true)
  }
  const onBlur = (event: FocusEvent<HTMLElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
  }
  // Closing the toast that has focus moves it to the next toast's close button, or back to where it came from.
  const close = (id: number, element: HTMLElement | null): void => {
    const hadFocus = !!element?.contains(document.activeElement)
    const toasts = [...(region.current?.querySelectorAll<HTMLElement>('[data-toast]') ?? [])]
    const next = toasts[toasts.indexOf(element!) + 1] ?? toasts[toasts.indexOf(element!) - 1]
    dismissToast(id)
    if (!hadFocus) return
    const target = next?.querySelector<HTMLElement>('button[aria-label]') ?? (returnTo.current?.isConnected ? returnTo.current : null)
    if (!next) setFocused(false)
    target?.focus()
  }
  // A stack that empties under the pointer gets no mouseleave; the next toast must not start paused.
  useEffect(() => { if (!items.length) setHovered(false) }, [items.length])
  const paused = hovered || focused
  return <section ref={region} className={styles.toasts} aria-label={i18n.t('ui.toast.region')} aria-live="polite" aria-atomic="false"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={onFocus} onBlur={onBlur}>
    {listening && items.map(item => <ToastView key={item.id} item={item} paused={paused} close={close} />)}
  </section>
}
