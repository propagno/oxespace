import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PostEnvironmentView } from '../shared/oxepost/types'
import { ProductionConfirm } from '../src/components/OxePost/ProductionConfirm'
import { productionTarget, SECRET_MASK } from '../src/components/OxePost/productionTarget'

/** P1-10 · the production confirmation shows the address the request really goes to. */

afterEach(cleanup)

const prod = (variables: Record<string, string>, secrets: Record<string, 'set' | 'not set'> = {}): PostEnvironmentView => ({
  id: 'prod', name: 'prod', production: true, variables, secrets: Object.keys(secrets), secretState: secrets
})

describe('production target', () => {
  it('resolves the URL with the environment the way the send does, host apart', () => {
    expect(productionTarget('{{baseUrl}}/danger?x=1', prod({ baseUrl: 'https://api.example.com' })))
      .toEqual({ kind: 'resolved', url: 'https://api.example.com/danger?x=1', origin: 'https://api.example.com', rest: '/danger?x=1', maskedSecrets: [] })
  })

  it('masks secrets and reports what has no value, including a secret that is not set', () => {
    expect(productionTarget('https://{{host}}/x?key={{apiKey}}', prod({ host: 'api.example.com' }, { apiKey: 'set' })))
      .toMatchObject({ kind: 'resolved', url: `https://api.example.com/x?key=${SECRET_MASK}`, maskedSecrets: ['apiKey'] })
    expect(productionTarget('{{baseUrl}}/danger', prod({}))).toEqual({ kind: 'missing', missing: ['baseUrl'] })
    expect(productionTarget('{{baseUrl}}/x?k={{token}}', prod({}, { token: 'not set' }))).toEqual({ kind: 'missing', missing: ['baseUrl', 'token'] })
  })
})

describe('production confirmation', () => {
  it('shows the method and the resolved address with its host, never the raw variable', () => {
    render(<ProductionConfirm method="GET" url="{{baseUrl}}/danger" environment={prod({ baseUrl: 'https://api.example.com' })} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Send to prod?' })
    expect(screen.getByTestId('oxepost-production-host')).toHaveTextContent('https://api.example.com')
    expect(screen.getByTestId('oxepost-production-target')).toHaveTextContent('GET https://api.example.com/danger')
    expect(dialog).not.toHaveTextContent('{{')
    expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
    expect(document.activeElement).toHaveTextContent('Cancel')
  })

  it('says the address is not known when baseUrl is missing, and keeps Send off', () => {
    render(<ProductionConfirm method="GET" url="{{baseUrl}}/danger" environment={prod({})} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Send to prod?' })
    expect(dialog).toHaveTextContent('The address is not known')
    expect(dialog).toHaveTextContent('baseUrl has no value in prod, so the address this would go to is not known.')
    expect(dialog).not.toHaveTextContent('{{')
    expect(screen.queryByTestId('oxepost-production-target')).toBeNull()
    expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  })
})
