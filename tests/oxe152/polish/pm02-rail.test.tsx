// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-249, PM-02·12, CA-1 and CA-2; brand-approved POLISH-02 #12,
// "the collapsed rail keeps the sidebar's actions that need no room"). Written by the planner; the executor must not edit
// it. Group C: runs after OxeCode F5 is on main (CodeRail.tsx and NavigationChrome.css are F5's).
// Today (main 4b7015c89) the collapsed NavigationRail's footer has the context action, Settings and Expand, but not the
// ThemeButton the expanded SidebarFooter has, and .sidebar-rail-attention (CodeRail's waiting mark) is painted with
// --intent-warning-* instead of --attn-*.
// Contract:
// - NavigationRail's footer holds the theme button: named t('nav.switchToDark') in the light theme (t('nav.switchToLight')
//   in the dark), and clicking it calls the settings store's setAppearance with the other appearance.
// - SOURCE-TEXT check (marked): NavigationChrome.css .sidebar-rail-attention uses var(--attn-bg) and var(--attn-fg) and no
//   --intent-warning token; the rail buttons keep --control-md (the footer button's size).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Plus } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NavigationRail } from '../../../src/components/Navigation/NavigationChrome'
import { useSettingsStore } from '../../../src/store/settings.store'
import { changeLanguage, i18n } from '../../../src/i18n'

const css = readFileSync(join(process.cwd(), 'src/components/Navigation/NavigationChrome.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (selector: string): string => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match => match[1].split(',').map(part => part.trim()).includes(selector)).map(match => match[2]).join(';')
const action = { id: 'new', label: 'New', icon: Plus, onClick: vi.fn() }

beforeEach(async () => { await changeLanguage('en'); delete document.documentElement.dataset.mode })
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete document.documentElement.dataset.mode })

describe('OXE-249 PM-02·12 the collapsed rail keeps the theme button', () => {
  it('the rail footer has the theme button, and it switches the appearance', () => {
    const setAppearance = vi.fn()
    useSettingsStore.setState({ setAppearance } as never)
    const { container } = render(<NavigationRail mode="thread" primary={[action]} context={{ ...action, id: 'ctx', label: 'Context' }} onToggle={vi.fn()} />)
    const footer = container.querySelector('footer')
    expect(footer, 'the rail footer').not.toBeNull()
    const theme = within(footer as HTMLElement).getByRole('button', { name: i18n.t('nav.switchToDark') })
    fireEvent.click(theme)
    expect(setAppearance).toHaveBeenCalledWith('dark')
    expect(screen.getAllByRole('button', { name: i18n.t('nav.switchToDark') })).toHaveLength(1)
  })

  it('.sidebar-rail-attention is painted with --attn-bg and --attn-fg (source text, marked)', () => {
    const body = rule('.sidebar-rail-attention')
    expect(body.length, 'the rule').toBeGreaterThan(0)
    expect(body).toMatch(/background(-color)?\s*:\s*var\(--attn-bg\)/)
    expect(body).toMatch(/(^|[;\s])color\s*:\s*var\(--attn-fg\)/)
    expect(body).not.toMatch(/--intent-warning/)
  })
})
