import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { approvalCommandPreview } from '../src/components/Threads/ThreadApprovalDetails'
import { ThreadRequestCard } from '../src/components/Threads/ThreadRequestCard'
import type { ThreadRequest } from '../shared/types/thread'

afterEach(cleanup)

describe('Thread command approval', () => {
  const command = '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command \'$path = "docs\\thread-view.md"; $content = Get-Content -LiteralPath $path -Raw; $needle = "line one\\r\\nline two"; Set-Content -LiteralPath $path -Value $content\''

  it('separates an understandable preview from the exact command', () => {
    const display = approvalCommandPreview(command)
    expect(display).toMatchObject({ runner: 'PowerShell 7', target: 'docs/thread-view.md', writesFiles: true })
    expect(display.preview).toContain('line one\nline two')
    expect(display.preview).toContain(';\n$content')
  })

  it('keeps the exact approval request available while showing its target and reason', () => {
    const request: ThreadRequest = { id: 'request-1', nativeId: '1', nativeMethod: 'item/commandExecution/requestApproval', kind: 'approval', title: 'Approve command', detail: command, command, cwd: 'C:\\project', reason: 'Update the Thread guide', generation: 1, createdAt: Date.now(), state: 'pending' }
    const respond = vi.fn(async () => {})
    render(<ThreadRequestCard request={request} disabled={false} onRespond={respond} />)
    expect(screen.getByText('This command may modify docs/thread-view.md.')).toBeVisible()
    expect(screen.getByText('Agent reason: Update the Thread guide')).toBeVisible()
    expect(screen.getByText(/PowerShell 7 · C:/)).toBeVisible()
    expect(screen.getByText('Readable preview')).toBeVisible()
    expect(screen.getByText(/Exact command or request/).closest('details')).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText(/Exact command or request/))
    expect(screen.getByText(command)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(respond).toHaveBeenCalledWith({ decision: 'accept' })
  })
})
