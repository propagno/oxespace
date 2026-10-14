import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'

/**
 * Keyboard model for a tree whose rows are flat `role="treeitem"` elements carrying
 * `aria-level` (and `aria-expanded` on folders), as in the WAI-ARIA tree pattern:
 *
 * - Up / Down move between visible rows, Home / End jump to the first / last.
 * - Right expands a collapsed folder, or moves to its first child when open.
 * - Left collapses an open folder, or moves to the parent row.
 * - Enter and Space keep the row's own activation (rows are buttons).
 * - A row may own one inline control (for example a "reviewed" checkbox) marked with
 *   `data-tree-action`. It is not a tab stop; Right on the row moves to it, Left moves
 *   back, Up / Down leave it for the neighbouring rows, and its own keys (Space) work.
 *
 * Only one row is in the tab order (roving tabindex), so Tab enters and leaves the tree
 * in one step instead of stopping on every file.
 *
 * It works on the DOM rather than on component state so the same hook serves trees whose
 * rows load lazily or mount from nested components.
 */
const ITEM = '[role="treeitem"]'
const ACTION = '[data-tree-action]'

function level(element: Element | undefined): number {
  return Number(element?.getAttribute('aria-level') ?? 1)
}

/** Exported for tests; use `useTreeKeyboard` in components. */
export function handleTreeKeyDown(event: KeyboardEvent<HTMLElement>): void {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const target = event.target as HTMLElement
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ITEM))
  const go = (destination: HTMLElement | null | undefined): void => {
    if (!destination) return
    event.preventDefault()
    destination.focus()
  }
  // An inline control owned by a row: arrows hand focus back to the tree, other keys stay its own.
  if (target.matches(ACTION)) {
    const owner = target.parentElement?.querySelector<HTMLElement>(ITEM) ?? null
    const ownerIndex = owner ? rows.indexOf(owner) : -1
    if (ownerIndex < 0) return
    if (event.key === 'ArrowLeft') go(owner)
    else if (event.key === 'ArrowDown') go(rows[ownerIndex + 1])
    else if (event.key === 'ArrowUp') go(rows[ownerIndex - 1])
    return
  }
  // Any other control inside a row (a menu button) keeps its own keys.
  if (target.getAttribute('role') !== 'treeitem') return
  const row = target
  const index = rows.indexOf(row)
  if (index < 0) return
  const expanded = row.getAttribute('aria-expanded')
  switch (event.key) {
    case 'ArrowDown': go(rows[index + 1]); break
    case 'ArrowUp': go(rows[index - 1]); break
    case 'Home': go(rows[0]); break
    case 'End': go(rows[rows.length - 1]); break
    case 'ArrowRight':
      if (expanded === 'false') {
        event.preventDefault()
        row.click()
      } else if (expanded === 'true' && level(rows[index + 1]) === level(row) + 1) {
        go(rows[index + 1])
      } else if (expanded === null) {
        go(row.parentElement?.querySelector<HTMLElement>(ACTION))
      }
      break
    case 'ArrowLeft':
      if (expanded === 'true') {
        event.preventDefault()
        row.click()
      } else {
        for (let i = index - 1; i >= 0; i--) {
          if (level(rows[i]) < level(row)) { go(rows[i]); break }
        }
      }
      break
    default:
  }
}

/**
 * `ref` is a callback ref on purpose: a tree often mounts after its data arrives, and an
 * effect that read a plain ref once on mount would never attach to it.
 */
export function useTreeKeyboard<T extends HTMLElement>(): { ref: (node: T | null) => void; onKeyDown: (event: KeyboardEvent<HTMLElement>) => void } {
  const [tree, ref] = useState<T | null>(null)

  useEffect(() => {
    if (!tree) return
    let active: HTMLElement | null = null
    const sync = (): void => {
      const rows = Array.from(tree.querySelectorAll<HTMLElement>(ITEM))
      if (rows.length === 0) return
      // The selected row is the natural entry point; otherwise the first row.
      if (!active || !tree.contains(active)) active = rows.find(row => row.getAttribute('aria-selected') === 'true') ?? rows[0]
      for (const row of rows) row.tabIndex = row === active ? 0 : -1
    }
    const onFocusIn = (event: FocusEvent): void => {
      const row = (event.target as HTMLElement).closest<HTMLElement>(ITEM)
      if (row && tree.contains(row)) { active = row; sync() }
    }
    sync()
    // Rows mount when a folder opens or its listing arrives; keep the tab stop valid.
    const observer = new MutationObserver(sync)
    observer.observe(tree, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected'] })
    tree.addEventListener('focusin', onFocusIn)
    return () => {
      observer.disconnect()
      tree.removeEventListener('focusin', onFocusIn)
    }
  }, [tree])

  return { ref, onKeyDown: useCallback(handleTreeKeyDown, []) }
}
