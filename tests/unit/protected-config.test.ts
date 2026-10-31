import { describe, expect, it } from 'vitest'
import { commandWritesProtected, protectedConfigKind } from '../../electron/main/services/conversation/kernel/protected-config'
import { evaluatePermission, fullAccessPolicy } from '../../electron/main/services/conversation/kernel/permission-policy'
import { describePermissionRequest } from '../../electron/main/services/conversation/claude-permission-request'
import type { ThreadPermissionRule } from '../../shared/types/thread'

const rule = (kind: ThreadPermissionRule['kind'], pattern: string, decision: ThreadPermissionRule['decision'] = 'allow'): ThreadPermissionRule => ({ id: `${kind}-${pattern}`, projectRoot: '/repo', kind, pattern, decision, createdAt: 0 })
const posix = { windows: false } as const
const edit = (path: string, rules: ThreadPermissionRule[] = []) => evaluatePermission({ kind: 'approval', toolName: 'Edit', paths: [path] }, '/repo', rules, posix)

describe('files that steer agents', () => {
  it('are found at any depth, in any case, with either slash', () => {
    for (const [path, kind] of [
      ['AGENTS.md', 'instructions'], ['docs/agents.md', 'instructions'], ['packages\\app\\CLAUDE.md', 'instructions'], ['CLAUDE.local.md', 'instructions'],
      ['.github/copilot-instructions.md', 'instructions'], ['.cursor/rules/style.mdc', 'instructions'],
      ['.mcp.json', 'mcp'], ['apps/web/.mcp.json', 'mcp'], ['.cursor/mcp.json', 'mcp'], ['.codex/config.toml', 'mcp'],
      ['.claude/settings.json', 'hooks'], ['.claude/settings.local.json', 'hooks'], ['.claude/hooks/pre.sh', 'hooks'], ['.git/hooks/pre-commit', 'hooks'], ['.husky/pre-push', 'hooks'],
      ['/repo/AGENTS.md', 'instructions']
    ] as const) expect(protectedConfigKind(path), path).toBe(kind)
  })

  it('are found in Windows spellings: drive letters, backslashes, a leading dot, mixed slashes and case', () => {
    for (const [path, kind] of [
      ['C:\\repo\\AGENTS.md', 'instructions'], ['c:/repo/.MCP.JSON', 'mcp'], ['.\\.claude\\settings.json', 'hooks'], ['C:\\repo/.claude\\hooks/pre.ps1', 'hooks'],
      ['.CLAUDE\\SETTINGS.LOCAL.JSON', 'hooks'], ['C:\\repo\\\\docs\\CLAUDE.md', 'instructions'], ['\\\\server\\share\\repo\\.git\\hooks\\pre-commit', 'hooks']
    ] as const) expect(protectedConfigKind(path), path).toBe(kind)
    expect(protectedConfigKind('C:\\repo\\src\\app.ts')).toBeNull()
  })

  it('are asked about as a Windows path, and an ordinary file under a rule is still allowed', () => {
    const windows = { windows: true } as const
    const rules = [rule('path', 'src/**'), rule('path', '*.md')]
    expect(evaluatePermission({ kind: 'approval', toolName: 'Edit', paths: ['C:\\repo\\AGENTS.md'] }, 'C:\\repo', rules, windows)).toMatchObject({ decision: 'ask', guarded: true })
    expect(evaluatePermission({ kind: 'approval', toolName: 'Edit', paths: ['C:\\repo\\.claude\\settings.json'] }, 'C:\\repo', rules, windows)).toMatchObject({ decision: 'ask', guarded: true })
    expect(evaluatePermission({ kind: 'approval', toolName: 'Edit', paths: ['C:\\repo\\src\\a.ts'] }, 'C:\\repo', rules, windows)).toMatchObject({ decision: 'allow' })
    expect(evaluatePermission({ kind: 'approval', toolName: 'Edit', paths: ['C:\\repo\\AGENTS.md'] }, 'C:\\repo', [rule('path', 'AGENTS.md', 'deny')], windows)).toMatchObject({ decision: 'deny' })
  })

  it('leave ordinary files alone', () => {
    for (const path of ['README.md', 'src/agents.ts', 'AGENTS.md.bak', 'notes/my-agents.md', '.mcp.json.example', '.claude/commands.txt', 'docs/hooks/readme.md', 'constructor', '__proto__', '', 'src/.mcp/config.ts']) {
      expect(protectedConfigKind(path), path).toBeNull()
    }
  })

  it('are found in a command that writes them, not in one that only reads them', () => {
    expect(commandWritesProtected('tee AGENTS.md')?.path).toBe('AGENTS.md')
    expect(commandWritesProtected('cp /tmp/x .mcp.json')?.kind).toBe('mcp')
    expect(commandWritesProtected('sed -i s/a/b/ CLAUDE.md')?.kind).toBe('instructions')
    expect(commandWritesProtected('echo hi && mv x .claude/settings.json')?.kind).toBe('hooks')
    expect(commandWritesProtected('dd if=x of=AGENTS.md')?.path).toBe('AGENTS.md')
    expect(commandWritesProtected('Set-Content -Path AGENTS.md -Value x')?.path).toBe('AGENTS.md')
    expect(commandWritesProtected('cat AGENTS.md')).toBeNull()
    expect(commandWritesProtected('sed -n 1,5p AGENTS.md')).toBeNull()
    expect(commandWritesProtected('git add AGENTS.md')).toBeNull()
    expect(commandWritesProtected('cp a.txt b.txt')).toBeNull()
  })
})

describe('approvals of changes to those files', () => {
  it('ask even when a saved rule covers the file, with no rule to remember', () => {
    const verdict = edit('AGENTS.md', [rule('path', 'AGENTS.md'), rule('path', '**/*.md')])
    expect(verdict).toMatchObject({ decision: 'ask', guarded: true, level: 'orange' })
    expect(verdict!.reasons.join(' ')).toMatch(/agent instructions.*every later session/)
    expect(verdict!.warnings?.join(' ')).toMatch(/steering/)
    expect(verdict!.suggestions).toBeUndefined()
  })

  it('ask for .mcp.json and hook files inside folders a rule allows', () => {
    expect(edit('.mcp.json', [rule('path', '.mcp.json')])).toMatchObject({ decision: 'ask', guarded: true })
    expect(edit('.claude/hooks/pre.sh', [rule('path', '.claude/**')])).toMatchObject({ decision: 'ask', guarded: true })
  })

  it('still let a saved deny rule decline them', () => {
    expect(edit('AGENTS.md', [rule('path', 'AGENTS.md', 'deny')])).toMatchObject({ decision: 'deny' })
  })

  it('leave an ordinary file under its rule, unguarded', () => {
    const verdict = edit('src/a.ts', [rule('path', 'src/**')])
    expect(verdict).toMatchObject({ decision: 'allow' })
    expect(verdict).not.toHaveProperty('guarded')
    expect(edit('src/a.ts')).not.toHaveProperty('guarded')
  })

  it('guard a protected file next to an allowed one: the pair asks', () => {
    const verdict = evaluatePermission({ kind: 'approval', toolName: 'MultiEdit', paths: ['src/a.ts', 'CLAUDE.md'] }, '/repo', [rule('path', 'src/**')], posix)
    expect(verdict).toMatchObject({ decision: 'ask', guarded: true })
  })

  it('ask for a command a rule allowed when it writes one of them', () => {
    const rules = [rule('command', 'tee'), rule('command', 'cp')]
    expect(evaluatePermission({ kind: 'approval', command: 'tee AGENTS.md' }, '/repo', rules, posix)).toMatchObject({ decision: 'ask', guarded: true })
    expect(evaluatePermission({ kind: 'approval', command: 'cp a.txt b.txt' }, '/repo', rules, posix)).toMatchObject({ decision: 'allow' })
  })

  it('keep asking under Full access, while ordinary asks are still answered', () => {
    const guarded = edit('AGENTS.md')
    expect(fullAccessPolicy({ kind: 'approval', toolName: 'Edit' }, guarded, 'full-access')).toBe(guarded)
    const plain = evaluatePermission({ kind: 'approval', command: 'R=/repo/src; echo $R | sed "s|$R||"' }, '/repo', [])
    expect(fullAccessPolicy({ kind: 'approval', toolName: 'Bash' }, plain, 'full-access')).toMatchObject({ decision: 'allow' })
  })
})

describe('the approval card for those files', () => {
  const suggestions = [{ type: 'addRules', rules: [{ toolName: 'Edit', ruleContent: '**' }], behavior: 'allow', destination: 'session' }]
  const present = (toolName: string, input: Record<string, unknown>) => describePermissionRequest({ permission_suggestions: suggestions }, toolName, input)

  it('offers one approval and no "allow for this session" for them', () => {
    expect(present('Edit', { file_path: '/repo/AGENTS.md' }).decisions).toEqual(['accept', 'decline'])
    expect(present('Write', { file_path: '/repo/.mcp.json' }).suggestions).toEqual([])
    expect(present('Bash', { command: 'tee CLAUDE.md' }).decisions).toEqual(['accept', 'decline'])
  })

  it('still offers it for ordinary files', () => {
    expect(present('Edit', { file_path: '/repo/src/a.ts' }).decisions).toEqual(['accept', 'acceptForSession', 'decline'])
    expect(present('Bash', { command: 'cat AGENTS.md' }).decisions).toEqual(['accept', 'acceptForSession', 'decline'])
  })
})
