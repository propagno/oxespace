import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen, within } from '@testing-library/react'
import { PanelsTopLeft } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModeSwitch } from '../../src/components/Navigation/ModeSwitch'
import { SidebarFooterBar } from '../../src/components/Navigation/NavigationChrome'
import { Sidebar } from '../../src/components/Sidebar/Sidebar'
import { useNavigationPrefs } from '../../src/store/navigation-prefs.store'
import { useTerminalStore } from '../../src/store/terminal.store'
import { useUIStore } from '../../src/store/ui.store'
import type { Workspace } from '../../shared/types/workspace'

const ROOT = process.cwd()
const readCss = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OXE-426 · title bar mode switch visual separation', () => {
  it('separates brand/menu bar from ModeSwitch with a divider and wraps ModeSwitch in a pill container', () => {
    const titleBarCss = readCss('src/components/Navigation/TitleBar.module.css')
    const modeSwitchCss = readCss('src/components/Navigation/ModeSwitch.module.css')

    expect(titleBarCss).toMatch(/column-gap\s*:\s*var\(--space-3\)/)
    expect(titleBarCss).toMatch(/border-inline-end\s*:\s*1px\s+solid\s+var\(--bd-default\)/)
    expect(titleBarCss).toMatch(/padding-inline-end\s*:\s*var\(--space-3\)/)

    expect(modeSwitchCss).toMatch(/\.switch\s*\{[^}]*background\s*:\s*var\(--surface-canvas\)/)
    expect(modeSwitchCss).toMatch(/\.switch\s*\{[^}]*border\s*:\s*1px\s+solid\s+var\(--bd-subtle\)/)
    expect(modeSwitchCss).toMatch(/\.switch\s*\{[^}]*border-radius\s*:\s*var\(--radius-md\)/)
    expect(modeSwitchCss).toMatch(/\.option\[data-state='active'\]\s*\{[^}]*background\s*:\s*var\(--fill-selected\)/)

    render(<ModeSwitch mode="code" onSelect={() => undefined} />)
    const list = screen.getByRole('tablist')
    expect(list).toHaveAttribute('data-ui', 'tabs')
    expect(within(list).getAllByRole('tab')).toHaveLength(3)
  })
})

describe('OXE-433 · enlarged sidebar footer icons and unclipped state filter', () => {
  it('renders md IconButtons with 17px icons in SidebarFooterBar and adds comfortable footer spacing', () => {
    const { container } = render(
      <SidebarFooterBar
        context={{ id: 'panels', label: 'Panels', icon: PanelsTopLeft, onClick: vi.fn() }}
        onToggle={vi.fn()}
      />
    )
    const footer = container.querySelector('[data-ui="sidebar-footer"]')!
    expect(footer).not.toBeNull()
    expect(footer.classList.contains('nav-rail-footer')).toBe(true)

    const buttons = within(footer as HTMLElement).getAllByRole('button')
    expect(buttons).toHaveLength(4)
    for (const button of buttons) {
      expect(button).toHaveAttribute('data-ui', 'icon-button')
      expect(button).toHaveAttribute('data-size', 'md')
      const svg = button.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(svg?.getAttribute('width')).toBe('17')
      expect(svg?.getAttribute('height')).toBe('17')
    }

    const chromeCss = readCss('src/components/Navigation/NavigationChrome.css')
    expect(chromeCss).toMatch(/\.nav-rail-footer[^{]*\{[^}]*gap\s*:\s*var\(--space-1-5\)/)
  })

  it('gives state filter segments content-proportional flex sizing, compact padding and non-shrinking counts', () => {
    useNavigationPrefs.setState({ width: 240, expanded: {}, stateFilter: { code: 'all', thread: 'all' } })
    useTerminalStore.setState({ panes: {}, pendingCommands: {}, activePaneId: null } as never)
    useUIStore.setState({ activePaneId: null, collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, code: false } })
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        app: { platform: 'win32' },
        terminal: { start: vi.fn(), stop: vi.fn(async () => undefined) },
        workspace: { closePane: vi.fn(async () => undefined) },
        git: { getBranch: vi.fn(async () => ({ branch: 'main', detached: false, shortSha: null })) }
      }
    })

    const workspaces: Workspace[] = []
    render(
      <Sidebar
        workspaces={workspaces}
        activeWorkspaceId={null}
        appVersion="1.6.1"
        isCollapsed={false}
        onNewWorkspace={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onCloseWorkspace={vi.fn()}
        onToggleCollapse={vi.fn()}
      />
    )

    const group = screen.getByRole('radiogroup', { name: 'Show' })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(3)
    for (const radio of radios) {
      expect(radio.querySelector('.sidebar-state-label')).not.toBeNull()
      expect(radio.querySelector('.sidebar-state-count')).not.toBeNull()
    }
    expect(radios[1]).toHaveTextContent('Needs you 0')

    const codeCss = readCss('src/components/Sidebar/SidebarNavigation.css')
    expect(codeCss).toMatch(/\.sidebar-state-filter\s+\[role="radio"\]\s*\{[^}]*flex\s*:\s*1\s+1\s+auto/)
    expect(codeCss).toMatch(/\.sidebar-state-filter\s+\[role="radio"\]\s*\{[^}]*padding\s*:\s*0\s+var\(--space-1-5\)/)
    expect(codeCss).toMatch(/\.sidebar-state-count\s*\{[^}]*flex-shrink\s*:\s*0/)

    const threadCss = readCss('src/components/Threads/ThreadSidebar.module.css')
    expect(threadCss).toMatch(/\.stateFilter\s+\[role="radio"\]\s*\{[^}]*flex\s*:\s*1\s+1\s+auto/)
    expect(threadCss).toMatch(/\.stateFilter\s+\[role="radio"\]\s*\{[^}]*padding\s*:\s*0\s+var\(--space-1-5\)/)
    expect(threadCss).toMatch(/\.stateCount\s*\{[^}]*flex-shrink\s*:\s*0/)
  })
})
