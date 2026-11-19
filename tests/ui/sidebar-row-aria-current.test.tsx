// Acceptance test for 1.5.2 (Jira OXE-295, CA-1 to CA-3).
// Contract:
// - CA-1: a selected SidebarRow has aria-current="page" and unselected siblings have no aria-current attribute.
// - CA-2: a selected SidebarGroup has aria-current="page" and unselected siblings have no aria-current attribute.
// - CA-3: the forced-colors stylesheet matches [role='button'][aria-current='page'] with Highlight / HighlightText.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { SidebarGroup, SidebarRow } from '../../src/ui'

afterEach(() => {
  cleanup()
})

describe('OXE-295 · SidebarRow and SidebarGroup aria-current="page"', () => {
  test('the selected row is aria-current page and the others have none', () => {
    const { container } = render(
      <nav aria-label="Items">
        <SidebarRow title="First" selected onSelect={() => undefined} />
        <SidebarRow title="Second" onSelect={() => undefined} />
        <SidebarRow title="Third" onSelect={() => undefined} />
      </nav>
    )

    const rows = [...container.querySelectorAll<HTMLElement>('[data-ui="sidebar-row"]')]
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveAttribute('aria-current', 'page')
    expect(rows[1]).not.toHaveAttribute('aria-current')
    expect(rows[2]).not.toHaveAttribute('aria-current')
  })

  test('a selected group is aria-current page', () => {
    const { container } = render(
      <nav aria-label="Workspaces">
        <SidebarGroup title="Atlas" selected onSelect={() => undefined} />
        <SidebarGroup title="Borealis" onSelect={() => undefined} />
      </nav>
    )

    const groups = [...container.querySelectorAll<HTMLElement>('[data-ui="sidebar-group"]')]
    expect(groups).toHaveLength(2)
    expect(groups[0]).toHaveAttribute('aria-current', 'page')
    expect(groups[1]).not.toHaveAttribute('aria-current')
  })

  test('the forced-colours selection style matches aria-current page', () => {
    const forcedCss = readFileSync(join(process.cwd(), 'src/styles/forced-colors.css'), 'utf8')
    expect(forcedCss).toMatch(/\[role=['"]button['"]\]\[aria-current=['"]page['"]\]/)
    expect(forcedCss).toMatch(/background:\s*Highlight\b/)
    expect(forcedCss).toMatch(/color:\s*HighlightText\b/)
  })
})
