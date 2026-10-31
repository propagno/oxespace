import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'

/**
 * Keyboard model for a flat list of rows (conversations, workspaces), derived from
 * useTreeKeyboard:
 *
 * - Up / Down and j / k move between rows, Home / End jump to the first / last.
 * - Enter activates a row that is not a native button (buttons already do).
 * - A row may own inline controls marked `data-list-action` (open side by side, a menu).
 *   They are not tab stops: Right moves to the next one, Left back towards the row,
 *   Up / Down leave them for the neighbouring rows.
 *
 * Rows are marked `data-list-item`. Only one row is in the tab order (roving tabindex):
 * the current one (`aria-current` or `aria-selected`) or the first, so Tab enters and
 * leaves the list in one step. It reads the DOM, so rows that mount later still count.
 */
export const LIST_ITEM = '[data-list-item]'
export const LIST_ACTION = '[data-list-action]'

const isCurrent = (row: Element): boolean => {
  const current = row.getAttribute('aria-current')
  return (current !== null && current !== 'false') || row.getAttribute('aria-selected') === 'true'
}

/** The row an element belongs to: the item itself, or the item that shares its row container. */
function ownerRow(element: HTMLElement, rows: HTMLElement[]): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const owner = rows.find(row => node!.contains(row))
    if (owner) return owner
  }
  return null
}

const enabled = (element: HTMLElement): boolean => !element.hasAttribute('disabled')

/** Exported for tests; use `useListKeyboard` in components. */
export function handleListKeyDown(event: KeyboardEvent<HTMLElement>): void {
  if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return
  const target = event.target as HTMLElement
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(LIST_ITEM))
  const go = (destination: HTMLElement | null | undefined): void => {
    if (!destination) return
    event.preventDefault()
    destination.focus()
  }
  const key = event.shiftKey ? '' : event.key === 'j' ? 'ArrowDown' : event.key === 'k' ? 'ArrowUp' : event.key

  if (target.matches(LIST_ACTION)) {
    const owner = ownerRow(target, rows)
    const index = owner ? rows.indexOf(owner) : -1
    if (index < 0) return
    const actions = rowActions(owner!)
    const at = actions.indexOf(target)
    if (key === 'ArrowLeft') go(at > 0 ? actions[at - 1] : owner)
    else if (key === 'ArrowRight') go(actions[at + 1])
    else if (key === 'ArrowDown') go(rows[index + 1])
    else if (key === 'ArrowUp') go(rows[index - 1])
    return
  }
  // Text fields, menus and other controls inside the list keep their keys.
  if (!target.matches(LIST_ITEM)) return
  const index = rows.indexOf(target)
  if (index < 0) return
  switch (key) {
    case 'ArrowDown': go(rows[index + 1]); break
    case 'ArrowUp': go(rows[index - 1]); break
    case 'Home': go(rows[0]); break
    case 'End': go(rows[rows.length - 1]); break
    case 'ArrowRight': go(rowActions(target)[0]); break
    case 'Enter':
      if (!(target instanceof HTMLButtonElement)) { event.preventDefault(); target.click() }
      break
    default:
  }
}

/** The inline controls of a row: those in the nearest container that holds the row and no other row. */
function rowActions(row: HTMLElement): HTMLElement[] {
  for (let node = row.parentElement; node; node = node.parentElement) {
    if (node.querySelectorAll(LIST_ITEM).length > 1) return []
    const actions = Array.from(node.querySelectorAll<HTMLElement>(LIST_ACTION)).filter(enabled)
    if (actions.length) return actions
  }
  return []
}

/**
 * `ref` is a callback ref: lists often mount after their data arrives, and an effect that
 * read a plain ref once on mount would never attach to them.
 */
export function useListKeyboard<T extends HTMLElement>(): { ref: (node: T | null) => void; onKeyDown: (event: KeyboardEvent<HTMLElement>) => void } {
  const [list, ref] = useState<T | null>(null)

  useEffect(() => {
    if (!list) return
    let active: HTMLElement | null = null
    // Writes the attribute only when it changes, so the observer below does not loop.
    const setTabIndex = (element: HTMLElement, value: '0' | '-1'): void => { if (element.getAttribute('tabindex') !== value) element.setAttribute('tabindex', value) }
    const sync = (): void => {
      const rows = Array.from(list.querySelectorAll<HTMLElement>(LIST_ITEM))
      for (const action of list.querySelectorAll<HTMLElement>(LIST_ACTION)) setTabIndex(action, '-1')
      if (rows.length === 0) return
      // While focus is elsewhere, the tab stop follows the current row (selected from a shortcut, the palette, a click).
      const current = list.contains(document.activeElement) ? undefined : rows.find(isCurrent)
      if (current) active = current
      else if (!active || !list.contains(active)) active = rows.find(isCurrent) ?? rows[0]
      for (const row of rows) setTabIndex(row, row === active ? '0' : '-1')
    }
    const onFocusIn = (event: FocusEvent): void => {
      const row = (event.target as HTMLElement).closest<HTMLElement>(LIST_ITEM)
      if (row && list.contains(row)) { active = row; sync() }
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current', 'aria-selected'] })
    list.addEventListener('focusin', onFocusIn)
    return () => {
      observer.disconnect()
      list.removeEventListener('focusin', onFocusIn)
    }
  }, [list])

  return { ref, onKeyDown: useCallback(handleListKeyDown, []) }
}
