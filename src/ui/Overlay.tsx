import { useEffect, useId, useRef, type KeyboardEvent, type ReactElement, type ReactNode, type SyntheticEvent } from 'react'
import { Check, ChevronRight, X } from 'lucide-react'
import { Dialog as RadixDialog, DropdownMenu as RadixMenu, Popover as RadixPopover, Tooltip as RadixTooltip } from 'radix-ui'
import { i18n } from '../i18n'
import { Button, IconButton } from './Button'
import { cx } from './cx'
import styles from './Overlay.module.css'

/** Floating layers keep clear of the title bar so they never rise over the window controls. */
const CHROME_COLLISION = { top: 44, right: 8, bottom: 8, left: 8 }

/** The dialog's main action, at the end of the footer (U1). */
export interface DialogPrimaryAction {
  label: string
  onClick: () => void
  /** Destructive, or widens what an agent may do: the danger button. */
  danger?: boolean
  disabled?: boolean
  loading?: boolean
}

/**
 * The footer contract (U1, X1): `extra` at the start (Test, Copy, a link), then Cancel, then the primary or danger
 * action at the end. Cancel is always there, always secondary, and says "Cancel" unless a dialog has a reason to differ.
 */
export interface DialogActions {
  primary?: DialogPrimaryAction
  /** Cancel's words and what it does; defaults to "Cancel" and closing the dialog. */
  cancel?: {
    label?: string
    onClick?: () => void
    disabled?: boolean
    /** Start on Cancel even when the body has a field (a confirmation: the safe choice comes first). */
    focus?: boolean
    /** Cancel can't act right now (the action is running): it keeps focus and says so, rather than being disabled. */
    unavailable?: boolean
  }
  extra?: ReactNode
}

export interface DialogProps {
  title: ReactNode
  description?: ReactNode
  onClose: () => void
  children?: ReactNode
  /**
   * Hand-built footer, kept for the dialogs U5a/U5b/U5c have not migrated yet. New dialogs use `actions`, which
   * fixes the order and the focus rule.
   */
  footer?: ReactNode
  /** The footer slots (U1): extra · Cancel · primary. Enter in a single-line field runs the primary. */
  actions?: DialogActions
  /** Required (U1): every dialog says how wide it is. sm 420 px, md 560 px, lg 760 px, xl 1040 px. */
  size: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  /** Element to focus when the dialog closes; defaults to what had focus before it opened. */
  returnFocusTo?: () => HTMLElement | null
  /** Accessible name of the close button. */
  closeLabel?: string
  testId?: string
  /** Called before Escape closes the dialog; preventDefault keeps it open (e.g. an Escape typed somewhere else). */
  onEscapeKeyDown?: (event: globalThis.KeyboardEvent) => void
}

const FIELD = 'input:not([type="hidden"]), select, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"]'
const usable = (element: HTMLElement): boolean => !element.matches(':disabled, [aria-disabled="true"], [readonly], [tabindex="-1"]') && !element.closest('[hidden], [inert], [aria-hidden="true"]')

/**
 * Where a dialog starts (D-01, one rule for every dialog): what a child already focused (a safe button in a
 * confirmation, an autoFocus field), else the first field of the body, else the safe action (Cancel, when the footer
 * uses the U1 slots), else the first button of the footer, and only when it has none, the dialog itself. Never the
 * close button: it is first in tab order, and focusing it would open its tooltip, which then eats the first Escape.
 */
export function focusSurfaceUnlessChosen(event: Event): void {
  const surface = event.currentTarget as HTMLElement | null
  if (!surface || surface.contains(document.activeElement)) return
  event.preventDefault()
  const field = [...surface.querySelectorAll<HTMLElement>(`[data-dialog-body] :is(${FIELD})`)].find(usable)
  const safe = [...surface.querySelectorAll<HTMLElement>('[data-dialog-footer] [data-dialog-cancel]')].find(usable)
  const action = [...surface.querySelectorAll<HTMLElement>('[data-dialog-footer] :is(button, a[href])')].find(usable)
  ;(field ?? safe ?? action ?? surface).focus({ preventScroll: true })
}

/**
 * Enter in a single-line field runs the primary (U1). Not in a text area, not while an input method composes, not
 * with a modifier, and not when the field handles Enter itself (an open combobox, a field that called preventDefault).
 */
function submitsOnEnter(event: KeyboardEvent<HTMLElement>): boolean {
  if (event.key !== 'Enter' || event.defaultPrevented || event.nativeEvent.isComposing || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false
  const target = event.target as HTMLElement
  if (!(target instanceof HTMLInputElement) || ['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'color', 'range'].includes(target.type)) return false
  return target.getAttribute('aria-expanded') !== 'true'
}

function DialogFooter({ actions, onClose }: { actions: DialogActions; onClose: () => void }): ReactElement {
  const { primary, cancel, extra } = actions
  return <footer className={styles.dialogFooter} data-dialog-footer="">
    {extra ? <div className={styles.dialogExtra} data-align="start">{extra}</div> : null}
    <Button variant="secondary" data-dialog-cancel="" autoFocus={cancel?.focus} disabled={cancel?.disabled} aria-disabled={cancel?.unavailable || undefined}
      onClick={cancel?.unavailable ? undefined : cancel?.onClick ?? onClose}>{cancel?.label ?? i18n.t('ui.cancel')}</Button>
    {primary ? <Button variant={primary.danger ? 'danger' : 'primary'} data-dialog-primary="" loading={primary.loading} disabled={primary.disabled || primary.loading} onClick={primary.onClick}>{primary.label}</Button> : null}
  </footer>
}

/**
 * Where a dialog gives focus back: what had it when the dialog opened, or, when that was an item of a menu (which is
 * gone once the menu closes), the button that opened the menu (WAI-ARIA dialog pattern). Radix links a menu to its
 * trigger with aria-labelledby.
 */
function focusOrigin(active: Element | null): HTMLElement | null {
  if (!(active instanceof HTMLElement)) return null
  const triggerId = active.closest('[role="menu"]')?.getAttribute('aria-labelledby')
  const trigger = triggerId ? document.getElementById(triggerId) : null
  return trigger ?? active
}

/** A modal dialog: title, optional description, body, and footer actions. Escape and the scrim close it. */
export function Dialog({ title, description, onClose, children, footer, actions, size, className, returnFocusTo, closeLabel = i18n.t('ui.close'), testId, onEscapeKeyDown }: DialogProps): ReactElement {
  const previous = useRef(focusOrigin(document.activeElement))
  return <RadixDialog.Root open onOpenChange={open => { if (!open) onClose() }}>
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={styles.scrim} />
      <RadixDialog.Content className={cx(styles.dialog, size !== 'md' && styles[size], className)} data-testid={testId}
        // Without a description, tell Radix there is none instead of pointing at a missing element.
        {...(description ? {} : { 'aria-describedby': undefined })}
        onOpenAutoFocus={focusSurfaceUnlessChosen}
        onEscapeKeyDown={onEscapeKeyDown}
        onCloseAutoFocus={event => {
          event.preventDefault()
          // Another dialog already took focus (the next approval replaced this one): leave it there, or a key typed
          // into that dialog would land in the view behind it.
          if (document.activeElement?.closest('[role="dialog"], [role="alertdialog"]')) return
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
        {children ? <div className={styles.dialogBody} data-dialog-body=""
          onKeyDown={actions?.primary ? event => {
            const primary = actions.primary!
            if (!submitsOnEnter(event) || primary.disabled || primary.loading) return
            event.preventDefault()
            primary.onClick()
          } : undefined}>{children}</div> : null}
        {actions ? <DialogFooter actions={actions} onClose={onClose} /> : footer && <footer className={styles.dialogFooter} data-dialog-footer="">{footer}</footer>}
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
  /** hint: a second, quieter line under the label that says what the choice does (U7). */
  | { type?: 'item'; label: string; hint?: string; icon?: ReactNode; shortcut?: string; onSelect: () => void; disabled?: boolean; danger?: boolean; keepOpen?: boolean }
  | { type: 'check'; label: string; checked: boolean; onSelect: () => void; disabled?: boolean }
  /** One choice out of several; the chosen option is checked. */
  | { type: 'radio'; value: string; options: MenuRadioOption[]; onValueChange: (value: string) => void }
  | { type: 'label'; label: ReactNode }
  | { type: 'separator' }
  /** A nested menu: Right or Enter opens it, Left closes it. Keep to one level. */
  | { type: 'submenu'; label: string; icon?: ReactNode; items: MenuEntry[]; disabled?: boolean; testId?: string }

/**
 * A destructive item stands apart (G-08/P-01): a separator goes before the first danger item of a run when the entry
 * above it is not already a separator or a label.
 */
export function withDangerSeparators(items: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = []
  items.forEach((item, index) => {
    const before = out.at(-1)
    const danger = (entry: MenuEntry | undefined): boolean => Boolean(entry && (entry.type === undefined || entry.type === 'item') && entry.danger)
    if (index > 0 && danger(item) && !danger(before) && before?.type !== 'separator' && before?.type !== 'label') out.push({ type: 'separator' })
    out.push(item)
  })
  return out
}

const isDanger = (entry: MenuEntry): boolean => (entry.type === undefined || entry.type === 'item') && Boolean(entry.danger)

/**
 * The menu order rule (U7): destructive items go last, after exactly one separator, each group keeping its own order.
 * A menu without destructive items is returned unchanged.
 */
export function orderMenuEntries(items: MenuEntry[]): MenuEntry[] {
  const danger = items.filter(isDanger)
  if (danger.length === 0) return items
  // Separators left leading, doubled or trailing in the safe group collapse into the one before the danger group.
  const safe: MenuEntry[] = []
  for (const entry of items.filter(item => !isDanger(item))) {
    if (entry.type === 'separator' && (safe.length === 0 || safe.at(-1)?.type === 'separator')) continue
    safe.push(entry)
  }
  while (safe.at(-1)?.type === 'separator') safe.pop()
  // A group heading whose items all moved to the danger group heads nothing now: drop it (CR-01).
  const headed = safe.filter((entry, index) => {
    if (entry.type !== 'label') return true
    const next = safe[index + 1]
    return next !== undefined && next.type !== 'label' && next.type !== 'separator'
  })
  while (headed.at(-1)?.type === 'separator') headed.pop()
  return headed.length > 0 ? [...headed, { type: 'separator' }, ...danger] : danger
}

/** The entries of a dropdown menu, shared by Menu and AnchoredMenu; every menu follows the U7 order. */
function menuEntries(entries: MenuEntry[]): ReactNode {
  const items = withDangerSeparators(orderMenuEntries(entries))
  return items.map((item, index) => {
    if (item.type === 'separator') return <RadixMenu.Separator key={index} className={styles.menuSeparator} />
    if (item.type === 'label') return <RadixMenu.Label key={index} className={styles.menuLabel}>{item.label}</RadixMenu.Label>
    if (item.type === 'submenu') return <RadixMenu.Sub key={index}>
      <RadixMenu.SubTrigger className={styles.menuItem} disabled={item.disabled}>{item.icon}{item.label}<ChevronRight size={14} className={styles.menuSubChevron} aria-hidden="true" /></RadixMenu.SubTrigger>
      <RadixMenu.Portal>
        <RadixMenu.SubContent className={cx(styles.floating, styles.menu)} sideOffset={4} collisionPadding={CHROME_COLLISION} data-testid={item.testId} onFocusOutside={event => event.preventDefault()}>{menuEntries(item.items)}</RadixMenu.SubContent>
      </RadixMenu.Portal>
    </RadixMenu.Sub>
    if (item.type === 'radio') return <RadixMenu.RadioGroup key={index} value={item.value} onValueChange={item.onValueChange}>
      {item.options.map(option => <RadixMenu.RadioItem key={option.value} value={option.value} className={styles.menuItem} aria-label={option.ariaLabel ?? option.label}>
        <span className={styles.menuRadioText}>{option.label}{option.hint && <small>{option.hint}</small>}</span>
        <RadixMenu.ItemIndicator className={styles.menuCheck}><Check size={14} /></RadixMenu.ItemIndicator>
      </RadixMenu.RadioItem>)}
    </RadixMenu.RadioGroup>
    if (item.type === 'check') return <RadixMenu.CheckboxItem key={index} className={styles.menuItem} checked={item.checked} disabled={item.disabled} onSelect={item.onSelect}>
      {item.label}<RadixMenu.ItemIndicator className={styles.menuCheck}><Check size={14} /></RadixMenu.ItemIndicator>
    </RadixMenu.CheckboxItem>
    return <MenuActionItem key={index} item={item} />
  })
}

type MenuActionEntry = Extract<MenuEntry, { onSelect: () => void; label: string }> & { type?: 'item' }

/**
 * An action item. With a hint (U7), the label stays the accessible name, the hint is the item's description
 * (aria-describedby) and typing ahead matches the label only (textValue) (CR-01).
 */
function MenuActionItem({ item }: { item: MenuActionEntry }): ReactElement {
  const hintId = useId()
  return <RadixMenu.Item className={cx(styles.menuItem, item.danger && styles.danger)} data-danger={item.danger ? 'true' : undefined} disabled={item.disabled}
    textValue={item.hint ? item.label : undefined} aria-describedby={item.hint ? hintId : undefined}
    onSelect={event => { if (item.keepOpen) event.preventDefault(); item.onSelect() }}>
    {item.icon}{item.hint ? <span className={styles.menuHintText}><span>{item.label}</span><small id={hintId} aria-hidden="true">{item.hint}</small></span> : item.label}{item.shortcut && <span className={styles.menuShortcut}>{item.shortcut}</span>}
  </RadixMenu.Item>
}

export interface MenuProps {
  trigger: ReactNode
  items: MenuEntry[]
  align?: 'start' | 'center' | 'end'
  label?: string
  testId?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Controlled open state, for opening the same menu from elsewhere (a row's context menu). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * A dropdown of actions. Keyboard: arrows move, Enter selects, Escape closes, typing jumps.
 * Not modal: a modal menu marks the rest of the app aria-hidden while its buttons stay focusable
 * (axe aria-hidden-focus). Focus still moves into the menu and returns to the trigger.
 * A click outside, Escape or a choice closes it; focus moved by the app (a terminal starting) does not.
 */
/** Focus is on something other than the page or a menu: a dialog or a field an item just opened took it. */
function focusMovedOn(): boolean {
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body && !active.closest('[role="menu"]')
}

export function Menu({ trigger, items, align = 'start', label, testId, side, open, onOpenChange }: MenuProps): ReactElement {
  return <RadixMenu.Root modal={false} open={open} onOpenChange={onOpenChange}>
    <RadixMenu.Trigger asChild>{trigger}</RadixMenu.Trigger>
    <RadixMenu.Portal>
      <RadixMenu.Content className={cx(styles.floating, styles.menu)} align={align} side={side} sideOffset={6} collisionPadding={CHROME_COLLISION} aria-label={label} data-testid={testId}
        onFocusOutside={event => event.preventDefault()}
        // An item that opened a dialog already moved focus there: closing must not pull it back to the trigger.
        onCloseAutoFocus={event => { if (focusMovedOn()) event.preventDefault() }}>
        {menuEntries(items)}
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
  const content = useRef<HTMLDivElement>(null)
  // The menu is opened from code, so the keyboard lands on its first item, the way a menu opened by a key does.
  const focusFirstItem = (): void => { requestAnimationFrame(() => content.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([data-disabled])')?.focus()) }
  // (DropdownMenu.Content takes no onOpenAutoFocus: the first item is focused once the menu is open.)
  useEffect(() => { if (open) focusFirstItem() }, [open])
  return <RadixMenu.Root modal={false} open={open} onOpenChange={onOpenChange}>
    <RadixMenu.Trigger asChild><span className={styles.menuAnchor} aria-hidden="true" tabIndex={-1} /></RadixMenu.Trigger>
    <RadixMenu.Portal>
      <RadixMenu.Content ref={content} className={cx(styles.floating, styles.menu)} side={side} sideOffset={6} collisionPadding={CHROME_COLLISION} aria-labelledby={undefined} aria-label={label}
        onCloseAutoFocus={event => { const target = returnFocus?.(); if (target) { event.preventDefault(); target.focus() } }}
        // Focus landing on the element a menu belongs to (its owner: a divider, a grip, a tree row, whichever element
        // `returnFocus` names) is not "outside". A menu reopened right after a close receives the earlier close's
        // focus hand-back a moment later; that must not dismiss it (a Windows CI race), and the keyboard goes back to
        // the first item, so the menu stays walkable instead of standing open with focus on the owner.
        onFocusOutside={event => { const owner = returnFocus?.(); if (owner && event.target instanceof Node && owner.contains(event.target)) { event.preventDefault(); focusFirstItem() } }}
        onPointerDown={contain} onPointerUp={contain} onMouseDown={contain} onClick={contain} onDoubleClick={contain} onContextMenu={contain} onKeyDown={containKeys}>
        {menuEntries(returnFocus ? items.map(item => withOwnerFocus(item, returnFocus)) : items)}
      </RadixMenu.Content>
    </RadixMenu.Portal>
  </RadixMenu.Root>
}

/**
 * An AnchoredMenu item that runs with focus already back on the menu's owner. A dialog it opens then gives focus back
 * there when it closes (focusOrigin), not to the body: by the time the dialog mounts, the menu is gone and has not yet
 * handed focus back (FRONTEND #312).
 */
function withOwnerFocus(item: MenuEntry, owner: () => HTMLElement | null): MenuEntry {
  if (item.type !== undefined && item.type !== 'item') return item
  const plain = item as Extract<MenuEntry, { onSelect: () => void }>
  // An item that keeps the menu open (a splitter's Smaller/Larger) keeps the keyboard in the menu too.
  if ('keepOpen' in plain && plain.keepOpen) return item
  return { ...plain, onSelect: () => { owner()?.focus({ preventScroll: true }); plain.onSelect() } }
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
