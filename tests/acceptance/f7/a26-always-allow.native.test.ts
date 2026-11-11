// Frozen acceptance test for 1.5.0 A26 / T74 (OXE program, phase F7), SECURITY (TECH LEAD S1–S3 and HML 714-1..3 on
// #714): "Always allow" writes only the provider's own rule, exactly the offered prefix, never broader; never for a
// command that can run arbitrary code, elevate, destroy, reach the network, push, chain steps or redirect into a file;
// a script runner is offered but says it runs project code. Claude's rule goes only into the project's
// .claude/settings.local.json (real path, atomic, every other key kept, invalid JSON refused); which rules OXESpace added
// is recorded in its database, so a rule the person wrote is never removed. Codex is this session only.
// Temp project folders and an in-memory database only. Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f7-approvals.md §A26.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f7/a26-always-allow.native.test.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db/index'
import { AlwaysAllow, alwaysAllowOffer } from '../../../electron/main/services/approvals/always-allow'
import type { ThreadRequest } from '../../../shared/types/thread'
import { removeTempDir } from '../../helpers/removeTempDir'

const temps: string[] = []
const dbs: AppDatabase[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
  for (const dir of temps.splice(0)) { try { removeTempDir(dir) } catch { /* temp */ } }
})
function project(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-f7-allow-')))
  temps.push(dir)
  return dir
}
function database(): AppDatabase { const db = openInMemoryDatabase(); dbs.push(db); return db }
const command = (text: string, toolName = 'Bash'): ThreadRequest => ({ id: 'r1', nativeId: 'n1', nativeMethod: 'm', kind: 'approval', title: text, toolName, command: text, generation: 1, createdAt: 1, state: 'pending' }) as ThreadRequest
const settingsOf = (root: string) => JSON.parse(readFileSync(join(root, '.claude', 'settings.local.json'), 'utf8'))

describe('A26 · what is offered, exactly', () => {
  test('S1: the rule is exactly the offered prefix, never broader; env, timeout and time prefixes are looked through', () => {
    const cases: Array<[string, string]> = [
      ['npm test', 'Bash(npm test:*)'], ['npm run lint -- --fix', 'Bash(npm run lint:*)'], ['git status', 'Bash(git status:*)'], ['git diff --stat', 'Bash(git diff:*)'],
      ['FOO=1 npm test', 'Bash(npm test:*)'], ['timeout 60 npm test', 'Bash(npm test:*)'], ['time npm test', 'Bash(npm test:*)']
    ]
    for (const [text, rule] of cases) expect(alwaysAllowOffer(command(text), 'claude').rule, text).toEqual({ provider: 'claude', text: rule, scope: 'project' })
    expect(alwaysAllowOffer(command('npm test'), 'codex')).toMatchObject({ offered: true, rule: { provider: 'codex', text: 'npm test', scope: 'session' } })
  })

  test('HML-714-1: a script runner is offered, but says it runs project code, and where that code is defined', () => {
    expect(alwaysAllowOffer(command('npm test'), 'claude')).toMatchObject({ offered: true, runsProjectCode: true, definedIn: 'package.json' })
    expect(alwaysAllowOffer(command('npm run lint'), 'claude')).toMatchObject({ runsProjectCode: true, definedIn: 'package.json' })
    expect(alwaysAllowOffer(command('git status'), 'claude')).not.toHaveProperty('runsProjectCode')
  })

  test('S1 / HML-714-1/2: never offered: code runners, elevation, destructive, network, push, broad, compound and file redirection', () => {
    const never: Record<string, string[]> = {
      code: ['node -e "x"', 'node scripts/x.js', 'python -c "x"', 'python tool.py', 'py x.py', 'ruby -e x', 'perl -e x', 'bash -c "ls"', 'sh x.sh', 'zsh -c x', 'pwsh -Command x', 'powershell -c x',
        'cmd /c dir', 'eval "ls"', 'npx prettier .', 'bunx x', 'pnpm dlx x', 'yarn dlx x', 'deno run x.ts', 'make build', 'docker run alpine', 'docker exec api sh', 'env node x', 'xargs ls', './run.sh'],
      elevation: ['sudo ls', 'doas ls', 'runas /user:admin cmd', 'Start-Process pwsh -Verb RunAs'],
      destructive: ['rm notes.txt', 'rm -rf dist', 'Remove-Item x', 'del /s /q build', 'git reset --hard HEAD~3', 'git clean -fdx', 'git checkout -- .', 'git restore .', 'git stash drop', 'git branch -D topic',
        "sed -i 's/a/b/' x", 'find . -name "*.log" -delete', 'docker compose down -v', 'docker system prune', 'terraform apply', 'kubectl delete pod x'],
      network: ['curl https://x.example', 'wget http://x.example', 'ssh deploy@prod', 'npm install left-pad', 'pip install x', 'uv pip install x', 'cargo install x', 'go install x@latest',
        'git fetch', 'git pull', 'git clone https://x.example/r', 'gh issue list', 'az group list', 'aws s3 ls', 'iwr https://x.example', 'irm https://x.example'],
      push: ['git push origin main', 'git push --force', 'git push --tags', 'npm publish', 'docker push shop/api', 'gh pr create', 'gh pr merge 1', 'gh release create v1', 'cargo publish', 'twine upload dist/*'],
      broad: ['git', 'npm', 'docker'],
      compound: ['npm test && npm run lint', 'npm test; ls', 'npm test | tee log'],
      redirect: ['npm test > out.txt', 'echo x >> notes.md']
    }
    for (const [reasonKind, list] of Object.entries(never)) {
      for (const text of list) expect(alwaysAllowOffer(command(text), 'claude'), text).toEqual({ offered: false, reasonKind })
    }
  })

  test('HML-714-3: a PowerShell-tool request is never offered as a Bash() rule', () => {
    expect(alwaysAllowOffer(command('Get-ChildItem', 'PowerShell'), 'claude')).toEqual({ offered: false, reasonKind: 'code' })
  })
})

describe('A26 · what it writes (S2, S3)', () => {
  test('S2: the rule is added to <project>/.claude/settings.local.json, atomically, keeping every other key and the file\'s shape', () => {
    const root = project()
    mkdirSync(join(root, '.claude'))
    const original = { model: 'opus', permissions: { allow: ['Read(*)'], deny: ['Bash(rm:*)'] }, hooks: { Stop: [] } }
    writeFileSync(join(root, '.claude', 'settings.local.json'), JSON.stringify(original, null, 2))
    const store = new AlwaysAllow({ projectRoot: () => root, db: database(), now: () => 5 })
    expect(store.apply(command('npm test'), 'claude', { threadId: 't1' })).toMatchObject({ ok: true, rule: { text: 'Bash(npm test:*)' } })
    expect(settingsOf(root)).toEqual({ ...original, permissions: { ...original.permissions, allow: ['Read(*)', 'Bash(npm test:*)'] } })
    store.apply(command('npm test'), 'claude', { threadId: 't1' })
    expect(settingsOf(root).permissions.allow).toEqual(['Read(*)', 'Bash(npm test:*)'])
    // No temp file is left behind by the atomic write.
    expect(readdirSync(join(root, '.claude')).sort()).toEqual(['settings.local.json'])
    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(false)
  })

  test('S2: invalid JSON in settings.local.json is refused and left exactly as it was', () => {
    const root = project()
    mkdirSync(join(root, '.claude'))
    writeFileSync(join(root, '.claude', 'settings.local.json'), '{ "permissions": { "allow": [ ')
    const store = new AlwaysAllow({ projectRoot: () => root, db: database() })
    expect(store.apply(command('npm test'), 'claude', { threadId: 't1' })).toEqual({ ok: false, code: 'approvals.alwaysAllow.invalidSettings' })
    expect(readFileSync(join(root, '.claude', 'settings.local.json'), 'utf8')).toBe('{ "permissions": { "allow": [ ')
  })

  test('S2: a .claude folder (or the file) that is a link or junction out of the project is refused; nothing outside is written', () => {
    const root = project()
    const outside = project()
    symlinkSync(outside, join(root, '.claude'), 'junction')
    const store = new AlwaysAllow({ projectRoot: () => root, db: database() })
    expect(store.apply(command('npm test'), 'claude', { threadId: 't1' })).toEqual({ ok: false, code: 'approvals.alwaysAllow.outsideProject' })
    expect(readdirSync(outside)).toEqual([])
  })

  test('S3: which rules OXESpace added is recorded in its database: a hand-written identical rule is never removed, and the record survives a restart', () => {
    const root = project()
    mkdirSync(join(root, '.claude'))
    writeFileSync(join(root, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test:*)'] } }))
    const db = database()
    const store = new AlwaysAllow({ projectRoot: () => root, db, now: () => 7 })
    // The person already wrote this exact rule: OXESpace adds nothing and records nothing.
    store.apply(command('npm test'), 'claude', { threadId: 't1' })
    expect(store.list().filter(entry => entry.provider === 'claude')).toEqual([])
    store.apply(command('git status'), 'claude', { threadId: 't1' })
    const restarted = new AlwaysAllow({ projectRoot: () => root, db })
    const [ours] = restarted.list().filter(entry => entry.provider === 'claude')
    expect(ours).toMatchObject({ text: 'Bash(git status:*)', project: root, addedAt: 7 })
    expect(restarted.revoke(ours.id)).toMatchObject({ ok: true })
    expect(settingsOf(root).permissions.allow).toEqual(['Bash(npm test:*)'])
  })

  test('A26: Codex is this session only: nothing is written, and the rule ends with the conversation', () => {
    const root = project()
    const store = new AlwaysAllow({ projectRoot: () => root, db: database() })
    expect(store.apply(command('npm test'), 'codex', { threadId: 't1' })).toMatchObject({ ok: true, rule: { scope: 'session' } })
    expect(existsSync(join(root, '.claude'))).toBe(false)
    expect(store.sessionAllows('t1', 'npm test')).toBe(true)
    expect(store.sessionAllows('t2', 'npm test')).toBe(false)
    store.endSession('t1')
    expect(store.sessionAllows('t1', 'npm test')).toBe(false)
  })

  test('A26: apply refuses what is not offered, writing nothing', () => {
    const root = project()
    const store = new AlwaysAllow({ projectRoot: () => root, db: database() })
    expect(store.apply(command('rm -rf dist'), 'claude', { threadId: 't1' })).toEqual({ ok: false, reasonKind: 'destructive' })
    expect(existsSync(join(root, '.claude'))).toBe(false)
  })
})
