import { useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { ModalDescription, ModalRoot, ModalSurface, ModalTitle } from '../../ui/Modal'

export function DesktopDialog({ className, title, description, onClose, children, returnFocusTo }: {
  className: string; title: string; description: string; onClose: () => void; children: ReactNode; returnFocusTo?: () => HTMLElement | null
}) {
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  return <ModalRoot open onOpenChange={open => { if (!open) onClose() }}>
    <ModalSurface className={`desktop-dialog ${className}`} scrimClassName="desktop-dialog-overlay"
      onCloseAutoFocus={event => {
        event.preventDefault()
        const target = returnFocusTo?.() ?? returnFocus.current
        if (target?.isConnected && !target.hasAttribute('disabled')) target.focus({ preventScroll: true })
        else document.querySelector<HTMLElement>('.thread-composer textarea, [data-testid="btn-new-workspace"]')?.focus({ preventScroll: true })
      }}>
      <header className="desktop-dialog-header"><div><ModalTitle asChild><h2>{title}</h2></ModalTitle><ModalDescription asChild><p>{description}</p></ModalDescription></div><button type="button" className="desktop-dialog-close" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><X size={16} aria-hidden="true" /></button></header>
      {children}
    </ModalSurface>
  </ModalRoot>
}
