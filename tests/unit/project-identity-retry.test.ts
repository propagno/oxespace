import { beforeEach, describe, expect, test, vi } from 'vitest'
import { retryIdentityProbe } from '../../electron/main/services/memory/memory-project.service'
const probe = vi.fn()
beforeEach(() => { probe.mockReset() })
describe('project identity timeout recovery', () => {
  test('retries one killed probe and uses the same git identity', async () => {
    probe.mockRejectedValueOnce({ killed: true }).mockResolvedValueOnce({ stdout: '.git\n' })
    expect(await retryIdentityProbe(probe)).toEqual({ stdout: '.git\n' })
    expect(probe).toHaveBeenCalledTimes(2)
    expect(probe.mock.calls[1]).toEqual(probe.mock.calls[0])
  })
  test('two timeouts fail closed instead of inventing a project identity', async () => {
    probe.mockRejectedValue(Object.assign(new Error('probe timed out'), { killed: true }))
    await expect(retryIdentityProbe(probe)).rejects.toThrow('probe timed out')
    expect(probe).toHaveBeenCalledTimes(2)
  })
  test('permission errors are not retried or treated as another project', async () => {
    probe.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }))
    await expect(retryIdentityProbe(probe)).rejects.toThrow('permission denied')
    expect(probe).toHaveBeenCalledTimes(1)
  })
})
