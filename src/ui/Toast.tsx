import { useEffect, type ReactElement } from 'react'
import { create } from 'zustand'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { Button, IconButton } from './Button'
import { cx } from './cx'
import styles from './Display.module.css'

export interface ToastInput {
  title: string
  description?: string
  intent?: 'info' | 'success' | 'warning' | 'danger'
  action?: { label: string; run: () => void }
  /** Milliseconds before it closes on its own; failures stay until dismissed. */
  duration?: number
}
interface ToastItem extends ToastInput { id: number }

const MAX_TOASTS = 4
let counter = 0

const useToasts = create<{ items: ToastItem[]; push: (toast: ToastInput) => number; dismiss: (id: number) => void }>(set => ({
  items: [],
  push: toast => { const id = ++counter; set(state => ({ items: [...state.items, { ...toast, id }].slice(-MAX_TOASTS) })); return id },
  dismiss: id => set(state => ({ items: state.items.filter(item => item.id !== id) }))
}))

/** Shows a short message in the corner. Use for results of actions, not for questions. */
export function toast(input: ToastInput): number {
  return useToasts.getState().push(input)
}
export function dismissToast(id: number): void {
  useToasts.getState().dismiss(id)
}

const ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle }

function ToastView({ item }: { item: ToastItem }): ReactElement {
  const intent = item.intent ?? 'info'
  const Icon = ICON[intent]
  useEffect(() => {
    const duration = item.duration ?? (intent === 'danger' ? 0 : 5000)
    if (!duration) return
    const timer = setTimeout(() => dismissToast(item.id), duration)
    return () => clearTimeout(timer)
  }, [item.id, item.duration, intent])
  return <div className={cx(styles.toast, styles[intent])} role={intent === 'danger' || intent === 'warning' ? 'alert' : 'status'}>
    <Icon size={16} className={styles.toastIcon} aria-hidden="true" />
    <div>
      <strong>{item.title}</strong>
      {item.description && <p>{item.description}</p>}
      {item.action && <div className={styles.toastActions}><Button size="sm" onClick={() => { item.action!.run(); dismissToast(item.id) }}>{item.action.label}</Button></div>}
    </div>
    <IconButton label="Dismiss" icon={<X size={14} />} size="sm" onClick={() => dismissToast(item.id)} />
  </div>
}

/** Mount once near the root of the app. */
export function Toaster(): ReactElement | null {
  const items = useToasts(state => state.items)
  if (!items.length) return null
  return <div className={styles.toasts} aria-live="polite">{items.map(item => <ToastView key={item.id} item={item} />)}</div>
}
