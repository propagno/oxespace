// Frozen acceptance test for 1.5.0 CR-34 "Show on phone", the desktop side (OXE program, phase F10, task FE-CR34).
// Written by the planner; the executor must not edit it. Copy by DESIGN (08/11).
// Contract (BACKEND BE-CR34, #706 @ 06248896): RemoteGatewayStatus.phoneHiddenPanes: string[] (a pane not in it is shown,
// the default); window.oxe.remote.setPhoneHidden({ paneId, hidden }) → RemoteGatewayStatus. Hiding a pane makes main drop
// it from phoneWritePanes too. src/components/Grid/PanePhoneWrite.tsx exports PanePhoneMenuItems({ paneId, onDone }) (the
// pane ⋯ menu's phone group) and PanePhoneHeaderMark({ paneId }) (the pane header's phone slot), which PaneContainer uses.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'
import { resetRemoteFollowForTests, useRemoteStore } from '../../../src/store/remote.store'

type Status = Record<string, unknown>
type Phone = {
  PanePhoneMenuItems: (props: { paneId: string; onDone: (action: () => void) => void }) => JSX.Element
  PanePhoneHeaderMark: (props: { paneId: string }) => JSX.Element | null
}
const status = (o: Status = {}): Status => ({ enabled: true, phoneWritePanes: [], phoneHiddenPanes: [], ...o })

function mockRemote(initial: Status) {
  let current = initial
  const remote = {
    status: vi.fn(async () => current),
    devices: vi.fn(async () => []),
    onChanged: vi.fn(() => () => undefined),
    onPairingFailed: vi.fn(() => () => undefined),
    setPhoneWrite: vi.fn(async ({ paneId, allowed }: { paneId: string; allowed: boolean }) => {
      const hidden = (current.phoneHiddenPanes as string[]).includes(paneId)
      const write = new Set(current.phoneWritePanes as string[])
      if (allowed && !hidden) write.add(paneId); else write.delete(paneId)
      current = { ...current, phoneWritePanes: [...write] }
      return current
    }),
    setPhoneHidden: vi.fn(async ({ paneId, hidden }: { paneId: string; hidden: boolean }) => {
      const set = new Set(current.phoneHiddenPanes as string[])
      if (hidden) set.add(paneId); else set.delete(paneId)
      current = { ...current, phoneHiddenPanes: [...set].sort(), phoneWritePanes: hidden ? (current.phoneWritePanes as string[]).filter(id => id !== paneId) : current.phoneWritePanes }
      return current
    })
  }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, remote } })
  useRemoteStore.setState({ status: initial as never })
  return remote
}
async function renderMenu() {
  const { PanePhoneMenuItems } = await import('../../../src/components/Grid/PanePhoneWrite') as unknown as Phone
  render(<div role="menu"><PanePhoneMenuItems paneId="p-1" onDone={action => action()} /></div>)
}
async function renderMark() {
  const { PanePhoneHeaderMark } = await import('../../../src/components/Grid/PanePhoneWrite') as unknown as Phone
  return render(<header><PanePhoneHeaderMark paneId="p-1" /></header>)
}
const items = (): string[] => screen.getAllByRole('menuitemcheckbox').map(item => item.textContent?.replace(/[✓]/g, '').trim() ?? '')

afterEach(async () => { cleanup(); vi.restoreAllMocks(); resetRemoteFollowForTests(); useRemoteStore.setState({ status: null }); await changeLanguage('en') })

describe('CR-34 · Show on phone, on the desktop', () => {
  test('Show on phone is a check item just above Allow typing from the phone, on by default, with its hint', async () => {
    mockRemote(status())
    await renderMenu()
    const show = await screen.findByRole('menuitemcheckbox', { name: /Show on phone/ })
    expect(items().map(text => text.replace(/Paired phones can see this terminal\./, '').trim())).toEqual(['Show on phone', 'Allow typing from the phone'])
    expect(show).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Paired phones can see this terminal.')).toBeInTheDocument()
  })

  test('turning Show off asks main to hide the pane, and typing turns off and is disabled with its hint', async () => {
    const remote = mockRemote(status({ phoneWritePanes: ['p-1'] }))
    await renderMenu()
    expect(await screen.findByRole('menuitemcheckbox', { name: /Allow typing from the phone/ })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /Show on phone/ }))
    await waitFor(() => expect(remote.setPhoneHidden).toHaveBeenCalledWith({ paneId: 'p-1', hidden: true }))
    expect(remote.setPhoneWrite).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('menuitemcheckbox', { name: /Show on phone/ })).toHaveAttribute('aria-checked', 'false'))
    const typing = screen.getByRole('menuitemcheckbox', { name: /Allow typing from the phone/ })
    expect(typing).toHaveAttribute('aria-checked', 'false')
    expect(typing.hasAttribute('disabled') || typing.getAttribute('aria-disabled') === 'true').toBe(true)
    expect(screen.getByText('Show it on the phone first.')).toBeInTheDocument()
    await userEvent.click(typing)
    expect(remote.setPhoneWrite).not.toHaveBeenCalled()
  })

  test('turning Show back on asks main to show the pane, and typing can be turned on again', async () => {
    const remote = mockRemote(status({ phoneHiddenPanes: ['p-1'] }))
    await renderMenu()
    const show = await screen.findByRole('menuitemcheckbox', { name: /Show on phone/ })
    expect(show).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(show)
    await waitFor(() => expect(remote.setPhoneHidden).toHaveBeenCalledWith({ paneId: 'p-1', hidden: false }))
    const typing = await screen.findByRole('menuitemcheckbox', { name: /Allow typing from the phone/ })
    await waitFor(() => expect(typing.hasAttribute('disabled') || typing.getAttribute('aria-disabled') === 'true').toBe(false))
    await userEvent.click(typing)
    await waitFor(() => expect(remote.setPhoneWrite).toHaveBeenCalledWith({ paneId: 'p-1', allowed: true }))
  })

  test('the header shows "Hidden from the phone" only while the pane is hidden and the phone connection is on, never with the typing pill', async () => {
    mockRemote(status({ phoneHiddenPanes: ['p-1'] }))
    await renderMark()
    const mark = await screen.findByRole('img', { name: 'Hidden from the phone' })
    expect(mark.closest('[title]')?.getAttribute('title')).toBe('Hidden from the phone')
    expect(screen.queryByTestId('pane-phone-write')).toBeNull()
    cleanup()
    mockRemote(status({ phoneHiddenPanes: ['p-1'], enabled: false }))
    const off = await renderMark()
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(screen.queryByRole('img', { name: 'Hidden from the phone' })).toBeNull()
    expect(off.container.textContent).toBe('')
    cleanup()
    mockRemote(status({ phoneWritePanes: ['p-1'] }))
    await renderMark()
    expect(await screen.findByTestId('pane-phone-write')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Hidden from the phone' })).toBeNull()
  })

  test('the item, its hints and the marker read in pt-BR', async () => {
    await changeLanguage('pt-BR')
    mockRemote(status({ phoneHiddenPanes: ['p-1'] }))
    await renderMenu()
    expect(await screen.findByRole('menuitemcheckbox', { name: /Mostrar no celular/ })).toBeInTheDocument()
    expect(screen.getByText('Mostre no celular primeiro.')).toBeInTheDocument()
    cleanup()
    mockRemote(status())
    await renderMenu()
    expect(await screen.findByText('Celulares pareados podem ver este terminal.')).toBeInTheDocument()
    cleanup()
    mockRemote(status({ phoneHiddenPanes: ['p-1'] }))
    await renderMark()
    expect(await screen.findByRole('img', { name: 'Oculto do celular' })).toBeInTheDocument()
  })
})
