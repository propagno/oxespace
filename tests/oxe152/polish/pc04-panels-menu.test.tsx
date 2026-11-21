// Acceptance tests for OXE-254 (PC-04·8, CA-1 and CA-2): single panels menu trigger in OxeCode, with 14 px icon and WORKBENCH_PANELS shortcut in <Kbd>.
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../../shared/types/workspace'
import { Sidebar } from '../../../src/components/Sidebar/Sidebar'
import { CODE_MENU_PANELS, WORKBENCH_PANELS } from '../../../src/components/Workbench/panelCatalog'
import { WorkbenchPanelMenu } from '../../../src/components/Workbench/WorkbenchPanelMenu'
import { shortcutLabel } from '../../../src/keyboard/keybindings'

afterEach(() => cleanup())

const workspace = {
  id: 'ws-1',
  name: 'demo',
  rootPath: 'C:/dev/demo',
  isActive: true,
  panes: []
} as unknown as Workspace

describe('PC-04·8 · single panels menu trigger with icon and Kbd shortcut (OXE-254)', () => {
  test('OxeCode has one panels menu trigger; the sidebar footer one is gone', () => {
    Object.defineProperty(window, 'oxe', { configurable: true, value: { app: { platform: 'win32' } } })
    // App.tsx no longer passes panelMenu to Sidebar, leaving only WorkspaceSurface's WorkbenchPanelMenu trigger.
    const appSource = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
    expect(appSource).not.toMatch(/\bpanelMenu\s*=/)

    render(
      <Sidebar
        workspaces={[workspace]}
        activeWorkspaceId="ws-1"
        appVersion="1.5.2"
        onNewWorkspace={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onCloseWorkspace={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />
    )
    expect(screen.queryByTestId('btn-open-tools')).toBeNull()
  })

  test('[css] each panels menu item shows its 14 px icon and its WORKBENCH_PANELS shortcut in a Kbd', async () => {
    const user = userEvent.setup()
    const items = CODE_MENU_PANELS.map(id => ({ id, active: id === 'git', onToggle: vi.fn() }))

    render(<WorkbenchPanelMenu items={items} testId="workspace-panels-menu" />)
    await user.click(screen.getByRole('button', { name: 'More panels' }))

    const menu = await screen.findByTestId('workspace-panels-menu')
    for (const id of CODE_MENU_PANELS) {
      const meta = WORKBENCH_PANELS[id]
      const entry = within(menu).getByRole('menuitemcheckbox', { name: meta.label })

      // 14 px icon (separate from the optional check mark inside the check slot)
      const iconSvgs = [...entry.querySelectorAll('svg')].filter(svg => !svg.closest('[data-state="checked"] > span'))
      const icon = iconSvgs.find(svg => svg.getAttribute('width') === '14' && svg.getAttribute('height') === '14')
      expect(icon, `${id} renders a 14 px icon`).toBeTruthy()

      // Shortcut in <Kbd> whenever WORKBENCH_PANELS defines a keybinding
      const kbd = entry.querySelector('kbd')
      if (meta.keybinding) {
        expect(kbd, `${id} shows shortcut in <Kbd>`).not.toBeNull()
        expect(kbd?.textContent).toBe(shortcutLabel(meta.keybinding))
      } else {
        expect(kbd, `${id} has no shortcut`).toBeNull()
      }
    }
  })
})
