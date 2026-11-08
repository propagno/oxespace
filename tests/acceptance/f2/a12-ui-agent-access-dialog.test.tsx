// Frozen acceptance test for 1.5.0 A12 PR 3, the Agent access dialog's behaviour (OXE phase F2). The executor must not
// edit it. Contract: docs/roadmap-1.5/ccr-a12-ui-oxepost-agent-access.md §2–3 (HML-654-1). It renders the dialog and the
// badge against a fake `window.oxe.oxePost.call` with the person-only ops of A12 (#653 §7).
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentAccessBadge, AgentAccessDialog } from '../../../src/components/OxePost/AgentAccessDialog'
import { Toaster } from '../../../src/ui'

type Access = 'off' | 'read' | 'write'
type Row = { collection: string; access: Access; environmentId: string | null; changed: boolean; lastEvent: 'set' | 'confirm' | 'dropped' | null; origins: string[] }
const ENVIRONMENTS = [
  { id: 'staging', name: 'Staging', production: false, variables: {}, secrets: [], secretState: {} },
  { id: 'production', name: 'Production', production: true, variables: {}, secrets: [], secretState: {} }
]
const row = (o: Partial<Row> = {}): Row => ({ collection: 'billing', access: 'off', environmentId: 'staging', changed: false, lastEvent: null, origins: ['https://api.example.com'], ...o })

function fake(initial: Row) {
  let current = initial
  const call = vi.fn(async (op: string, input: Record<string, unknown>) => {
    if (op === 'agentAccessList') return { ok: true, value: { collections: [current], ceilings: { ordinary: 'write', production: 'read' } } }
    if (op === 'agentAccessSet') { current = { ...current, access: input.access as Access, environmentId: (input.environmentId as string | null) ?? current.environmentId, changed: false, lastEvent: 'set' }; return { ok: true, value: current } }
    if (op === 'agentAccessConfirm') { current = { ...current, changed: false, lastEvent: 'confirm' }; return { ok: true, value: current } }
    return { ok: false, error: { code: 'invalid', message: op } }
  })
  ;(window as unknown as { oxe: unknown }).oxe = { oxePost: { call } }
  return call
}
const open = (activeEnvironmentId: string | null = 'staging') =>
  render(<><AgentAccessDialog collection="billing" environments={ENVIRONMENTS as never} activeEnvironmentId={activeEnvironmentId} onClose={vi.fn()} /><Toaster /></>)
const choice = (name: RegExp) => screen.getByRole('radio', { name })

afterEach(() => { cleanup(); delete (window as { oxe?: unknown }).oxe })

describe('A12 PR 3 · the Agent access dialog', () => {
  it('(e) shows what the person agrees to before any choice: "Agents can reach:" and the grant\'s origins', async () => {
    fake(row())
    open()
    expect(await screen.findByText('Agents can reach:')).toBeInTheDocument()
    expect(screen.getByText('https://api.example.com')).toBeInTheDocument()
  })

  it('(a) never preselects a production environment, and in one Read and write is disabled with its reason', async () => {
    fake(row({ environmentId: null }))
    const user = userEvent.setup()
    open('production')
    const select = await screen.findByLabelText('Environment agents use') as HTMLSelectElement
    // HML-654-2: the active environment is production, so it is not chosen for the person.
    expect(select.value).not.toBe('production')
    await user.selectOptions(select, 'production')
    expect(choice(/^Read and write/)).toBeDisabled()
    expect(screen.getByText('Agents can never send changes to a production environment.')).toBeInTheDocument()
  })

  it('(b) widening applies at once with an Undo that puts it back', async () => {
    const call = fake(row())
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('radio', { name: /^Read and write/ }))
    await waitFor(() => expect(call).toHaveBeenCalledWith('agentAccessSet', expect.objectContaining({ collection: 'billing', access: 'write', environmentId: 'staging' })))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(call).toHaveBeenLastCalledWith('agentAccessSet', expect.objectContaining({ collection: 'billing', access: 'off' })))
  })

  it('(c) a changed collection says so, and Confirm access confirms it', async () => {
    const call = fake(row({ access: 'read', changed: true }))
    const user = userEvent.setup()
    open()
    const notice = (await screen.findByText('Changed since you allowed it')).closest('[role="alert"], [role="status"]') as HTMLElement
    expect(notice).not.toBeNull()
    await user.click(within(notice).getByRole('button', { name: 'Confirm access' }))
    await waitFor(() => expect(call).toHaveBeenCalledWith('agentAccessConfirm', expect.objectContaining({ collection: 'billing' })))
  })

  it('(d) access OXESpace dropped shows one Notice and starts at No access', async () => {
    fake(row({ access: 'off', lastEvent: 'dropped' }))
    open()
    expect(await screen.findByText('Access was turned off because this folder was recreated (for example by a branch switch). Allow it again in OxePost.')).toBeInTheDocument()
    expect(choice(/^No access/)).toBeChecked()
  })
})

describe('A12 PR 3 · the badge', () => {
  it('names a paused (changed) access, and draws nothing without access', () => {
    const { container, rerender } = render(<AgentAccessBadge access="read" changed />)
    expect(screen.getByLabelText('Agents: paused — changed since you allowed it')).toBeInTheDocument()
    rerender(<AgentAccessBadge access="write" changed={false} />)
    expect(screen.getByLabelText('Agents: read and write')).toBeInTheDocument()
    rerender(<AgentAccessBadge access="off" changed={false} />)
    expect(container).toBeEmptyDOMElement()
  })
})
