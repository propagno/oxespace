import type { ComponentProps, ReactElement } from 'react'
import { Dialog as RadixDialog } from 'radix-ui'
import styles from './Overlay.module.css'
import { Toaster } from './Toast'

/**
 * Modal behavior without a look: focus trap, Escape, outside click and aria
 * wiring, for surfaces that bring their own layout (the full-screen Settings,
 * the workspace wizard, the Tools hub). New dialogs use `Dialog` instead.
 */
export const ModalRoot = RadixDialog.Root
export const ModalTitle = RadixDialog.Title
export const ModalDescription = RadixDialog.Description
export const ModalClose = RadixDialog.Close

/** `toasts`: toasts show inside the surface while it is open (U2), for one whose own changes offer Undo. */
export function ModalSurface({ scrimClassName, children, toasts = false, ...props }: ComponentProps<typeof RadixDialog.Content> & { scrimClassName?: string; toasts?: boolean }): ReactElement {
  return <RadixDialog.Portal>
    <RadixDialog.Overlay className={scrimClassName ?? styles.surfaceScrim} />
    <RadixDialog.Content {...props}>{children}{toasts ? <Toaster inModal /> : null}</RadixDialog.Content>
  </RadixDialog.Portal>
}
