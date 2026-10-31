import { afterEach, describe, expect, it, vi } from 'vitest'
import { OxeQueryCore, cell, redact } from '../../electron/main/services/oxequery/oxequery-core'

const cores: OxeQueryCore[] = []
afterEach(async () => { for (const core of cores.splice(0)) await core.closeAll() })

interface Internals {
  pg: Map<string, { key: string; client: { end(): Promise<void> }; running: boolean; lastUsed: number }>
  mongo: Map<string, { key: string; client: { close(): Promise<void> }; lastUsed: number }>
}

describe('session lifecycle', () => {
  it('closes idle sessions, keeps busy and recent ones, and caps the total', async () => {
    const core = new OxeQueryCore(); cores.push(core)
    const internals = core as unknown as Internals
    const ended: string[] = []
    const session = (id: string, lastUsed: number, running = false) => ({ key: id, running, tx: 'none', lastUsed, client: { end: async () => { ended.push(id) } } })
    const now = 100 * 60_000
    internals.pg.set('idle', session('idle', now - 11 * 60_000))
    internals.pg.set('busy', session('busy', now - 30 * 60_000, true))
    internals.pg.set('recent', session('recent', now - 60_000))
    expect(await core.reapIdle(now)).toBe(1)
    expect(ended).toEqual(['idle'])
    expect([...internals.pg.keys()].sort()).toEqual(['busy', 'recent'])

    for (let index = 0; index < 14; index++) internals.pg.set(`s${index}`, session(`s${index}`, now - 1000 * (20 - index)))
    ended.length = 0
    await core.reapIdle(now)
    expect(internals.pg.size).toBeLessThanOrEqual(12)
    // The least recently used are the ones that go.
    expect(ended).toContain('recent')
    expect(ended.includes('s13')).toBe(false)
    expect(internals.pg.has('busy')).toBe(true)
  })

  it('reaps Mongo sessions too', async () => {
    const core = new OxeQueryCore(); cores.push(core)
    const internals = core as unknown as Internals
    const close = vi.fn(async () => undefined)
    internals.mongo.set('m', { key: 'm', client: { close }, lastUsed: 0 })
    expect(await core.reapIdle(11 * 60_000 + 1)).toBe(1)
    expect(close).toHaveBeenCalled()
  })
})

describe('value and error hygiene', () => {
  it('redacts a password in every form it can appear', () => {
    expect(redact('password authentication failed for "p@ss w0rd!" user', 'p@ss w0rd!')).not.toContain('p@ss w0rd!')
    expect(redact('postgres://u:p%40ss@h/db', 'p@ss')).not.toContain('p%40ss')
    expect(redact('keep this', undefined, 'xx')).toBe('keep this')
  })

  it('makes every database value safe to send to the renderer', () => {
    expect(cell(10n ** 20n)).toBe('100000000000000000000')
    expect(cell(new Date('2026-10-11T00:00:00Z'))).toBe('2026-10-11T00:00:00.000Z')
    expect(cell(Buffer.from('abc'))).toBe('\\x' + '616263')
    expect(cell({ a: [1, 2] })).toBe('{"a":[1,2]}')
    expect(cell(null)).toBeNull()
    const huge = cell('x'.repeat(200_000)) as string
    expect(huge.length).toBeLessThan(70_000)
    expect(huge).toContain('truncated')
  })
})
