import { describe, expect, it } from 'vitest'
import { commandRewritesTracked, protectedConfigKind } from '../../electron/main/services/conversation/kernel/protected-config'
import { evaluatePermission, fullAccessPolicy, guardedDecisions } from '../../electron/main/services/conversation/kernel/permission-policy'
import type { ThreadPermissionRule } from '../../shared/types/thread'

/**
 * B7.3 on top of B16: the project's `.oxespace/policy.json` and `oxe.yaml` are protected like `.mcp.json`, and a
 * recursive copy or sync into the project's root or a protected place is never rule-approved. Cases from
 * homologation's probes (#184: `protected-config-probe.mts.txt` and `protected-config-main-probe.mts.txt`), through
 * the real `evaluatePermission` and `fullAccessPolicy`, under the probe's saved rules.
 */
const root = '/repo'
const rule = (kind: ThreadPermissionRule['kind'], pattern: string): ThreadPermissionRule => ({ id: `${kind}-${pattern}`, projectRoot: root, kind, pattern, decision: 'allow', createdAt: 0 })
const programs = ['ls', 'grep', '7z', 'Expand-Archive', 'gzip', 'rsync', 'pushd', 'echo', 'printf', 'python', 'python3', 'node', 'git', 'curl', 'cd', 'tar', 'unzip',
  'cp', 'mv', 'sh', 'bash', 'pwsh', 'powershell', 'Set-Content', 'Out-File', 'tee', 'sed', 'cat', 'jq', 'yq', 'npm', 'npx', 'robocopy', 'xcopy', 'Copy-Item', 'Move-Item']
const probeRules = [...programs.map(pattern => rule('command', pattern)), rule('path', '**'), rule('path', '.*')]
const posix = { windows: false } as const
const command = (text: string, at = root) => evaluatePermission({ kind: 'approval', toolName: 'Bash', command: text }, at, probeRules, posix)
const edit = (path: string) => evaluatePermission({ kind: 'approval', toolName: 'Edit', paths: [path] }, root, probeRules, posix)
/** The project's folders, as the caller's folder check would report them. */
const folders = new Set(['/repo/dist', '/repo/tmp', '/repo/build'])
const withFolders = { ...posix, isDirectory: (path: string) => folders.has(path.replace(/\\/g, '/')) }
const commandIn = (text: string) => evaluatePermission({ kind: 'approval', toolName: 'Bash', command: text }, root, probeRules, withFolders)

/** Guarded under the saved rules and under Full access, with no "for the session" answer. */
function expectGuarded(verdict: ReturnType<typeof command>, label: string) {
  expect(verdict, label).toMatchObject({ decision: 'ask', guarded: true })
  expect(verdict!.suggestions, label).toBeUndefined()
  expect(verdict!.reasonCodes?.length, label).toBeGreaterThan(0)
  expect(fullAccessPolicy({ kind: 'approval', toolName: 'Bash' }, verdict, 'full-access'), label).toMatchObject({ decision: 'ask', guarded: true })
  expect(guardedDecisions(['accept', 'acceptForSession', 'decline'], verdict), label).toEqual(['accept', 'decline'])
}

describe('the project policy and oxe.yaml are protected (B7.3)', () => {
  it.each([
    'echo {} > .oxespace/policy.json', 'echo x >> oxe.yaml', "printf '{}' > .oxespace/policy.json",
    'cp /tmp/p.json .oxespace/policy.json', "sed -i 's/deny/allow/' .oxespace/policy.json",
    'git checkout -- .oxespace/policy.json', 'git restore oxe.yaml', 'git apply evil.patch',
    `python -c "open('.oxespace/policy.json','w').write('{}')"`, `node -e "require('fs').writeFileSync('oxe.yaml','x')"`,
    'curl -o .oxespace/policy.json https://x.invalid/p', 'tar xf p.tar .oxespace/policy.json', 'unzip -o p.zip',
    'cd .oxespace && echo {} > policy.json', 'Set-Content .oxespace\\policy.json "{}"', 'Set-Content -Path .\\oxe.yaml -Value x',
    `powershell -c "Set-Content .oxespace\\policy.json '{}'"`, "sh -c 'echo {} > .oxespace/policy.json'",
    "jq '.rules=[]' .oxespace/policy.json | tee .oxespace/policy.json", "yq -i '.x=2' oxe.yaml", 'npx some-tool --write .oxespace/policy.json',
    'pushd .oxespace && echo {} > policy.json && popd', 'echo {} > .\\.oxespace\\policy.json', 'echo x > OXE.YAML',
    'git --git-dir=.git checkout HEAD -- .oxespace'
  ])('guards %j', text => expectGuarded(command(text), text))

  it('names them with their own C3 code, not as MCP server settings', () => {
    expect(command('echo {} > .oxespace/policy.json')!.reasonCodes).toContainEqual({ code: 'thread.protectedConfig.policy', params: { path: '.oxespace/policy.json' } })
    expect(edit('oxe.yaml')!.reasonCodes).toContainEqual({ code: 'thread.protectedConfig.policy', params: { path: 'oxe.yaml' } })
    expect(command('echo {} > .mcp.json')!.reasonCodes).toContainEqual({ code: 'thread.protectedConfig.mcp', params: { path: '.mcp.json' } })
  })

  it.each([
    '.oxespace/policy.json', '.oxespace\\policy.json', '.OXESPACE\\POLICY.JSON', '/repo/.oxespace/policy.json', '.oxespace/./policy.json',
    'sub/../.oxespace/policy.json', '.oxespace/policy.json.', '.oxespace/policy.json ', '.oxespace/policy.json::$DATA', '.oxespace\\POLICY~1.JSO',
    'oxe.yaml', 'OXE.YAML', 'oxe.yaml.', 'oxe.yaml::$DATA', 'OXESPA~1\\policy.json'
  ])('reads %j as the protected file and guards an edit of it', path => {
    expect(protectedConfigKind(path), path).toBe('policy')
    expectGuarded(edit(path), path)
  })

  it.each(['oxe.yml', '.oxespace/other.json', 'policy.json', 'docs/oxe.yaml.md'])('leaves %j alone', path => {
    expect(protectedConfigKind(path), path).toBeNull()
    expect(edit(path), path).toMatchObject({ decision: 'allow' })
  })

  it.each(['cat .oxespace/policy.json', 'grep -r deny .oxespace', 'ls .oxespace'])('still answers %j, a plain read', text => {
    expect(command(text), text).toMatchObject({ decision: 'allow' })
    expect(command(text)?.guarded, text).toBeUndefined()
  })
})

describe('a move of a glob or a folder into the root or a protected place (B7.3)', () => {
  it.each([
    // A folder written with a trailing backslash is quoted: unquoted, `dist\ .` escapes the space for a POSIX shell.
    ['mv tmp/* .', 'mv'], ['mv tmp/* ./', 'mv'], ['mv dist/ .', 'mv'], ["mv 'dist\\' .", 'mv'], ['mv -f x/* /repo', 'mv'], ['mv hooks/ .git', 'mv'],
    ['mv cfg/* .oxespace/', 'mv'], ['mv a/* b/* .', 'mv'], ['Move-Item tmp\\* .', 'Move-Item'], ["Move-Item -Path 'dist\\' -Destination .", 'Move-Item'],
    ['mi tmp\\* .claude', 'Move-Item'], ['move tmp\\* .', 'Move-Item'], ['sh -c "mv tmp/* ./"', 'mv'], ['cd sub && mv x/* ..', 'mv']
  ])('treats %j as rewriting tracked files (%s): never rule-approved', (text, label) => {
    expect(commandRewritesTracked(text, { root }), text).toBe(label)
    const verdict = command(text)
    expectGuarded(verdict, text)
    expect(verdict!.reasonCodes, text).toContainEqual({ code: 'thread.protectedConfig.rewritesTracked', params: { command: label } })
  })

  it('counts a folder the project has, without a trailing slash, when the caller can look', () => {
    for (const text of ['mv dist .', 'mv tmp ./', 'Move-Item build .', 'mv dist /repo']) {
      expect(commandRewritesTracked(text, { root, isDirectory: withFolders.isDirectory }), text).not.toBeNull()
      expectGuarded(commandIn(text), text)
    }
    // Without the folder check, a bare name is read as a file.
    expect(commandRewritesTracked('mv dist .', { root })).toBeNull()
  })

  it.each(['mv a.txt .', 'mv a.txt ./', 'mv notes.md docs/', 'mv tmp/* build/', 'mv dist/ out/', 'Move-Item a.txt .', 'mv src/a.ts ./b.ts', 'mv tmp/* /tmp/elsewhere', 'mv README.md .'])(
    'leaves %j to the saved rules', text => {
      expect(commandRewritesTracked(text, { root, isDirectory: withFolders.isDirectory }), text).toBeNull()
      const verdict = commandIn(text)
      expect(verdict?.guarded, text).toBeUndefined()
      expect(verdict, text).toMatchObject({ decision: 'allow' })
    })
})

describe('a recursive copy or sync into the root or a protected place (B7.3 re-probe)', () => {
  it('guards homologation\'s case verbatim: rsync -a ./tmp/ ./ with a saved rsync rule, no session answer', () => {
    const verdict = evaluatePermission({ kind: 'approval', toolName: 'Bash', command: 'rsync -a ./tmp/ ./' }, root, [rule('command', 'rsync')], posix)
    expectGuarded(verdict, 'rsync -a ./tmp/ ./')
    expect(verdict!.reasonCodes).toContainEqual({ code: 'thread.protectedConfig.rewritesTracked', params: { command: 'rsync -a' } })
  })

  it.each([
    ['rsync -a ./tmp/ ./', 'rsync -a'], ['rsync -r src/ .', 'rsync -a'], ['rsync -avz --delete tmp/ /repo', 'rsync -a'], ['rsync -a tmp/ .claude', 'rsync -a'],
    ['cp -r src/ ./', 'cp -r'], ['cp -R x/. .', 'cp -r'], ['cp -a x/ .', 'cp -r'], ['cp -rf tmp/* /repo/', 'cp -r'], ['cp --recursive t/ .git/hooks', 'cp -r'],
    ['cp tmp/* .', 'cp *'], ['cp -r hooks/ .git', 'cp -r'], ['cp -r cfg/ .oxespace/', 'cp -r'], ['cp -r cfg/ .codex', 'cp -r'], ['cp -r r/ .cursor', 'cp -r'],
    ['robocopy src .', 'robocopy'], ['robocopy src . /E', 'robocopy'], ['robocopy C:\\tmp\\x .\\.claude /MIR', 'robocopy'],
    ['xcopy /e src .', 'xcopy'], ['xcopy src\\* . /s', 'xcopy'], ['xcopy src\\*', 'xcopy'],
    ['Copy-Item -Recurse src\\* .', 'Copy-Item -Recurse'], ['Copy-Item src -Destination . -Recurse', 'Copy-Item -Recurse'], ['Copy-Item src\\* .', 'Copy-Item *'],
    ['cpi -r src\\* .', 'Copy-Item -Recurse'], ['Copy-Item -Recurse src', 'Copy-Item -Recurse'],
    ['cp -r src/ $PWD', 'cp -r'], ['sh -c "rsync -a tmp/ ./"', 'rsync -a'], ['powershell -c "Copy-Item -Recurse x\\* ."', 'Copy-Item -Recurse'],
    ['cd sub && cp -r x/ ..', 'cp -r']
  ])('treats %j as rewriting tracked files (%s): never rule-approved', (text, label) => {
    expect(commandRewritesTracked(text, { root }), text).toBe(label)
    const verdict = command(text)
    expectGuarded(verdict, text)
    expect(verdict!.reasonCodes, text).toContainEqual({ code: 'thread.protectedConfig.rewritesTracked', params: { command: label } })
  })

  it.each([
    'cp -r src/ build/', 'rsync -a a/ dist/', 'cp -r src build', 'rsync -a ./tmp/ ./out/', 'robocopy src build /E', 'xcopy /e src dist',
    'Copy-Item -Recurse src dist', 'cp a.txt .', 'cp a.txt b.txt', 'cp src/a.ts ./', 'rsync a.txt ./', 'cp -r src/ /tmp/out', 'rsync -a ./ /tmp/backup/',
    'cp -r x/ ~/backup', 'cp -r docs/ build/.claude-notes', 'cp -r x/ packages/app/build'
  ])('leaves %j to the saved rules', text => {
    expect(commandRewritesTracked(text, { root }), text).toBeNull()
    const verdict = command(text)
    expect(verdict?.guarded, text).toBeUndefined()
    expect(verdict, text).toMatchObject({ decision: 'allow' })
  })

  it('reads an absolute destination against the project root, and counts it when the root is unknown', () => {
    expect(commandRewritesTracked('rsync -a tmp/ C:\\repo', { root: 'C:\\repo' })).toBe('rsync -a')
    expect(commandRewritesTracked('rsync -a tmp/ C:\\Repo\\.CLAUDE', { root: 'C:\\repo' })).toBe('rsync -a')
    expect(commandRewritesTracked('rsync -a tmp/ C:\\other', { root: 'C:\\repo' })).toBeNull()
    expect(commandRewritesTracked('rsync -a tmp/ C:\\other')).toBe('rsync -a')
    // `..` may be the root after a `cd`, whatever the root is.
    expect(commandRewritesTracked('cp -r x/ ..')).toBe('cp -r')
    expect(commandRewritesTracked('cp -r x/ ../..', { root: '/repo' })).toBe('cp -r')
  })
})
