import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadRequestCard } from '../src/components/Threads/ThreadRequestCard'
import type { ThreadRequest } from '../shared/types/thread'

afterEach(cleanup)

const request = (schema: Record<string, unknown>): ThreadRequest => ({ id: 'e', nativeId: 'e', nativeMethod: 'mcpServer/elicitation/request', kind: 'elicitation', title: 'deploy-server', detail: 'Choose a target', generation: 1, createdAt: 1, state: 'pending', schema })

describe('MCP elicitation form', () => {
  it('fills defaults, offers titled choices and several selections, and sends typed values', async () => {
    const respond = vi.fn(async () => {})
    render(<ThreadRequestCard request={request({ type: 'object', required: ['env'], properties: {
      env: { type: 'string', title: 'Environment', oneOf: [{ const: 'stg', title: 'Staging' }, { const: 'prod', title: 'Production' }], default: 'stg' },
      regions: { type: 'array', title: 'Regions', items: { enum: ['eu', 'us'] } },
      replicas: { type: 'integer', title: 'Replicas', minimum: 1, maximum: 5 },
      dry: { type: 'boolean', title: 'Dry run', default: true }
    } })} disabled={false} onRespond={respond} />)
    expect(screen.getByRole('combobox')).toHaveValue('stg')
    expect(screen.getByRole('option', { name: 'Production' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'eu' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'us' }))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(respond).toHaveBeenCalledWith({ decision: 'accept', content: { env: 'stg', regions: ['eu', 'us'], replicas: 3, dry: true } }))
  })

  it('holds the answer back and says why when a value is not allowed', async () => {
    const respond = vi.fn(async () => {})
    render(<ThreadRequestCard request={request({ type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email', title: 'Email' }, replicas: { type: 'integer', title: 'Replicas', maximum: 5 } } })} disabled={false} onRespond={respond} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('This field is required')).toBeVisible()
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'nobody' } })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Enter a valid email address')).toBeVisible()
    expect(screen.getByText('Maximum is 5')).toBeVisible()
    expect(respond).not.toHaveBeenCalled()
  })

  it('with nothing to fill in it is a yes or no, with the words of an approval (CHAT-15)', async () => {
    // What Codex sends before it runs a tool of an MCP server: a question and no fields.
    const respond = vi.fn(async () => {})
    const ask: ThreadRequest = { id: 'm', nativeId: 'm', nativeMethod: 'mcpServer/elicitation/request', kind: 'elicitation', title: 'oxespace-delegation', detail: 'Allow the oxespace-delegation MCP server to run tool "oxespace_git"?', generation: 1, createdAt: 1, state: 'pending' }
    render(<ThreadRequestCard request={ask} disabled={false} onRespond={respond} />)
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(respond).toHaveBeenCalledWith({ decision: 'accept', content: {} }))
  })

  it('a form keeps Continue and Decline', () => {
    render(<ThreadRequestCard request={request({ type: 'object', properties: { env: { type: 'string', title: 'Environment' } } })} disabled={false} onRespond={vi.fn(async () => {})} />)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeVisible()
  })
})
