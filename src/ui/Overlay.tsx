import { useRef, type ReactElement, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { Dialog as RadixDialog, DropdownMenu as RadixMenu, Popover as RadixPopover, Tooltip as RadixTooltip } from 'radix-ui'
import { IconButton } from './Button'
import { cx } from './cx'
import styles from './Overlay.module.css'

export interface DialogProps {
  title: ReactNode
  description?: ReactNode
  onClose: () => void
  children: ReactNode
  /** Buttons at the bottom; the primary action goes last. */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  /** Element to focus when the dialog closes; defaults to what had focus before it opened. */
  returnFocusTo?: () => HTMLElement | null
  testId?: string
}

/** A modal dialog: title, optional description, body, and footer actions. Escape and the scrim close it. */
export function Dialog({ title, description, onClose, children, footer, size = 'md', className, returnFocusTo, testId }: DialogProps): ReactElement {
  const previous = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  return <RadixDialog.Root open onOpenChange={open => { if (!open) onClose() }}>
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={styles.scrim} />
      <RadixDialog.Content className={cx(styles.dialog, size !== 'md' && styles[size], className)} data-testid={testId}
        // Without a description, tell Radix there is none instead of pointing at a missing element.
        {...(description ? {} : { 'aria-describedby': undefined })}
        onCloseAutoFocus={event => {
          event.preventDefault()
          const target = returnFocusTo?.() ?? previous.current
          if (target?.isConnected) target.focus({ preventScroll: true })
        }}>
        <header className={styles.dialogHeader}>
          <div>
            <RadixDialog.Title className={styles.dialogTitle}>{title}</RadixDialog.Title>
            {description ? <RadixDialog.Description className={styles.dialogDescription}>{description}</RadixDialog.Description> : null}
          </div>
          <IconButton label="Close" icon={<X size={16} />} size="sm" onClick={onClose} />
        </header>
        <div className={styles.dialogBody}>{children}</div>
        {footer && <footer className={styles.dialogFooter}>{footer}</footer>}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  </RadixDialog.Root>
}

export interface PopoverProps {
  trigger: ReactNode
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  label?: string
}

/** Non-modal panel anchored to a trigger, for small forms and details. */
export function Popover({ trigger, children, open, onOpenChange, align = 'start', side = 'bottom', label }: PopoverProps): ReactElement {
  return <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
    <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
    <RadixPopover.Portal>
      <RadixPopover.Content className={cx(styles.floating, styles.popover)} align={align} side={side} sideOffset={6} collisionPadding={8} aria-label={label}>{children}</RadixPopover.Content>
    </RadixPopover.Portal>
  </RadixPopover.Root>
}

export type MenuEntry =
  | { type?: 'item'; label: string; icon?: ReactNode; shortcut?: string; onSelect: () => void; disabled?: boolean; danger?: boolean }
  | { type: 'check'; label: string; checked: boolean; onSelect: () => void; disabled?: boolean }
  | { type: 'label'; label: string }
  | { type: 'separator' }

export interface MenuProps {
  trigger: ReactNode
  items: MenuEntry[]
  align?: 'start' | 'center' | 'end'
  label?: string
}

/** A dropdown of actions. Keyboard: arrows move, Enter selects, Escape closes, typing jumps. */
export function Menu({ trigger, items, align = 'start', label }: MenuProps): ReactElement {
  return <RadixMenu.Root>
    <RadixMenu.Trigger asChild>{trigger}</RadixMenu.Trigger>
    <RadixMenu.Portal>
      <RadixMenu.Content className={cx(styles.floating, styles.menu)} align={align} sideOffset={6} collisionPadding={8} aria-label={label}>
        {items.map((item, index) => {
          if (item.type === 'separator') return <RadixMenu.Separator key={index} className={styles.menuSeparator} />
          if (item.type === 'label') return <RadixMenu.Label key={index} className={styles.menuLabel}>{item.label}</RadixMenu.Label>
          if (item.type === 'check') return <RadixMenu.CheckboxItem key={index} className={styles.menuItem} checked={item.checked} disabled={item.disabled} onSelect={item.onSelect}>
            {item.label}<RadixMenu.ItemIndicator className={styles.menuCheck}><Check size={14} /></RadixMenu.ItemIndicator>
          </RadixMenu.CheckboxItem>
          return <RadixMenu.Item key={index} className={cx(styles.menuItem, item.danger && styles.danger)} disabled={item.disabled} onSelect={item.onSelect}>
            {item.icon}{item.label}{item.shortcut && <span className={styles.menuShortcut}>{item.shortcut}</span>}
          </RadixMenu.Item>
        })}
      </RadixMenu.Content>
    </RadixMenu.Portal>
  </RadixMenu.Root>
}

/** Wrap the app once so tooltips share their open delay. */
export function TooltipProvider({ children }: { children: ReactNode }): ReactElement {
  return <RadixTooltip.Provider delayDuration={400} skipDelayDuration={200}>{children}</RadixTooltip.Provider>
}

/** A short hint on hover and keyboard focus. Never the only place for information a person needs. */
export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactElement; side?: 'top' | 'right' | 'bottom' | 'left' }): ReactElement {
  return <RadixTooltip.Root>
    <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
    <RadixTooltip.Portal><RadixTooltip.Content className={styles.tooltip} side={side} sideOffset={6} collisionPadding={8}>{content}</RadixTooltip.Content></RadixTooltip.Portal>
  </RadixTooltip.Root>
}
