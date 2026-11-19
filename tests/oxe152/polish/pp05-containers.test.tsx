import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ContainersPanel } from '../../../src/components/Containers/ContainersPanel'
import type { ContainerPanel } from '../../../shared/types/oxepod'

const PANEL: ContainerPanel = {
  engine: { state: 'ready', engine: 'docker' },
  rows: [
    {
      id: 'c-api',
      name: 'shop-api-1',
      image: 'node:22',
      status: 'running',
      stack: 'shop',
      isDatabase: false,
      startedBy: { kind: 'person' }
    },
    {
      id: 'c-db',
      name: 'shop-db-1',
      image: 'postgres:16',
      status: 'running',
      stack: 'shop',
      isDatabase: true,
      startedBy: null
    }
  ]
}

function mockOxePod(panel: ContainerPanel = PANEL) {
  const call = vi.fn(async (op: string) => {
    if (op === 'containers.panel') return { ok: true, value: panel }
    if (op === 'containers.logsStart') return { ok: true, value: { streamId: 's-1' } }
    return { ok: true, value: {} }
  })
  const onEvent = vi.fn(() => () => {})
  Object.assign(window, {
    oxe: {
      ...(window as unknown as { oxe?: object }).oxe,
      oxePod: { call, onEvent }
    }
  })
  return call
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OXE-266 · PP-05.11 ContainersPanel ConfirmDialog and aria-current', () => {
  test('destructive container confirmation uses src/ui ConfirmDialog with focus trap and Escape to close', async () => {
    const call = mockOxePod()
    render(<ContainersPanel />)

    await screen.findByRole('button', { name: 'shop-api-1' })
    await userEvent.click(await screen.findByRole('button', { name: /More actions|⋯/ }))
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Remove container…' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('data-state', 'open')
    expect(document.querySelector('.containers-confirm-overlay')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(call.mock.calls.some(([op]) => op === 'containers.remove')).toBe(false)
  })

  test('selected container row sets aria-current="true" on .containers-row-name button', async () => {
    mockOxePod()
    render(<ContainersPanel />)

    const apiBtn = await screen.findByRole('button', { name: 'shop-api-1' })
    const dbBtn = screen.getByRole('button', { name: 'shop-db-1' })
    expect(apiBtn).toHaveAttribute('aria-current', 'true')
    expect(dbBtn).not.toHaveAttribute('aria-current')

    await userEvent.click(dbBtn)
    expect(dbBtn).toHaveAttribute('aria-current', 'true')
    expect(apiBtn).not.toHaveAttribute('aria-current')

    const css = readFileSync(resolve(process.cwd(), 'src/components/Containers/ContainersPanel.css'), 'utf8')
    expect(css).toMatch(/\.containers-row-name\s*\{[^}]*min-height\s*:\s*var\(--target-min\)/)
    expect(css).not.toContain('.containers-confirm-overlay')
  })
})
