import { useRef, type KeyboardEvent, type ReactElement, type ReactNode, type SyntheticEvent } from 'react'
import { Check, X } from 'lucide-react'
import { Dialog as RadixDialog, DropdownMenu as RadixMenu, Popover as RadixPopover, Tooltip as RadixTooltip } from 'radix-ui'
import { i18n } from '../i18n'
import { IconButton } from './Button'
import { cx } from './cx'
import styles from './Overlay.module.css'

/** Floating layers keep clear of the title bar so they never rise over the window controls. */
const CHROME_COLLISION = { top: 44, right: 8, bottom: 8, left: 8 }

export interface DialogProps {
  title: ReactNode
  description?: ReactNode
  onClose: () => void
  children?: ReactNode
  /** Buttons at the bottom; the primary action goes last. */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  /** Element to focus when the dialog closes; defaults to what had focus before it opened. */
  returnFocusTo?: () => HTMLElement | null
  /** Accessible name of the close button. */
  closeLabel?: string
  testId?: string
}

/**
 * Opening focus goes to the dialog itself unless a child already took it (a safe button in a confirmation).
 * The close button is first in tab order, and focusing it would open its tooltip, which then eats the first Escape.
 */
export function focusSurfaceUnlessChosen(event: Event): void {
  const surface = event.currentTarget as HTMLElement | null
  if (surface && !surface.contains(document.activeElement)) { event.preventDefault(); surface.focus({ preventScroll: true }) }
}

/** A modal dialog: title, optional description, body, and footer actions. Escape and the scrim close it. */
export function Dialog({ title, description, onClose, children, footer, size = 'md', className, returnFocusTo, closeLabel = i18n.t('ui.close'), testId }: DialogProps): ReactElement {
  const previous = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  return <RadixDialog.Root open onOpenChange={open => { if (!open) onClose() }}>
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={styles.scrim} />
      <RadixDialog.Content className={cx(styles.dialog, size !== 'md' && styles[size], className)} data-testid={testId}
        // Without a description, tell Radix there is none instead of pointing at a missing element.
        {...(description ? {} : { 'aria-describedby': undefined })}
        onOpenAutoFocus={focusSurfaceUnlessChosen}
        onCloseAutoFocus={event => {
          event.preventDefault()
          const chosen = returnFocusTo?.() ?? previous.current
          // A trigger that disappeared or was disabled meanwhile hands focus to the view's main input.
          const target = chosen?.isConnected && !chosen.hasAttribute('disabled') ? chosen : [...document.querySelectorAll<HTMLElement>('[data-dialog-return]')].at(-1)
          target?.focus({ preventScroll: true })
        }}>
        <header className={styles.dialogHeader}>
          <div>
            <RadixDialog.Title className={styles.dialogTitle}>{title}</RadixDialog.Title>
            {description ? <RadixDialog.Description className={styles.dialogDescription}>{description}</RadixDialog.Description> : null}
          </div>
          <IconButton label={closeLabel} icon={<X size={16} />} size="sm" onClick={onClose} />
        </header>
        {children ? <div className={styles.dialogBody}>{children}</div> : null}
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
  /** Layout for panels with their own header and scroll area (no default padding when set). */
  className?: string
  sideOffset?: number
}

/** Non-modal panel anchored to a trigger, for small forms and details. */
export function Popover({ trigger, children, open, onOpenChange, align = 'start', side = 'bottom', label, className, sideOffset = 6 }: PopoverProps): ReactElement {
  return <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
    <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
    <RadixPopover.Portal>
      <RadixPopover.Content className={cx(styles.floating, !className && styles.popover, className)} align={align} side={side} sideOffset={sideOffset} collisionPadding={CHROME_COLLISION} aria-label={label}>{children}</RadixPopover.Content>
    </RadixPopover.Portal>
  </RadixPopover.Root>
}

export interface MenuRadioOption { value: string; label: string; hint?: string; ariaLabel?: string }

export type MenuEntry =
  /** keepOpen: the menu stays open after the choice (steppers such as text size). */
  | { type?: 'item'; label: string; icon?: ReactNode; shortcut?: string; onSelect: () => void; disabled?: boolean; danger?: boolean; keepOpen?: boolean }
  | { type: 'check'; label: string; checked: boolean; onSelect: () => void; disabled?: boolean }
  /** One choice out of several; the chosen option is checked. */
  | { type: 'radio'; value: string; options: MenuRadioOption[]; onValueChange: (value: string) => void }
  | { type: 'label'; label: ReactNode }
  | { type: 'separator' }

export interface MenuProps {
  trigger: ReactNode
  items: MenuEntry[]
  align?: 'start' | 'center' | 'end'
  label?: string
  testId?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
}

/**
 * A dropdown of actions. Keyboard: arrows move, Enter selects, Escape closes, typing jumps.
 * Not modal: a modal menu marks the rest of the app aria-hidden while its buttons stay focusable
 * (axe aria-hidden-focus). Focus still moves into the menu and returns to the trigger.
 * A click outside, Escape or a choice closes it; focus moved by the app (a terminal starting) does not.
 */
/** The entries of a dropdown menu, shared by Menu and AnchoredMenu. */
function menuItems(items: MenuEntry[]): ReactNode {
  return items.map((item, index) => {
    if (item.type === 'separator') return <RadixMenu.Separator key={index} className={styles.menuSeparator} />
    if (item.type === 'label') return <RadixMenu.Label key={index} className={styles.menuLabel}>{item.label}</RadixMenu.Label>
    if (item.type === 'radio') return <RadixMenu.RadioGroup key={index} value={item.value} onValueChange={item.onValueChange}>
      {item.options.map(option => <RadixMenu.RadioItem key={option.value} value={option.value} className={styles.menuItem} aria-label={option.ariaLabel ?? option.label}>
        <span className={styles.menuRadioText}>{option.label}{option.hint && <small>{option.hint}</small>}</span>
        <RadixMenu.ItemIndicator className={styles.menuCheck}><Check size={14} /></RadixMenu.ItemIndicator>
      </RadixMenu.RadioItem>)}
    </RadixMenu.RadioGroup>
    if (item.type === 'check') return <RadixMenu.CheckboxItem key={index} className={styles.menuItem} checked={item.checked} disabled={item.disabled} onSelect={item.onSelect}>
      {item.label}<RadixMenu.ItemIndicator className={styles.menuCheck}><Check size={14} /></RadixMenu.ItemIndicator>
    </RadixMenu.CheckboxItem>
    return <RadixMenu.Item key={index} className={cx(styles.menuItem, item.danger && styles.danger)} data-danger={item.danger ? 'true' : undefined} disabled={item.disabled} onSelect={event => { if (item.keepOpen) event.preventDefault(); item.onSelect() }}>
      {item.icon}{item.label}{item.shortcut && <span className={styles.menuShortcut}>{item.shortcut}</span>}
    </RadixMenu.Item>
  })
}

export function Menu({ trigger, items, align = 'start', label, testId, side }: MenuProps): ReactElement {
  return <RadixMenu.Root modal={false}>
    <RadixMenu.Trigger asChild>{trigger}</RadixMenu.Trigger>
    <RadixMenu.Portal>
      <RadixMenu.Content className={cx(styles.floating, styles.menu)} align={align} side={side} sideOffset={6} collisionPadding={CHROME_COLLISION} aria-label={label} data-testid={testId}
        onFocusOutside={event => event.preventDefault()}>
        {menuItems(items)}
      </RadixMenu.Content>
    </RadixMenu.Portal>
  </RadixMenu.Root>
}

/**
 * A menu that opens from code, not from a button: a click on a divider or a grip that is not a drag. It hangs from a
 * hidden anchor that the caller places inside the element it belongs to (positioned), because the element itself may
 * not carry aria-expanded (a separator); on close, focus goes back where `returnFocus` says.
 */
export function AnchoredMenu({ open, onOpenChange, label, items, side = 'bottom', returnFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void; label: string; items: MenuEntry[]; side?: 'top' | 'right' | 'bottom' | 'left'; returnFocus?: () => HTMLElement | null
}): ReactElement {
  // The content is portalled to the body, but React still bubbles its events to the element that holds the anchor:
  // a divider would start a drag on a click in the menu, an arrow key would resize, a tree row would open its file.
  const contain = (event: SyntheticEvent): void => { event.stopPropagation() }
  const containKeys = (event: KeyboardEvent<HTMLDivElement>): void => { if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation() }
  return <RadixMenu.Root modal={false} open={open} onOpenChange={onOpenChange}>
    <RadixMenu.Trigger asChild><span className={styles.menuAnchor} aria-hidden="true" tabIndex={-1} /></RadixMenu.Trigger>
    <RadixMenu.Portal>
      <RadixMenu.Content className={cx(styles.floating, styles.menu)} side={side} sideOffset={6} collisionPadding={CHROME_COLLISION} aria-labelledby={undefined} aria-label={label}
        onCloseAutoFocus={event => { const target = returnFocus?.(); if (target) { event.preventDefault(); target.focus() } }}
        onPointerDown={contain} onPointerUp={contain} onMouseDown={contain} onClick={contain} onDoubleClick={contain} onContextMenu={contain} onKeyDown={containKeys}>
        {menuItems(items)}
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
  // A local provider keeps a tooltip working in isolation (tests, portals); the app-level one shares the open delay.
  return <RadixTooltip.Provider delayDuration={400} skipDelayDuration={200}><RadixTooltip.Root>
    {/* Inside a dialog a focus-opened tooltip would take the first Escape away from the dialog, so only hover opens it there. */}
    <RadixTooltip.Trigger asChild onFocus={event => { if (event.currentTarget.closest('[role="dialog"], [role="alertdialog"]')) event.preventDefault() }}>{children}</RadixTooltip.Trigger>
    <RadixTooltip.Portal><RadixTooltip.Content className={styles.tooltip} side={side} sideOffset={6} collisionPadding={8}>{content}</RadixTooltip.Content></RadixTooltip.Portal>
  </RadixTooltip.Root></RadixTooltip.Provider>
}
