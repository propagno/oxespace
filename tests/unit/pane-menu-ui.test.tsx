import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PanePhoneMenuItems } from '../../src/components/Grid/PanePhoneWrite'
import { TerminalFocusMenuItems } from '../../src/components/Grid/TerminalFocusMenuItems'
import paneMenu from '../../src/components/Grid/PaneMenu.module.css'
import { useTerminalFocusStore } from '../../src/keyboard/terminalFocus'
import { resetRemoteFollowForTests, useRemoteStore } from '../../src/store/remote.store'

afterEach(() => {
  cleanup()
  resetRemoteFollowForTests()
  useRemoteStore.setState({ status: null })
  useTerminalFocusStore.setState({ tabMovesFocus: {}, toggleKeyToShell: {}, f6ToProgram: {}, entryHinted: {} })
})

describe('OXE-427 · pane ⋯ menu formatting, checkmarks and submenu hierarchy', () => {
  it('uses the same right-aligned Lucide Check icon across TerminalFocusMenuItems and PanePhoneMenuItems without raw Unicode checkmarks', () => {
    useTerminalFocusStore.setState({ tabMovesFocus: { p1: true }, toggleKeyToShell: { p1: true }, f6ToProgram: {} })
    useRemoteStore.setState({
      status: { enabled: true, phoneWritePanes: ['p1'], phoneHiddenPanes: [] } as never
    })
    render(
      <div role="menu">
        <TerminalFocusMenuItems paneId="p1" onDone={() => undefined} />
        <PanePhoneMenuItems paneId="p1" onDone={() => undefined} />
      </div>
    )
    const checkedItems = screen.getAllByRole('menuitemcheckbox').filter(item => item.getAttribute('aria-checked') === 'true')
    expect(checkedItems).toHaveLength(4)
    for (const item of checkedItems) {
      expect(item.textContent ?? '').not.toContain('✓')
      const svgs = item.querySelectorAll('svg')
      expect(svgs.length).toBeGreaterThanOrEqual(2)
      expect(svgs[svgs.length - 1]).toHaveClass(paneMenu.check)
    }
  })

  it('allows multi-line pane menu items to grow from --row-1 and styles submenus with a guide border', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/Grid/PaneMenu.module.css'), 'utf8')
    expect(css).toMatch(/min-height:\s*var\(--row-1\)/)
    expect(css).toMatch(/height:\s*auto/)
    expect(css).toMatch(/\.check\s*\{[^}]*margin-inline-start:\s*auto[^}]*color:\s*var\(--accent\)/s)
    expect(css).toMatch(/\.submenu\s*\{[^}]*border-inline-start:\s*1px solid var\(--bd-subtle\)/s)
  })
})
