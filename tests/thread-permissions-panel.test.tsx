import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ThreadPermissionsPanel from '../src/components/Threads/ThreadPermissionsPanel'

afterEach(() => { cleanup(); delete (window as { oxe?: unknown }).oxe })

function install(initial: boolean) {
  let value = initial
  const setAutoApproveReads = vi.fn(async (next: boolean) => { value = next; return next })
  ;(window as unknown as { oxe: unknown }).oxe = { thread: {
    permissionRules: async () => [], auditLog: async () => [], addPermissionRule: vi.fn(), removePermissionRule: vi.fn(),
    autoApproveReads: async () => value, setAutoApproveReads
  } }
  return setAutoApproveReads
}

describe('read-only commands switch', () => {
  it('shows the current choice and changes it', async () => {
    const set = install(true)
    render(<ThreadPermissionsPanel threadId="t" />)
    const box = await screen.findByRole('checkbox', { name: 'Approve read-only commands automatically' })
    expect(box).toBeChecked()
    expect(screen.getByText(/reads outside the project, writes a file/)).toBeVisible()
    fireEvent.click(box)
    await waitFor(() => expect(set).toHaveBeenCalledWith(false))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Approve read-only commands automatically' })).not.toBeChecked())
  })

  it('is absent in a build without the setting', async () => {
    ;(window as unknown as { oxe: unknown }).oxe = { thread: { permissionRules: async () => [], auditLog: async () => [] } }
    render(<ThreadPermissionsPanel threadId="t" />)
    await screen.findByText('Rules')
    expect(screen.queryByText('Read-only commands')).toBeNull()
  })
})
