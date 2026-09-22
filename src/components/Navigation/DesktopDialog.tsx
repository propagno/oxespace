import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'

export function DesktopDialog({ className, title, description, onClose, children }: {
  className: string; title: string; description: string; onClose: () => void; children: ReactNode
}) {
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent unstyled showCloseButton={false} className={`desktop-dialog ${className}`} overlayClassName="desktop-dialog-overlay">
      <header className="desktop-dialog-header"><div><DialogTitle asChild><h2>{title}</h2></DialogTitle><DialogDescription asChild><p>{description}</p></DialogDescription></div><button type="button" className="desktop-dialog-close" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><X size={16} aria-hidden="true" /></button></header>
      {children}
    </DialogContent>
  </Dialog>
}
