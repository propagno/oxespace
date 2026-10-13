// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parsePermissionRuleInput } from '../../electron/main/services/conversation/thread-permissions'

describe('parsePermissionRuleInput (what thread.addPermissionRule accepts from the renderer)', () => {
  it('accepts command, path and MCP tool rules', () => {
    for (const kind of ['command', 'path', 'tool'] as const) {
      expect(parsePermissionRuleInput({ kind, pattern: 'x', decision: 'allow', scope: 'project' })).toEqual({ kind, pattern: 'x', decision: 'allow', scope: 'project' })
    }
  })

  it('refuses unknown kinds, decisions, scopes and non-objects', () => {
    expect(() => parsePermissionRuleInput({ kind: 'shell', pattern: 'x', decision: 'allow', scope: 'project' })).toThrow(/kind/)
    expect(() => parsePermissionRuleInput({ kind: 'tool', pattern: 'x', decision: 'maybe', scope: 'project' })).toThrow(/decision/)
    expect(() => parsePermissionRuleInput({ kind: 'tool', pattern: 'x', decision: 'allow', scope: 'team' })).toThrow(/scope/)
    expect(() => parsePermissionRuleInput({ kind: 'tool', pattern: 7, decision: 'allow', scope: 'global' })).toThrow(/pattern/)
    expect(() => parsePermissionRuleInput(null)).toThrow()
    expect(() => parsePermissionRuleInput([])).toThrow()
  })
})
