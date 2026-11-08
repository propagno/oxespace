// Frozen acceptance test for 1.5.0 A11 in a mode (R18; DESIGN U3.3, OXE program, phase F3, task FE-R18). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f3-design.md (U3.3).
// Contract (BACKEND R18, #695): window.oxe.agentActivity.badge({ connectionId }) → { today, waiting }. The badge is
// AgentActivityBadge({ connectionId }) in src/components/OxeQuery/AgentActivityBadge.tsx, in OxeQuery's top row. It opens
// Settings › Agent activity (useUIStore.openSettingsPage('activity')) with the filter set through useAgentActivityFilter
// (src/store/agent-activity-filter.store.ts), which the Agent activity page reads on open.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'

type Row = Record<string, unknown>
type FilterStore = { useAgentActivityFilter: { getState(): { filter: Row | null; open(filter: Row): void; clear(): void }; setState(state: Row): void } }

function mockActivity(badge: { today: number; waiting: boolean }) {
  const api = {
    badge: vi.fn(async () => badge),
    list: vi.fn(async () => ({ rows: [], cursor: null, failedSources: [] })),
    detail: vi.fn(async () => null)
  }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, agentActivity: api } })
  return api
}
async function renderBadge(connectionId = 'c-shop') {
  const { AgentActivityBadge } = await load<{ AgentActivityBadge: (props: { connectionId: string }) => JSX.Element | null }>('src/components/OxeQuery/AgentActivityBadge')
  return render(<AgentActivityBadge connectionId={connectionId} />)
}

// Modules this task creates load at run time, so a missing one fails its own checks, not the whole file.
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  try { (await load<FilterStore>('src/store/agent-activity-filter.store')).useAgentActivityFilter.getState().clear() } catch { /* not built yet */ }
})

describe("U3.3 · OxeQuery's agent activity badge", () => {
  test('three statements today read "3 agent actions today", asked of main for this connection', async () => {
    const api = mockActivity({ today: 3, waiting: false })
    await renderBadge()
    expect(await screen.findByRole('button', { name: /^3 agent actions today/ })).toBeInTheDocument()
    expect(api.badge).toHaveBeenCalledWith({ connectionId: 'c-shop' })
  })

  test('clicking it opens Agent activity with Databases and this connection selected', async () => {
    mockActivity({ today: 3, waiting: false })
    const { useUIStore } = await import('../../../src/store/ui.store')
    const openSettingsPage = vi.fn()
    useUIStore.setState({ openSettingsPage })
    await renderBadge()
    await userEvent.click(await screen.findByRole('button', { name: /^3 agent actions today/ }))
    expect(openSettingsPage).toHaveBeenCalledWith('activity')
    const { useAgentActivityFilter } = await load<FilterStore>('src/store/agent-activity-filter.store')
    expect(useAgentActivityFilter.getState().filter).toMatchObject({ sources: ['databases'], connection: 'c-shop' })
  })

  test('the Agent activity page opens on the filter the badge set, and asks main for it', async () => {
    const api = mockActivity({ today: 3, waiting: false })
    const { useAgentActivityFilter } = await load<FilterStore>('src/store/agent-activity-filter.store')
    useAgentActivityFilter.getState().open({ sources: ['databases'], connection: 'c-shop' })
    const { AgentActivitySettings } = await import('../../../src/components/Settings/AgentActivitySettings')
    render(<AgentActivitySettings />)
    await waitFor(() => expect(api.list).toHaveBeenCalled())
    expect(api.list.mock.calls[0]?.[0]).toMatchObject({ sources: ['databases'], connection: 'c-shop' })
    expect(screen.getByRole('button', { name: /^Databases/ })).toHaveAttribute('aria-pressed', 'true')
  })

  test('a write waiting for you turns the badge to attention, with the sun', async () => {
    mockActivity({ today: 2, waiting: true })
    await renderBadge()
    const badge = await screen.findByRole('button', { name: /2 agent actions today/ })
    expect(badge).toHaveAttribute('data-tone', 'attn')
    expect(badge.querySelector('[data-icon="sun"]')).not.toBeNull()
  })

  test('no badge when nothing happened today', async () => {
    mockActivity({ today: 0, waiting: false })
    const { container } = await renderBadge()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.queryByRole('button', { name: /agent actions? today/ })).toBeNull()
    expect(container.textContent).toBe('')
  })
})
