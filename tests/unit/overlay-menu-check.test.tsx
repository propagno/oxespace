// Frozen acceptance test for 1.5.2 OxeChat F2 (OXE program oxespace-152-chat, phase F2, Jira OXE-13).
// Written by the planner; the executor must not edit it.
// Defect (verified 14/11 on the packaged main ab5d1c8b7, Windows and Linux, en-US and pt-BR): More actions › "Show every
// tool call" turns the mode on, but the item never shows it: role=menuitem, aria-checked=null, no check.
// Cause: ThreadHeader.tsx (~159) passes `checked` to a plain item; MenuActionItem (src/ui/Overlay.tsx) ignores it. Only a
// `type: 'check'` entry renders a menuitemcheckbox with aria-checked (#771 set `checked` without the type).
// Contract:
// - ThreadHeader's More actions › "Show every tool call" is a checkable entry of the shared Menu (`type: 'check'`):
//   role menuitemcheckbox, aria-checked "true" while the transcript is in verbose mode and "false" otherwise, with the
//   menu's own check (RadixMenu.ItemIndicator) drawn only when on; en-US and pt-BR. Choosing it still switches
//   verbose <-> normal (useThreadViewModeStore). The other More actions entries stay menuitem.
// - The shared Menu (src/ui/Overlay.tsx): a `type: 'check'` entry renders as menuitemcheckbox with aria-checked, and a
//   plain entry stays menuitem. A check entry may now carry an optional `icon`, drawn before its label as a plain item
//   draws its own, so the More actions item keeps its ListTree icon next to the other items' icons.
// - Rebrand (docs/design/brand.md "Scale (1.5.2)": a menu row is a one-line row of 28, text 13, radius 6; BRD-02/OXE-61
//   menus of the OxeChat sidebar and header): the check entry has the same anatomy as its siblings, i.e. the same menu
//   item class on the real render, and that class reads min-height var(--control-md) or var(--row-1) (28; 32
//   comfortable), font-size var(--text-sm) (13), border-radius var(--radius-sm) (6); the check is drawn in
//   var(--accent), a token of both themes. The token values are read from src/ui/Overlay.module.css (a SOURCE-TEXT
//   check, marked below: jsdom loads no CSS, so this is how the repo's scale tests read the primitives).
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

/** The menu's own check mark: the item indicator, rendered only while the item is checked. */
const checkMark = (item: HTMLElement): Element | null => item.querySelector('[data-state="checked"] svg')

beforeEach(() => { localStorage.clear(); useThreadViewModeStore.setState({ mode: 'normal' }) })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-13 · "Show every tool call" says that it is on', () => {
  it('CA-1 · with the mode on, the item is a checked menuitemcheckbox with a visible check, in en-US and pt-BR', async () => {
    for (const language of ['en', 'pt-BR'] as const) {
      useThreadViewModeStore.setState({ mode: 'verbose' })
      await openMoreActions(language)
      const item = screen.getByRole('menuitemcheckbox', { name: LABELS[language].item })
      expect(item, language).toHaveAttribute('aria-checked', 'true')
      expect(checkMark(item), `${language}: the check is drawn`).not.toBeNull()
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
      expect(checkMark(item), `${language}: no check`).toBeNull()
      expect(screen.queryByRole('menuitem', { name: LABELS[language].item }), language).toBeNull()
      await act(async () => { fireEvent.click(item) })
      expect(useThreadViewModeStore.getState().mode, language).toBe('verbose')
      cleanup()
    }
  })

  it('CA-3 · a checkable entry of the shared Menu is a menuitemcheckbox with its icon and the menu row anatomy; a plain entry stays menuitem', async () => {
    const items = [
      { label: 'Rename', icon: <svg data-testid="icon-rename" />, onSelect: () => {} },
      { type: 'check', label: 'Show every tool call', icon: <svg data-testid="icon-tools" />, checked: true, onSelect: () => {} },
      { type: 'check', label: 'Wrap long lines', checked: false, onSelect: () => {} }
    ] as unknown as MenuEntry[]
    render(<div><AnchoredMenu open onOpenChange={() => {}} label="More actions" items={items} /></div>)
    const plain = await screen.findByRole('menuitem', { name: 'Rename' })
    const on = screen.getByRole('menuitemcheckbox', { name: 'Show every tool call' })
    const off = screen.getByRole('menuitemcheckbox', { name: 'Wrap long lines' })
    expect(on).toHaveAttribute('aria-checked', 'true')
    expect(off).toHaveAttribute('aria-checked', 'false')
    expect(checkMark(on)).not.toBeNull()
    expect(checkMark(off)).toBeNull()
    // The icon is drawn before the label, as on a plain item.
    const icon = on.querySelector('[data-testid="icon-tools"]')
    expect(icon, 'the check entry keeps its icon').not.toBeNull()
    expect(on.textContent?.trim()).toBe('Show every tool call')
    expect(icon!.compareDocumentPosition(on.querySelector('[data-state="checked"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Same anatomy as its siblings: the same menu item class (row height, text size and radius come from it).
    expect(on.className).toBe(plain.className)
    expect(off.className).toBe(plain.className)
    // SOURCE-TEXT check (marked): the menu item class reads the 1.5.2 scale tokens, the check reads --accent.
    const css = readFileSync(join(__dirname, '..', '..', 'src', 'ui', 'Overlay.module.css'), 'utf8')
    const block = (selector: string): string => {
      const start = css.search(new RegExp(`^\\.${selector}\\s*\\{`, 'm'))
      expect(start, `.${selector} exists`).toBeGreaterThanOrEqual(0)
      return css.slice(start, css.indexOf('}', start))
    }
    const row = block('menuItem')
    expect(row).toMatch(/min-height:\s*var\(--(control-md|row-1)\)/)
    expect(row).toMatch(/font-size:\s*var\(--text-sm\)/)
    expect(row).toMatch(/border-radius:\s*var\(--radius-sm\)/)
    expect(block('menuCheck')).toMatch(/color:\s*var\(--accent\)/)
  })
})
