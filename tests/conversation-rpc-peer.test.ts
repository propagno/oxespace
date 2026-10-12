import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentRpcPeer } from '../electron/main/services/conversation/rpc-peer'

afterEach(() => vi.useRealTimers())
describe('conversation RPC connection', () => {
  it('correlates simultaneous requests independently', async () => {
    const write = vi.fn()
    const peer = new AgentRpcPeer(write, vi.fn(), vi.fn())
    const first = peer.request('thread/start', {})
    const second = peer.request('thread/read', {})
    peer.push(Buffer.from('{"id":2,"result":{"id":"B"}}\n{"id":1,"result":{"id":"A"}}\n'))
    expect(await first).toEqual({ id: 'A' })
    expect(await second).toEqual({ id: 'B' })
    peer.close()
  })
  it('routes approvals to the host and never auto accepts', () => {
    const write = vi.fn(), host = vi.fn(), notify = vi.fn()
    const peer = new AgentRpcPeer(write, notify, host)
    peer.push(Buffer.from('{"id":"approval-1","method":"item/fileChange/requestApproval","params":{"threadId":"A"}}\n'))
    expect(host).toHaveBeenCalledOnce()
    expect(write).not.toHaveBeenCalled()
    peer.rejectRequest('approval-1')
    expect(JSON.parse(write.mock.calls[0][0]).error.code).toBe(-32601)
    peer.close()
  })
  it('bounds timeouts and ignores late replies', async () => {
    vi.useFakeTimers()
    const peer = new AgentRpcPeer(vi.fn(), vi.fn(), vi.fn(), 10)
    const request = peer.request('initialize', {})
    const rejected = expect(request).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(10)
    await rejected
    peer.push(Buffer.from('{"id":1,"result":{}}\n'))
    peer.close()
  })
  it('rejects all pending requests on transport loss', async () => {
    const peer = new AgentRpcPeer(vi.fn(), vi.fn(), vi.fn())
    const pending = peer.request('turn/start', {})
    peer.close()
    await expect(pending).rejects.toThrow('closed')
    await expect(peer.request('turn/start', {})).rejects.toThrow('closed')
  })
  it('keeps a generic RPC exception message with a separate sanitized provider diagnostic', async () => {
    const peer = new AgentRpcPeer(vi.fn(), vi.fn(), vi.fn())
    const pending = peer.request('thread/start', {})
    peer.push(Buffer.from('{"id":1,"error":{"code":1,"message":"Account expired. api_key=private-secret","data":{"codexErrorInfo":"unauthorized","accessToken":"hidden-secret"}}}\n'))
    await expect(pending).rejects.toMatchObject({ message: 'Agent rejected the request', failure: { code: 'authentication', detail: 'Account expired. api_key=[redacted]', providerCode: 'unauthorized' } })
    peer.close()
  })
  it('fails pending requests when protocol framing fails', async () => {
    const peer = new AgentRpcPeer(vi.fn(), vi.fn(), vi.fn())
    const pending = peer.request('initialize', {})
    expect(() => peer.push(Buffer.from('malformed\n'))).toThrow('Invalid JSON')
    await expect(pending).rejects.toThrow('Invalid JSON')
  })
})
