// Frozen acceptance test for 1.5.2 OxeChat F2 (OXE program oxespace-152-chat, phase F2, Jira OXE-13; v3, CR-F2-1).
// Written by the planner; the executor must not edit it.
// Defect (verified 14/11 on the packaged main ab5d1c8b7, Windows and Linux, en-US and pt-BR): More actions › "Show every
// tool call" turns the mode on, but the item never shows it: role=menuitem, aria-checked=null, no check.
// Cause: ThreadHeader.tsx (~159) passes `checked` to a plain item; MenuActionItem (src/ui/Overlay.tsx) ignores it. Only a
// `type: 'check'` entry renders a menuitemcheckbox with aria-checked (#771 set `checked` without the type).
// Contract (brand answers of 14/11, CR-F2-1):
// - ThreadHeader's More actions › "Show every tool call" is a checkable entry of the shared Menu (`type: 'check'`):
//   role menuitemcheckbox, aria-checked "true" while the transcript is in verbose mode and "false" otherwise; en-US and
//   pt-BR. Choosing it still switches verbose <-> normal (useThreadViewModeStore). The other entries stay menuitem.
// - A checkable item has NO icon: the ListTree icon goes, and the shared Menu's `type: 'check'` entry does not gain an
//   icon. The left column of a check item belongs to the check (RadixMenu.ItemIndicator, the ✓ in var(--accent)): drawn
//   BEFORE the label, only while checked. An unchecked item keeps that column empty (reserve the check's width, e.g. a
//   fixed-size indicator slot, so labels line up); that alignment is the brand's call in review, not measured here.
// - Rebrand (docs/design/brand.md "Scale (1.5.2)": a menu row is a one-line row of 28, text 13, radius 6; BRD-02/OXE-61):
//   the check entry has the same anatomy as its siblings, i.e. the same menu item class on the real render. That class
//   reads min-height var(--row-1) (the code uses --row-1, a row, not a control; this test also accepts var(--control-md),
//   the same 28/32), font-size var(--text-sm), border-radius var(--radius-sm); the check reads var(--accent) and is no
//   longer pushed to the right edge (no `margin-left: auto` on it). The token values are read from
//   src/ui/Overlay.module.css (a SOURCE-TEXT check, marked below: jsdom loads no CSS, as the repo's scale tests do).
//   Radio entries are not part of this change: if they share .menuCheck today, give them their own class so they keep
//   their indicator where it is.
// The e2e e2e/release/verify-oxe-11-13-14.spec.ts › OXE-13 (packaged build, CI/HML) repeats CA-1/CA-2 on the real app.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThreadHeader } from '../../src/components/Threads/ThreadHeader'
import { AnchoredMenu, type MenuEntry } from '../../src/ui'
import { useThreadViewModeStore } from '../../src/store/thread-view-mode.store'
import { changeLanguage } from '../../src/i18n'
import type { ConversationThread } from '../../shared/types/thread'

const thread = { id: 't1', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Fix login', pinned: false, status: 'idle', nativeSessionId: null, createdAt: 1, updatedAt: 1 } as ConversationThread

const LABELS = {
  en: { more: 'More actions', item: 'Show every tool call', rename: 'Rename' },
  'pt-BR': { more: 'Mais ações', item: 'Mostrar cada chamada de ferramenta', rename: 'Renomear' }
} as const

async function openMoreActions(language: 'en' | 'pt-BR'): Promise<HTMLElement> {
  await changeLanguage(language)
  render(<ThreadHeader thread={thread} pending={false} running={false} onCommand={() => {}} onDelegate={() => {}} onPin={() => {}} onTogglePanel={() => {}} />)
  fireEvent.keyDown(screen.getByRole('button', { name: LABELS[language].more }), { key: 'Enter' })
  return screen.findByRole('menu', { name: LABELS[language].more })
}

/** The menu's own check: the item indicator, rendered only while the item is checked. */
const indicator = (item: HTMLElement): Element | null => item.querySelector('[data-state="checked"]')
/** Every drawing in the item that is not the check: an icon. */
const icons = (item: HTMLElement): Element[] => [...item.querySelectorAll('svg')].filter(svg => !svg.closest('[data-state="checked"]'))
/** The text node that holds the label. */
const labelNode = (item: HTMLElement, label: string): Node => {
  const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent?.includes(label)) return node
  throw new Error(`no "${label}" text in the item`)
}
/** The check is drawn before the label: the left column. */
const checkBeforeLabel = (item: HTMLElement, label: string): boolean =>
  Boolean(indicator(item)!.compareDocumentPosition(labelNode(item, label)) & Node.DOCUMENT_POSITION_FOLLOWING)

beforeEach(() => { localStorage.clear(); useThreadViewModeStore.setState({ mode: 'normal' }) })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-13 · "Show every tool call" says that it is on', () => {
  it('CA-1 · with the mode on, the item is a checked menuitemcheckbox with a visible check, in en-US and pt-BR', async () => {
    for (const language of ['en', 'pt-BR'] as const) {
      useThreadViewModeStore.setState({ mode: 'verbose' })
      await openMoreActions(language)
      const item = screen.getByRole('menuitemcheckbox', { name: LABELS[language].item })
      expect(item, language).toHaveAttribute('aria-checked', 'true')
      expect(indicator(item)?.querySelector('svg'), `${language}: the check is drawn`).not.toBeNull()
      expect(checkBeforeLabel(item, LABELS[language].item), `${language}: the check sits in the left column`).toBe(true)
      expect(icons(item), `${language}: a checkable item has no icon`).toHaveLength(0)
      expect(screen.getByRole('menuitem', { name: LABELS[language].rename }), language).toBeInTheDocument()
      await act(async () => { fireEvent.click(item) })
      expect(useThreadViewModeStore.getState().mode, language).toBe('normal')
      cleanup()
    }
  })

  it('CA-2 · with the mode off, the item is a menuitemcheckbox with aria-checked false and no check, in en-US and pt-BR', async () => {
    for (const language of ['en', 'pt-BR'] as const) {
      useThreadViewModeStore.setState({ mode: 'normal' })
      await openMoreActions(language)
      const item = screen.getByRole('menuitemcheckbox', { name: LABELS[language].item })
      expect(item, language).toHaveAttribute('aria-checked', 'false')
      expect(indicator(item), `${language}: no check`).toBeNull()
      expect(item.querySelectorAll('svg'), `${language}: nothing drawn, no icon`).toHaveLength(0)
      expect(screen.queryByRole('menuitem', { name: LABELS[language].item }), language).toBeNull()
      await act(async () => { fireEvent.click(item) })
      expect(useThreadViewModeStore.getState().mode, language).toBe('verbose')
      cleanup()
    }
  })

  it('CA-3 · a checkable entry of the shared Menu is a menuitemcheckbox with the check in the left column and the menu row anatomy; a plain entry stays menuitem', async () => {
    const items: MenuEntry[] = [
      { label: 'Rename', icon: <svg data-testid="icon-rename" />, onSelect: () => {} },
      { type: 'check', label: 'Show every tool call', checked: true, onSelect: () => {} },
      { type: 'check', label: 'Wrap long lines', checked: false, onSelect: () => {} }
    ]
    render(<div><AnchoredMenu open onOpenChange={() => {}} label="More actions" items={items} /></div>)
    const plain = await screen.findByRole('menuitem', { name: 'Rename' })
    const on = screen.getByRole('menuitemcheckbox', { name: 'Show every tool call' })
    const off = screen.getByRole('menuitemcheckbox', { name: 'Wrap long lines' })
    expect(plain.querySelector('[data-testid="icon-rename"]'), 'a plain item keeps its icon').not.toBeNull()
    expect(on).toHaveAttribute('aria-checked', 'true')
    expect(off).toHaveAttribute('aria-checked', 'false')
    expect(indicator(on)?.querySelector('svg')).not.toBeNull()
    expect(indicator(off)).toBeNull()
    expect(checkBeforeLabel(on, 'Show every tool call'), 'the check is drawn before the label').toBe(true)
    expect(icons(on)).toHaveLength(0)
    expect(on.textContent?.trim()).toBe('Show every tool call')
    // Same anatomy as its siblings: the same menu item class (row height, text size and radius come from it).
    expect(on.className).toBe(plain.className)
    expect(off.className).toBe(plain.className)
    // SOURCE-TEXT check (marked): the menu item class reads the 1.5.2 scale tokens; the check reads --accent and is
    // not pushed to the right edge any more.
    const css = readFileSync(join(__dirname, '..', '..', 'src', 'ui', 'Overlay.module.css'), 'utf8')
    const block = (selector: string): string => {
      const start = css.search(new RegExp(`^\\.${selector}\\s*\\{`, 'm'))
      expect(start, `.${selector} exists`).toBeGreaterThanOrEqual(0)
      return css.slice(start, css.indexOf('}', start))
    }
    const row = block('menuItem')
    expect(row).toMatch(/min-height:\s*var\(--(row-1|control-md)\)/)
    expect(row).toMatch(/font-size:\s*var\(--fs-sm\)/)
    expect(row).toMatch(/border-radius:\s*var\(--radius-sm\)/)
    const check = block('menuCheck')
    expect(check).toMatch(/color:\s*var\(--accent\)/)
    expect(check).not.toMatch(/margin-left:\s*auto/)
  })
})
