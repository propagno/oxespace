import { describe, expect, it } from 'vitest'
import { waitForInternalMcp, type InternalMcpMeta } from '../../electron/main/mcp-internal/ready'

/** HML (T53 spec, Linux CI): the first conversation sent while the internal MCP was still starting failed at once. */
describe('a conversation waits for the internal MCP', () => {
  const meta: InternalMcpMeta = { port: 4321, token: 't' }
  const clock = () => {
    let now = 0
    return { sleep: async (ms: number) => { now += ms }, now: () => now }
  }

  it('answers at once when it is already up, without waiting', async () => {
    const time = clock()
    expect(await waitForInternalMcp(() => meta, { sleep: time.sleep })).toEqual(meta)
    expect(time.now()).toBe(0)
  })

  it('waits while it starts, and goes on as soon as its port and token are written', async () => {
    const time = clock()
    const read = () => time.now() >= 3_000 ? meta : undefined
    expect(await waitForInternalMcp(read, { sleep: time.sleep })).toEqual(meta)
    expect(time.now()).toBe(3_000)
  })

  it('gives up after its bound, so a server that never comes up still fails', async () => {
    const time = clock()
    expect(await waitForInternalMcp(() => undefined, { sleep: time.sleep, timeoutMs: 20_000 })).toBeUndefined()
    expect(time.now()).toBe(20_000)
  })
})
