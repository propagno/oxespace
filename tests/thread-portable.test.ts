import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ThreadPortableService } from '../electron/main/services/conversation/thread-portable'
import { ThreadExportService } from '../electron/main/services/conversation/thread-export.service'
import type { ThreadArtifact, ThreadSnapshot } from '../shared/types/thread'

const fixture = (): ThreadSnapshot => ({
  thread: { id: 'source', workspaceId: 'workspace', projectId: 'project', rootPath: 'C:/private/source', provider: 'codex', title: 'Portable review', pinned: false, status: 'idle', nativeSessionId: 'native-private', createdAt: 1, updatedAt: 2, model: 'gpt-test', access: 'workspace-write' },
  events: [{ type: 'message', id: 'user', role: 'user', text: 'Review this change' }, { type: 'message', id: 'assistant', role: 'assistant', text: 'Done' }, { type: 'completed', status: 'completed' }],
  turns: [{ id: 'user', operationId: 'local-operation', sequence: 1, status: 'completed', configuration: { model: 'gpt-test', access: 'workspace-write' } }]
})

describe('Thread portable package', () => {
  it('preserves historical questions and uncertainty in portable and Markdown exports', () => {
    const snapshot = fixture()
    const message = snapshot.events[1]
    if (message.type !== 'message') throw Error('Missing fixture message')
    message.historicalQuestions = [{ title: 'Which branch?', options: ['Current', 'New'] }]
    const service = new ThreadPortableService()
    expect(service.parse(service.serialize(snapshot, [])).conversation.events[1]).toEqual(message)
    const markdown = new ThreadExportService(() => { throw Error('No artifacts') }).markdown(snapshot)
    expect(markdown).toContain('Recovered questions — answer not confirmed')
    expect(markdown).toContain('Which branch?')
    expect(markdown).toContain('- New')
  })
  it('roundtrips canonical conversation content and artifact evidence without local session identity', () => {
    const content = '--- a/a.ts\n+++ b/a.ts\n', service = new ThreadPortableService()
    const artifact: ThreadArtifact = { id: 'native-patch:hash', content, hash: createHash('sha256').update(content).digest('hex'), bytes: Buffer.byteLength(content), truncated: false, source: 'native-patch' }
    const parsed = service.parse(service.serialize(fixture(), [artifact], 123))
    expect(parsed.conversation).toMatchObject({ title: 'Portable review', provider: 'codex', configuration: { model: 'gpt-test', access: 'workspace-write' }, events: fixture().events })
    expect(parsed.conversation.turns[0]).not.toHaveProperty('operationId')
    expect(parsed.artifacts).toEqual([artifact])
    const raw = JSON.parse(service.serialize(fixture(), [artifact], 123))
    expect(JSON.stringify(raw)).not.toContain('native-private')
    expect(JSON.stringify(raw)).not.toContain('C:/private/source')
  })

  it('rejects tampering, unknown configuration and malformed artifact hashes', () => {
    const service = new ThreadPortableService(), raw = JSON.parse(service.serialize(fixture(), [], 123))
    raw.conversation.title = 'Tampered'
    expect(() => service.parse(JSON.stringify(raw))).toThrow(/checksum mismatch/i)
    const unknown = JSON.parse(service.serialize(fixture(), [], 123))
    unknown.conversation.configuration.rootPath = 'C:/escape'
    expect(() => service.parse(JSON.stringify(unknown))).toThrow(/unknown conversation configuration/i)
    const content = 'diff', artifact = { id: 'evidence', content, hash: '0'.repeat(64), bytes: 4, truncated: false, source: 'native-patch' }
    const badArtifact = JSON.parse(service.serialize(fixture(), [artifact], 123))
    expect(() => service.parse(JSON.stringify(badArtifact))).toThrow(/artifact 0 checksum mismatch/i)
  })
})
