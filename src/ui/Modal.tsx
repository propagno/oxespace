import type { ComponentProps, ReactElement } from 'react'
import { Dialog as RadixDialog } from 'radix-ui'
import styles from './Overlay.module.css'

/**
 * Modal behavior without a look: focus trap, Escape, outside click and aria
 * wiring, for surfaces that bring their own layout (the full-screen Settings,
 * the workspace wizard, the Tools hub). New dialogs use `Dialog` instead.
 */
export const ModalRoot = RadixDialog.Root
export const ModalTitle = RadixDialog.Title
export const ModalDescription = RadixDialog.Description
export const ModalClose = RadixDialog.Close

export function ModalSurface({ scrimClassName, children, ...props }: ComponentProps<typeof RadixDialog.Content> & { scrimClassName?: string }): ReactElement {
  return <RadixDialog.Portal>
    <RadixDialog.Overlay className={scrimClassName ?? styles.surfaceScrim} />
    <RadixDialog.Content {...props}>{children}</RadixDialog.Content>
  </RadixDialog.Portal>
}
