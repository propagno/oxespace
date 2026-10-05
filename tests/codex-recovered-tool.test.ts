import { describe, expect, it } from 'vitest'
import { codexRecoveredTool } from '../electron/main/services/conversation/codex-recovered-tool'

describe('recovered native tool evidence', () => {
  it('requires item evidence and respects nonzero exit codes and refusal', () => {
    const item = { type: 'commandExecution', id: 'cmd', command: 'npm test', aggregatedOutput: 'Test result' }
    expect(codexRecoveredTool(item, 'turn')).toMatchObject({ state: 'unknown' })
    expect(codexRecoveredTool({ ...item, status: 'completed', exitCode: 0 }, 'turn')).toMatchObject({ state: 'completed', exitCode: 0, output: 'Test result' })
    expect(codexRecoveredTool({ ...item, status: 'completed', exitCode: 1 }, 'turn')).toMatchObject({ state: 'failed' })
    expect(codexRecoveredTool({ ...item, status: 'declined' }, 'turn')).toMatchObject({ state: 'failed' })
  })
  it('recovers text results without importing tool arguments or hidden metadata', () => {
    const tool = codexRecoveredTool({ type: 'mcpToolCall', id: 'mcp', server: 'repo', tool: 'read', status: 'completed', arguments: { secret: 'private' }, result: { content: [{ type: 'text', text: 'Public result' }, { type: 'image', data: 'private-image' }], _meta: { secret: 'private' } } }, 'turn')
    expect(tool).toMatchObject({ name: 'mcpToolCall', state: 'completed', detail: 'repo/read', output: 'Public result' })
    expect(JSON.stringify(tool)).not.toContain('private')
    expect(codexRecoveredTool({ type: 'reasoning', id: 'hidden', content: ['private'] }, 'turn')).toBeUndefined()
  })
  it('retains exact bounded patches and provenance, and refuses oversized evidence', () => {
    const item = { type: 'fileChange', id: 'patch', status: 'completed', changes: [{ path: 'old.ts', kind: { type: 'update', move_path: 'new.ts' }, diff: '+code' }] }
    expect(codexRecoveredTool(item, 'turn')).toMatchObject({ files: [{ path: 'new.ts', previousPath: 'old.ts', kind: 'rename', patch: '+code', source: 'native-patch', authorship: 'provider', state: 'completed' }] })
    expect(() => codexRecoveredTool({ ...item, changes: [{ ...item.changes[0], diff: 'x'.repeat(524289) }] }, 'turn')).toThrow('limits')
  })
  it('labels truncated command output explicitly', () => {
    const tool = codexRecoveredTool({ type: 'commandExecution', id: 'cmd', status: 'completed', aggregatedOutput: 'x'.repeat(70000) }, 'turn')!
    expect(tool.output!.length).toBeLessThanOrEqual(65536)
    expect(tool.output).toContain('[Output truncated during recovery]')
  })
})
