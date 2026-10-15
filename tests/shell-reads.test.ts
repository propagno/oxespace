// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { readsOutsideProject } from '../electron/main/services/conversation/shell-reads'
import { evaluatePermission } from '../electron/main/services/conversation/kernel/permission-policy'
import { warmShellParser } from '../electron/main/services/conversation/shell-parse'

beforeAll(async () => { await warmShellParser() })

const posix = { windows: false }
const win = { windows: true }
const outside = (line: string, root = '/work/app', options = posix) => readsOutsideProject([line], root, options).map(item => item.path)

describe('readsOutsideProject', () => {
  it('lets a command read inside the project', () => {
    for (const line of ['cat README.md', 'cat src/a.ts', 'cat ./src/a.ts', 'ls -la', 'ls .', 'grep -rn TODO src', 'rg "foo.bar" src', 'find . -name "*.ts"', 'head -n 5 /work/app/src/a.ts', 'git -C . status']) {
      expect(outside(line), line).toEqual([])
    }
  })

  it('catches a path that leaves the project, absolute or through ..', () => {
    expect(outside('cat /etc/passwd')).toEqual(['/etc/passwd'])
    expect(outside('cat ../secrets.txt')).toEqual(['../secrets.txt'])
    expect(outside('head src/../../x')).toEqual(['src/../../x'])
    expect(outside('ls /work/app-other')).toEqual(['/work/app-other'])
    expect(outside('git -C /somewhere/else status')).toEqual(['/somewhere/else'])
    expect(outside('cd ../..')).toEqual(['../..'])
  })

  it('catches paths hidden inside an option', () => {
    expect(outside('grep --file=/etc/passwd x')).toEqual(['/etc/passwd'])
    expect(outside('grep -f/etc/passwd x')).toEqual(['/etc/passwd'])
    expect(outside('rg --ignore-file=../ignore x')).toEqual(['../ignore'])
  })

  it('asks about what the shell decides at run time', () => {
    expect(outside('cat $HOME/.ssh/id_rsa')).toEqual(['$HOME/.ssh/id_rsa'])
    expect(outside('cat ~/.aws/credentials')).toEqual(['~/.aws/credentials'])
    expect(outside('ls $DIR')).toEqual(['$DIR'])
  })

  it('asks about files that usually hold secrets, even inside the project', () => {
    for (const line of ['cat .env', 'cat .env.production', 'cat config/.npmrc', 'head -n 3 certs/server.pem', 'cat ~/x', 'cat secrets.json', 'cat deploy/prod-secrets.yaml', 'tail .git-credentials', 'cat id_rsa']) {
      expect(outside(line).length, line).toBeGreaterThan(0)
    }
    expect(outside('cat src/environment.ts')).toEqual([])
    expect(outside('cat docs/secret-santa.md')).toEqual([])
    expect(outside('grep -rn KEY src')).toEqual([])
    expect(outside('cat README.md package.json')).toEqual([])
  })

  it('does not take a search pattern for a path', () => {
    expect(outside('grep TODO. src')).toEqual([])
    expect(outside('grep "a|b" src')).toEqual([])
    expect(outside('rg -n "con" src')).toEqual([])
  })

  it('judges Windows paths with the drive and the reserved names', () => {
    const root = String.raw`C:\work\app`
    expect(readsOutsideProject([String.raw`cat C:\work\app\src\a.ts`], root, win)).toEqual([])
    expect(readsOutsideProject([String.raw`cat C:\Users\me\.ssh\id_rsa`], root, win).map(item => item.path)).toEqual([String.raw`C:\Users\me\.ssh\id_rsa`])
    expect(readsOutsideProject([String.raw`cat ..\other\x`], root, win)).toHaveLength(1)
    expect(readsOutsideProject([String.raw`Get-Content D:\data.txt`], root, win)).toHaveLength(1)
  })

  it('ignores commands that are not readers', () => {
    expect(outside('echo /etc/passwd')).toEqual([])
    expect(outside('npm ls ../x')).toEqual([])
  })
})

describe('the policy and reads outside the project', () => {
  const root = process.platform === 'win32' ? String.raw`C:\work\app` : '/work/app'
  const outsidePath = process.platform === 'win32' ? String.raw`C:\Users\me\.ssh\id_rsa` : '/home/me/.ssh/id_rsa'
  const ask = (command: string, rules: Parameters<typeof evaluatePermission>[2] = []) => evaluatePermission({ kind: 'approval', command }, root, rules)

  it('approves a read inside the project from the safe list', () => {
    expect(ask('cat src/a.ts')).toMatchObject({ decision: 'allow', reasons: ['Read-only command from the built-in safe list.'] })
  })

  it('asks, with the reason, when the safe list would read outside it', () => {
    const policy = ask(`cat ${outsidePath}`)
    expect(policy?.decision).toBe('ask')
    expect(policy?.reasons[0]).toMatch(/cat reads ".*id_rsa", which (is outside the project|looks like it holds a secret)/)
    expect(policy?.level).toBe('orange')
    expect(policy?.suggestions).toBeUndefined()
  })

  it('leaves a rule the person wrote alone', () => {
    const rule = { id: 'r', projectRoot: null, kind: 'command' as const, pattern: 'cat', decision: 'allow' as const, createdAt: 0 }
    expect(ask(`cat ${outsidePath}`, [rule])?.decision).toBe('allow')
  })

  it('checks every part of a chain', () => {
    expect(ask(`git status && cat ${outsidePath}`)?.decision).toBe('ask')
    expect(ask('git status && cat src/a.ts')?.decision).toBe('allow')
  })
})
