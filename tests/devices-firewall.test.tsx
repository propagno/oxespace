import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DevicesFirewall, firewallProblem, type FirewallChange, type FirewallStatus } from '../src/components/Settings/DevicesFirewall'

// 1.4.3 P1: the firewall Notice in Settings › Devices, against the shapes of BACKEND's IPC (#629).
const REPAIR = 'New-NetFirewallRule -DisplayName "OXESpace phone pairing" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 47321 -Profile Private -Program "C:\\Program Files\\OXESpace\\OXESpace.exe"'
const UNDO = 'Remove-NetFirewallRule -DisplayName "OXESpace phone pairing"'
type Checked = Extract<FirewallStatus, { supported: true }>
const base: Checked = {
  supported: true, port: 47321, ruleName: 'OXESpace phone pairing', repairCommand: REPAIR, undoCommand: UNDO, inspectionAvailable: true,
  ruleAllowed: false, blockingRuleDetected: false, ownRulePresent: false, privateFirewallEnabled: true, networkCategory: 'private'
}
const RULE = 'OXESpace.exe, TCP 47321, Private networks only'

function fake(status: FirewallStatus, change: { repair?: FirewallChange; undo?: FirewallChange } = {}, methods = true) {
  const api = {
    firewallStatus: vi.fn(async () => status),
    firewallRepair: vi.fn(async () => change.repair ?? { ok: true as const, status: { ...base, ruleAllowed: true, ownRulePresent: true } }),
    firewallUndo: vi.fn(async () => change.undo ?? { ok: true as const, status: { ...base } })
  }
  ;(window as unknown as { oxe: unknown }).oxe = { remote: methods ? api : {} }
  return api
}

afterEach(() => { cleanup(); delete (window as { oxe?: unknown }).oxe })

describe('1.4.3 P1 · the firewall check', () => {
  it('picks one problem, the most blocking first', () => {
    expect(firewallProblem({ ...base, blockingRuleDetected: true, networkCategory: 'public' })).toBe('blocked')
    expect(firewallProblem({ ...base, networkCategory: 'public' })).toBe('public')
    expect(firewallProblem(base)).toBe('noRule')
    expect(firewallProblem({ ...base, ruleAllowed: true })).toBeNull()
  })

  it('shows nothing while the connection is off, and does not read the firewall', () => {
    const api = fake(base)
    const { container } = render(<DevicesFirewall listening={false} />)
    expect(container).toBeEmptyDOMElement()
    expect(api.firewallStatus).not.toHaveBeenCalled()
  })

  it('shows nothing off Windows or in a development build (supported: false)', async () => {
    const api = fake({ supported: false })
    const { container } = render(<DevicesFirewall listening />)
    await waitFor(() => expect(api.firewallStatus).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('shows nothing on a Domain network: those rules are IT\'s', async () => {
    const api = fake({ ...base, networkCategory: 'domain' })
    const { container } = render(<DevicesFirewall listening />)
    await waitFor(() => expect(api.firewallStatus).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('shows nothing in an app whose preload has no firewall methods', () => {
    fake(base, {}, false)
    const { container } = render(<DevicesFirewall listening />)
    expect(container).toBeEmptyDOMElement()
  })

  it('on a Public network says so, says how to make it Private, and offers no repair', async () => {
    fake({ ...base, networkCategory: 'public' })
    render(<DevicesFirewall listening />)
    const notice = await screen.findByRole('alert')
    expect(notice).toHaveTextContent('This network is Public, so Windows blocks phones')
    expect(notice).toHaveTextContent('set it to Private')
    expect(notice).toHaveTextContent('doesn\'t change it for you')
    expect(within(notice).queryByRole('button', { name: 'Allow on private networks' })).toBeNull()
    // One alert per problem: the missing rule behind the Public network is not a second Notice.
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('names a Block rule it will never remove, and offers no repair', async () => {
    fake({ ...base, blockingRuleDetected: true })
    render(<DevicesFirewall listening />)
    const notice = await screen.findByRole('alert')
    expect(notice).toHaveTextContent('A firewall rule blocks OXESpace')
    expect(notice).toHaveTextContent('ask your IT')
    expect(within(notice).queryByRole('button', { name: 'Allow on private networks' })).toBeNull()
  })

  it('without a rule, Allow shows the exact rule, the Windows prompt and the command before running it', async () => {
    const api = fake(base)
    render(<DevicesFirewall listening />)
    const notice = await screen.findByRole('alert')
    expect(notice).toHaveTextContent('Windows Firewall doesn\'t let phones in yet')
    expect(notice).toHaveTextContent(`Adds one rule: ${RULE}.`)
    await userEvent.click(within(notice).getByRole('button', { name: 'Allow on private networks' }))
    const dialog = await screen.findByRole('dialog', { name: 'Allow phones on private networks?' })
    expect(dialog).toHaveTextContent(RULE)
    expect(dialog).toHaveTextContent('Windows will ask for permission')
    expect(within(dialog).getByTestId('devices-firewall-command')).toHaveTextContent(REPAIR)
    expect(api.firewallRepair).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Allow' }))
    expect(api.firewallRepair).toHaveBeenCalledTimes(1)
    // Verified: the warning goes, and the rule is named with its Undo next to it.
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByTestId('devices-firewall-ok')).toHaveTextContent(RULE)
    expect(screen.getByRole('button', { name: 'Remove the rule' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the warning when the person says No at Windows\' prompt, or when the rule is not verified', async () => {
    const cancelled = fake(base, { repair: { ok: false, reason: 'cancelled' } })
    render(<DevicesFirewall listening />)
    await userEvent.click(await screen.findByRole('button', { name: 'Allow on private networks' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(cancelled.firewallRepair).toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Windows Firewall doesn\'t let phones in yet')
    expect(screen.queryByTestId('devices-firewall-outcome')).toBeNull()
    cleanup()

    // Elevation ran but a fresh read does not confirm the rule: it never reads as fixed.
    fake(base, { repair: { ok: false, reason: 'not-verified', status: { ...base, ownRulePresent: true } } })
    render(<DevicesFirewall listening />)
    await userEvent.click(await screen.findByRole('button', { name: 'Allow on private networks' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const notice = screen.getByRole('alert')
    expect(notice).toHaveTextContent('Windows Firewall doesn\'t let phones in yet')
    expect(within(notice).getByTestId('devices-firewall-outcome')).toHaveTextContent('The rule could not be verified.')
    // The rule OXESpace added exists, so it can be removed even though it doesn't work.
    expect(within(notice).getByRole('button', { name: 'Remove the rule' })).toBeInTheDocument()
    expect(screen.queryByTestId('devices-firewall-ok')).toBeNull()
  })

  it('Remove the rule shows the exact command, then removes only OXESpace\'s rule', async () => {
    const api = fake({ ...base, ruleAllowed: true, ownRulePresent: true })
    render(<DevicesFirewall listening />)
    await userEvent.click(await screen.findByRole('button', { name: 'Remove the rule' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove the firewall rule?' })
    expect(dialog).toHaveTextContent('"OXESpace phone pairing"')
    expect(dialog).toHaveTextContent('Windows will ask for permission')
    expect(within(dialog).getByTestId('devices-firewall-command')).toHaveTextContent(UNDO)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    expect(api.firewallUndo).toHaveBeenCalledTimes(1)
    // Back to no rule: the warning and its Allow come back.
    expect(await screen.findByRole('button', { name: 'Allow on private networks' })).toBeInTheDocument()
  })

  it('reads the firewall again when a pairing code shows', async () => {
    const api = fake({ ...base, ruleAllowed: true })
    const { rerender } = render(<DevicesFirewall listening pairingKey="0" />)
    await waitFor(() => expect(api.firewallStatus).toHaveBeenCalledTimes(1))
    rerender(<DevicesFirewall listening pairingKey="1" />)
    await waitFor(() => expect(api.firewallStatus).toHaveBeenCalledTimes(2))
  })
})
