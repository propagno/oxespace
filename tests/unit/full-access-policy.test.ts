import { describe, expect, it } from 'vitest'
import { evaluatePermission, fullAccessPolicy } from '../../electron/main/services/conversation/kernel/permission-policy'

const unanalysable = String.raw`R=/repo/src; find $R \( -path '*models*' -o -path '*schemas*' \) -type f | sed "s|$R||" | head -100`

describe('Full access', () => {
  it('answers a command Claude Code asks about even in bypass mode', () => {
    const asked = evaluatePermission({ kind: 'approval', command: unanalysable }, '/repo', [])
    expect(asked.decision).toBe('ask')
    expect(fullAccessPolicy({ kind: 'approval', toolName: 'Bash' }, asked, 'full-access')).toMatchObject({ decision: 'allow', reasons: expect.arrayContaining(['Full access: run without asking.']) })
    expect(fullAccessPolicy({ kind: 'approval', toolName: 'Edit' }, undefined, 'full-access')).toMatchObject({ decision: 'allow' })
  })

  it('keeps asking at the other access levels', () => {
    const asked = evaluatePermission({ kind: 'approval', command: unanalysable }, '/repo', [])
    expect(fullAccessPolicy({ kind: 'approval', toolName: 'Bash' }, asked, 'workspace-write')).toBe(asked)
    expect(fullAccessPolicy({ kind: 'approval', toolName: 'Bash' }, undefined, undefined)).toBeUndefined()
  })

  it('never overrides a saved deny rule, a plan, a question or a form', () => {
    const denied = evaluatePermission({ kind: 'approval', command: 'rm -rf build' }, '/repo', [{ id: 'r', projectRoot: '/repo', kind: 'command', pattern: 'rm', decision: 'deny', createdAt: 0 }])
    expect(denied.decision).toBe('deny')
    expect(fullAccessPolicy({ kind: 'approval', toolName: 'Bash' }, denied, 'full-access')).toBe(denied)
    expect(fullAccessPolicy({ kind: 'approval', toolName: 'ExitPlanMode' }, undefined, 'full-access')).toBeUndefined()
    expect(fullAccessPolicy({ kind: 'question' }, undefined, 'full-access')).toBeUndefined()
    expect(fullAccessPolicy({ kind: 'elicitation' }, undefined, 'full-access')).toBeUndefined()
  })
})
