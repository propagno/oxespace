import { useCallback, useEffect, useRef, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { Command as Cmdk } from 'cmdk'
import { Search } from 'lucide-react'
import { Dialog as RadixDialog } from 'radix-ui'
import styles from './CommandPalette.module.css'

/**
 * The command palette: a search field over grouped results, with cmdk for
 * filtering and keyboard behavior. Item parts take `commandStyles.label`,
 * `.detail` and `.trailing`.
 */
export function CommandDialog({ open, onOpenChange, children, title = 'Command palette', description = 'Search for a command, file or workspace', shouldFilter, onCloseAutoFocus }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  title?: string
  description?: string
  shouldFilter?: boolean
  onCloseAutoFocus?: (event: Event) => void
}): ReactElement {
  // Opened from the keyboard there is no trigger to return to: remember where focus was and put it back on close,
  // so a screen reader reads that control again instead of the page from the top.
  const previous = useRef<HTMLElement | null>(null)
  const content = useRef<HTMLDivElement | null>(null)
  // Radix calls this before it moves focus into the dialog, so the active element is still the one to return to.
  const remember = (): void => { previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }
  const returnFocus = (event: Event): void => {
    onCloseAutoFocus?.(event)
    const target = previous.current
    previous.current = null
    if (event.defaultPrevented || !target?.isConnected) return
    event.preventDefault()
    // A command may have opened something that took focus already (a panel, a dialog): leave it there.
    const active = document.activeElement
    if (active && active !== document.body && !content.current?.contains(active)) return
    target.focus()
  }
  return <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={styles.scrim} />
      <RadixDialog.Content ref={content} className={styles.content} onOpenAutoFocus={remember} onCloseAutoFocus={returnFocus}>
        <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
        <RadixDialog.Description className="sr-only">{description}</RadixDialog.Description>
        <Cmdk className={styles.command} shouldFilter={shouldFilter}>{children}</Cmdk>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  </RadixDialog.Root>
}

export function CommandInput(props: ComponentProps<typeof Cmdk.Input>): ReactElement {
  return <div className={styles.inputWrap}><Search size={16} aria-hidden="true" /><Cmdk.Input className={styles.input} {...props} /></div>
}

export function CommandList({ children }: { children: ReactNode }): ReactElement {
  const element = useRef<HTMLDivElement | null>(null)
  // Radix's scroll lock cancels wheel events on portaled content; scroll the list directly.
  useEffect(() => {
    const list = element.current
    if (!list) return
    const onWheel = (event: WheelEvent): void => {
      if (list.scrollHeight <= list.clientHeight) return
      event.preventDefault()
      list.scrollTop += event.deltaY
    }
    list.addEventListener('wheel', onWheel, { passive: false })
    return () => list.removeEventListener('wheel', onWheel)
  }, [])
  const ref = useCallback((node: HTMLDivElement | null) => { element.current = node }, [])
  return <Cmdk.List ref={ref} className={styles.list}>{children}</Cmdk.List>
}

export function CommandEmpty({ children }: { children: ReactNode }): ReactElement {
  return <Cmdk.Empty className={styles.empty}>{children}</Cmdk.Empty>
}

export function CommandGroup({ heading, children }: { heading: ReactNode; children: ReactNode }): ReactElement {
  return <Cmdk.Group heading={heading} className={styles.group}>{children}</Cmdk.Group>
}

export function CommandItem(props: ComponentProps<typeof Cmdk.Item>): ReactElement {
  return <Cmdk.Item className={styles.item} {...props} />
}

export { styles as commandStyles }
