// Frozen acceptance test for 1.5.2 OxeCode A7 (OXE program oxespace-152-code, phase F2; reported by the user on 13/11:
// "os contextos das conversas estão mostrando tudo igual, sendo que cada sessão é individualizada").
// Written by the planner; the executor must not edit it.
// Cause: the terminal footer's "context left" chip is read and stored per (provider, workspace root), so every Claude
// pane of a workspace shows the newest session of that folder. Main's reader already takes a session id, and main
// already knows each pane's agent session (electron/main/services/agent-state/pane-sessions.ts PaneAgentSessions.current).
// Contract:
// - ContextUsageInput (shared/types/contextUsage.ts) gains `paneId?: string`.
// - registerContextUsageIpc(service, sessionOf?) takes `sessionOf(paneId, provider) => string | null`. With a paneId it
//   reads THAT pane's session; when the pane has no known session of that provider it answers `available: false`
//   (nothing shown) instead of another session's figure. Without a paneId it behaves as before.
// - ContextUsageStatus takes `paneId` and the store keeps one reading per pane.
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, value: unknown) => unknown>()
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (event: unknown, value: unknown) => unknown) => { handlers.set(channel, handler) } } }))

import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { changeLanguage } from '../../../src/i18n'
import { useContextUsageStore } from '../../../src/store/contextUsage.store'

type Chip = { provider: string; available: boolean; usedTokens: number; limitTokens: number; usedPct: number; modelId: string | null; error: string | null }
const chip = (usedPct: number): Chip => ({ provider: 'claude', available: true, usedTokens: usedPct * 2000, limitTokens: 200_000, usedPct, modelId: 'claude-opus-5-5', error: null })

describe('A7 · main reads the context of the pane\'s own session', () => {
  beforeEach(() => { handlers.clear() })

  test('with a paneId, the reader gets that pane\'s session id', async () => {
    const { registerContextUsageIpc } = await import('../../../electron/main/ipc/contextUsage.ipc')
    const service = { get: vi.fn(async () => chip(50)) }
    const sessionOf = vi.fn((paneId: string) => (paneId === 'p1' ? 'aaaaaaaa-1111-2222-3333-444444444444' : null))
    ;(registerContextUsageIpc as unknown as (s: unknown, f: unknown) => void)(service, sessionOf)
    const handler = handlers.get(IPC_CHANNELS.contextUsage.get)!
    await handler({}, { provider: 'claude', workspaceRootPath: 'C:/repo', paneId: 'p1' })
    expect(service.get).toHaveBeenCalledWith('claude', 'C:/repo', 'aaaaaaaa-1111-2222-3333-444444444444')
  })

  test('a pane with no known session shows nothing, never another session\'s figure', async () => {
    const { registerContextUsageIpc } = await import('../../../electron/main/ipc/contextUsage.ipc')
    const service = { get: vi.fn(async () => chip(50)) }
    ;(registerContextUsageIpc as unknown as (s: unknown, f: unknown) => void)(service, () => null)
    const result = await handlers.get(IPC_CHANNELS.contextUsage.get)!({}, { provider: 'claude', workspaceRootPath: 'C:/repo', paneId: 'p9' }) as Chip
    expect(result.available).toBe(false)
    expect(service.get).not.toHaveBeenCalled()
  })

  test('without a paneId it reads as before', async () => {
    const { registerContextUsageIpc } = await import('../../../electron/main/ipc/contextUsage.ipc')
    const service = { get: vi.fn(async () => chip(50)) }
    ;(registerContextUsageIpc as unknown as (s: unknown, f: unknown) => void)(service, () => 'never-used')
    await handlers.get(IPC_CHANNELS.contextUsage.get)!({}, { provider: 'claude', workspaceRootPath: 'C:/repo' })
    expect(service.get).toHaveBeenCalledWith('claude', 'C:/repo', undefined)
  })
})

describe('A7 · each pane shows its own context left', () => {
  beforeEach(async () => {
    await changeLanguage('en')
    useContextUsageStore.setState({ byKey: {}, loading: {} } as never)
    const get = vi.fn(async (input: { paneId?: string }) => chip(input.paneId === 'p1' ? 90 : 40))
    Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, contextUsage: { get } } })
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  test('two panes of the same workspace and provider show different figures', async () => {
    const { ContextUsageStatus } = await import('../../../src/components/Terminal/ContextUsageStatus')
    const Status = ContextUsageStatus as unknown as (props: { provider: 'claude'; rootPath: string; paneId: string }) => JSX.Element | null
    await act(async () => {
      render(<><div data-testid="pane-1"><Status provider="claude" rootPath="C:/repo" paneId="p1" /></div><div data-testid="pane-2"><Status provider="claude" rootPath="C:/repo" paneId="p2" /></div></>)
    })
    await vi.waitFor(() => {
      expect(screen.getByTestId('pane-1').textContent).toMatch(/\b10%/)
      expect(screen.getByTestId('pane-2').textContent).toMatch(/\b60%/)
    })
  })
})
