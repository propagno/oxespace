import { expect, it, vi } from 'vitest'
import { ThreadModelService } from '../electron/main/services/conversation/thread-models'
import type { ConversationThread } from '../shared/types/thread'
import type { ConversationTransport } from '../electron/main/services/conversation/codex-conversation'

it('shares discovery, caches by project and closes every native transport', async () => {
  const requests: string[] = [], close = vi.fn(async () => {})
  const spawn = vi.fn((): ConversationTransport => {
    let receive = (_data: Uint8Array) => {}
    return { close, onClose: () => {}, onData: callback => { receive = callback }, write: line => {
      const message = JSON.parse(line)
      requests.push(message.method)
      if (message.id === undefined) return
      queueMicrotask(() => receive(Buffer.from(JSON.stringify({ id: message.id, result: message.method === 'model/list' ? { data: [{ model: 'native', displayName: 'Native', isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] }] } : {} }) + '\n')))
    } }
  })
  const service = new ThreadModelService(() => 'codex', spawn)
  const thread = { provider: 'codex', rootPath: '/one' } as ConversationThread
  const [first, second] = await Promise.all([service.list(thread), service.list(thread, true)])
  expect(first).toEqual(second)
  expect(first).toMatchObject({ defaultModel: 'native', models: [{ id: 'native', efforts: ['low', 'high'] }] })
  await service.list(thread)
  expect(spawn).toHaveBeenCalledTimes(1)
  await service.list({ ...thread, rootPath: '/two' })
  expect(spawn).toHaveBeenCalledTimes(2)
  expect(close).toHaveBeenCalledTimes(2)
  expect(requests).not.toContain('turn/start')
  await service.stop()
  await expect(service.list(thread)).rejects.toThrow('shutting down')
})
