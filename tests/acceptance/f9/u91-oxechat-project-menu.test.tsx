// Frozen acceptance test for 1.5.0 A32 on screen (DESIGN U9.1c, OXE program, phase F9, task FE-A32). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f9-design.md (U9.1).
// Window only. OxeChat's project menu is 1.4.1's without Team (removed in F2): Project settings, New section…, Open in
// OxeCode, Remove project…. It renders the real ThreadSidebar over the real thread store. The rest of U9.1 (both sidebars
// and New workspace as 1.4.1, scenario 3) is HML's fidelity e2e.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

const PROJECT = { projectId: 'p-shop', displayName: 'shop', identityLabel: '/repo/shop', hidden: false, contexts: [{ rootPath: '/repo/shop', label: 'shop' }] }
async function openProjectMenu() {
  const deep = (): unknown => new Proxy(async () => undefined, { get: (_target, key) => key === 'then' ? undefined : deep() })
  Object.assign(window, { oxe: deep() })
  const { useThreadStore } = await import('../../../src/store/thread.store')
  act(() => useThreadStore.setState({ projects: [PROJECT] as never, threads: [], unavailableProjects: [], hiddenProjects: [] }))
  const { ThreadSidebar } = await import('../../../src/components/Threads/ThreadSidebar')
  const Sidebar = ThreadSidebar as unknown as (props: Record<string, unknown>) => JSX.Element
  // Every handler a caller may pass, Team's included: the menu must not offer it whatever the caller wires.
  render(<Sidebar onCreate={vi.fn()} onAccounts={vi.fn()} onAddProject={vi.fn()} onOpenInCode={vi.fn(async () => undefined)} onOpenTeam={vi.fn()} />)
  const trigger = await waitFor(() => { const found = document.querySelector<HTMLElement>('[data-project-actions="p-shop"]'); if (!found) throw new Error('no project menu yet'); return found }, { timeout: 10_000 })
  await userEvent.click(trigger)
  return screen.findByRole('menu')
}

afterEach(async () => { cleanup(); await changeLanguage('en') })

describe("U9.1 · OxeChat's project menu", () => {
  test('the project menu is Project settings, New section…, Open in OxeCode and Remove project…, with no Team', async () => {
    const menu = await openProjectMenu()
    const items = within(menu).getAllByRole('menuitem').map(item => item.textContent?.trim())
    expect(items).toEqual(['Project settings', 'New section…', 'Open in OxeCode', 'Remove project…'])
    expect(items.join(' ')).not.toMatch(/Team/)
  }, 30_000)

  test('in pt-BR the project menu has no Equipe either', async () => {
    await changeLanguage('pt-BR')
    const menu = await openProjectMenu()
    expect(within(menu).getAllByRole('menuitem').map(item => item.textContent?.trim()).join(' ')).not.toMatch(/Equipe/)
  }, 30_000)
})
