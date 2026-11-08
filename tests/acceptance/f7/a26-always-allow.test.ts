// Frozen acceptance test for 1.5.0 A26 / T74 (OXE program, phase F7), SECURITY: "Always allow" writes only the
// provider's own rule (Claude: the project's permission rule in .claude/settings.local.json; Codex: this session only),
// is never offered for destructive, network or push commands, and is revocable. Temp project folders only; the person's
// home and global Claude settings are never touched. Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f7-approvals.md §A26; DESIGN 1.5.0-f7-design.md U7.3.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { AlwaysAllow, alwaysAllowOffer } from '../../../electron/main/services/approvals/always-allow'
import type { ThreadRequest } from '../../../shared/types/thread'
import { removeTempDir } from '../../helpers/removeTempDir'

const temps: string[] = []
afterEach(() => { for (const dir of temps.splice(0)) { try { removeTempDir(dir) } catch { /* temp */ } } })
function project(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-f7-allow-')))
  temps.push(dir)
  return dir
}
const command = (text: string): ThreadRequest => ({ id: 'r1', nativeId: 'n1', nativeMethod: 'm', kind: 'approval', title: text, toolName: 'Bash', command: text, generation: 1, createdAt: 1, state: 'pending' }) as ThreadRequest
const settings = (root: string) => JSON.parse(readFileSync(join(root, '.claude', 'settings.local.json'), 'utf8'))

describe('A26 · when Always allow is offered', () => {
  test('A26: a reversible, local command is offered, with the exact Claude project rule and the Codex session scope', () => {
    expect(alwaysAllowOffer(command('npm test'), 'claude')).toEqual({ offered: true, rule: { provider: 'claude', text: 'Bash(npm test:*)', scope: 'project' } })
    expect(alwaysAllowOffer(command('npm run lint -- --fix'), 'claude').rule?.text).toBe('Bash(npm run lint:*)')
    expect(alwaysAllowOffer(command('npm test'), 'codex')).toEqual({ offered: true, rule: { provider: 'codex', text: 'npm test', scope: 'session' } })
  })

  test('A26: never offered for destructive, network or push commands, with the reason kind', () => {
    const cases: Array<[string, 'destructive' | 'network' | 'push']> = [
      ['rm -rf dist', 'destructive'], ['git reset --hard HEAD~3', 'destructive'], ['git clean -fdx', 'destructive'], ['del /s /q build', 'destructive'],
      ['curl https://example.com', 'network'], ['wget http://x.example/a', 'network'], ['ssh deploy@prod', 'network'], ['npm install left-pad', 'network'],
      ['git push origin main', 'push'], ['npm publish', 'push'], ['docker push shop/api', 'push']
    ]
    for (const [text, reasonKind] of cases) expect(alwaysAllowOffer(command(text), 'claude'), text).toEqual({ offered: false, reasonKind })
  })

  test('A26: a compound line is never offered (one rule cannot cover two commands); a refused part gives its own reason', () => {
    expect(alwaysAllowOffer(command('npm test && npm run lint'), 'claude').offered).toBe(false)
    expect(alwaysAllowOffer(command('npm test && curl https://x.example'), 'claude')).toEqual({ offered: false, reasonKind: 'network' })
  })
})

describe('A26 · what it writes', () => {
  test('A26: Claude: exactly the shown rule is added to the project\'s settings.local.json; every other key stays', () => {
    const root = project()
    mkdirSync(join(root, '.claude'))
    writeFileSync(join(root, '.claude', 'settings.local.json'), JSON.stringify({ model: 'opus', permissions: { allow: ['Read(*)'], deny: ['Bash(rm:*)'] }, hooks: { Stop: [] } }, null, 2))
    const store = new AlwaysAllow({ projectRoot: () => root })
    const result = store.apply(command('npm test'), 'claude', { threadId: 't1' })
    expect(result).toMatchObject({ ok: true, rule: { provider: 'claude', text: 'Bash(npm test:*)', scope: 'project' } })
    expect(settings(root)).toEqual({ model: 'opus', permissions: { allow: ['Read(*)', 'Bash(npm test:*)'], deny: ['Bash(rm:*)'] }, hooks: { Stop: [] } })
    // Twice is once.
    store.apply(command('npm test'), 'claude', { threadId: 't1' })
    expect(settings(root).permissions.allow).toEqual(['Read(*)', 'Bash(npm test:*)'])
  })

  test('A26: Claude: a project with no .claude folder gets one, with only that rule; nothing outside the project is written', () => {
    const root = project()
    new AlwaysAllow({ projectRoot: () => root }).apply(command('npm test'), 'claude', { threadId: 't1' })
    expect(settings(root)).toEqual({ permissions: { allow: ['Bash(npm test:*)'] } })
    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(false)
  })

  test('A26: Codex: session only: nothing is written, and the rule lives with that conversation', () => {
    const root = project()
    const store = new AlwaysAllow({ projectRoot: () => root })
    expect(store.apply(command('npm test'), 'codex', { threadId: 't1' })).toMatchObject({ ok: true, rule: { provider: 'codex', scope: 'session' } })
    expect(existsSync(join(root, '.claude'))).toBe(false)
    expect(store.sessionAllows('t1', 'npm test')).toBe(true)
    expect(store.sessionAllows('t2', 'npm test')).toBe(false)
    store.endSession('t1')
    expect(store.sessionAllows('t1', 'npm test')).toBe(false)
  })

  test('A26: apply refuses what is not offered, writing nothing', () => {
    const root = project()
    const store = new AlwaysAllow({ projectRoot: () => root })
    expect(store.apply(command('rm -rf dist'), 'claude', { threadId: 't1' })).toEqual({ ok: false, reasonKind: 'destructive' })
    expect(existsSync(join(root, '.claude'))).toBe(false)
  })

  test('A26: revoke removes only that rule, keeping the rest of the file', () => {
    const root = project()
    mkdirSync(join(root, '.claude'))
    writeFileSync(join(root, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Read(*)'] } }))
    const store = new AlwaysAllow({ projectRoot: () => root })
    store.apply(command('npm test'), 'claude', { threadId: 't1' })
    const [rule] = store.list().filter(entry => entry.provider === 'claude')
    expect(rule).toMatchObject({ provider: 'claude', text: 'Bash(npm test:*)', scope: 'project', project: root })
    expect(store.revoke(rule.id)).toMatchObject({ ok: true })
    expect(settings(root).permissions.allow).toEqual(['Read(*)'])
    // OXESpace never removes a rule it didn't add.
    expect(store.list().some(entry => entry.text === 'Read(*)')).toBe(false)
  })
})
