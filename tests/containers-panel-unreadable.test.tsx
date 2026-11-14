import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContainersPanel } from '../src/components/Containers/ContainersPanel'

const READY = { ok: true, value: { engine: { state: 'ready', engine: 'docker' }, rows: [{ id: 'c', name: 'shop-db-1', image: 'postgres:16', status: 'running', ports: [], stack: null, upSince: null, isDatabase: false, startedBy: null }] } }

function main(call: (op: string) => Promise<unknown>): ReturnType<typeof vi.fn> {
  const spy = vi.fn(call)
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, oxePod: { call: spy, onEvent: vi.fn(() => () => undefined) } } })
  return spy
}

describe('Containers panel before and without a list', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('says it is loading while main has not answered', async () => {
    let answer: (value: unknown) => void = () => undefined
    main(() => new Promise(resolve => { answer = resolve }))
    render(<ContainersPanel />)
    expect(screen.getByRole('status').textContent).toContain('Loading')
    answer(READY)
    expect(await screen.findByText('shop-db-1')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says the list could not be read, and reads it again on Try again', async () => {
    let fail = true
    const call = main(async () => (fail ? { ok: false, error: { code: 'unavailable' } } : READY))
    render(<ContainersPanel />)
    expect(await screen.findByText("Couldn't read the containers")).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    fail = false
    const before = call.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('shop-db-1')).toBeTruthy()
    expect(call.mock.calls.length).toBeGreaterThan(before)
    expect(screen.queryByText("Couldn't read the containers")).toBeNull()
  })

  it('says the same when the call itself fails', async () => {
    main(async () => { throw new Error('no handler') })
    render(<ContainersPanel />)
    expect(await screen.findByText("Couldn't read the containers")).toBeTruthy()
  })
})
