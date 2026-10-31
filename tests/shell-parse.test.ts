// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { evaluateShellCommand } from '../electron/main/services/conversation/shell-command-rules'
import { parseShell, shellParserReady, warmShellParser } from '../electron/main/services/conversation/shell-parse'

beforeAll(async () => { expect(await warmShellParser()).toBe(true) })

const rules = { allow: [], deny: [], useDefaults: true }
const decide = (line: string, r = rules) => evaluateShellCommand(line, r).decision

describe('parseShell', () => {
  it('lists every simple command, also inside groups, loops and substitutions', () => {
    expect(shellParserReady()).toBe(true)
    expect(parseShell('git status && ls | wc -l')?.commands).toEqual(['git status', 'ls', 'wc -l'])
    expect(parseShell('(cd a && make)')?.commands).toEqual(['cd a', 'make'])
    expect(parseShell('for f in a b; do cat $f; done')?.commands).toEqual(['cat $f'])
    expect(parseShell('ls $(whoami)')?.commands).toEqual(['ls $(whoami)', 'whoami'])
    expect(parseShell('echo "a && b" && ls')?.commands).toEqual(['echo "a && b"', 'ls'])
  })

  it('finds file writes, including glued ones, and skips duplication and input', () => {
    expect(parseShell('echo x>out')?.writes).toEqual(['out'])
    expect(parseShell('echo x >>log 2>&1')?.writes).toEqual(['log'])
    expect(parseShell('ls &> all.txt')?.writes).toEqual(['all.txt'])
    expect(parseShell('cat < in')?.writes).toEqual([])
    expect(parseShell('ls 2>&1')?.writes).toEqual([])
    expect(parseShell('echo "a>b"')?.writes).toEqual([])
  })

  it('gives up on what it cannot judge', () => {
    for (const line of ['$cmd a', 'FOO=bar ls', 'export X=1', 'f() { rm x; }', 'echo "unterminated', 'ls ||| x']) {
      expect(parseShell(line)?.unanalysable, line).toBe(true)
    }
  })
})

describe('evaluateShellCommand with the bash grammar', () => {
  it('judges commands inside substitutions and groups', () => {
    expect(decide('ls $(whoami)')).toBe('ask')
    expect(decide('ls $(git status)')).toBe('allow')
    expect(decide('ls $(rm -rf /)')).toBe('deny')
    expect(decide('(git status; ls)')).toBe('allow')
    expect(decide('(git status; rm x)')).toBe('deny')
    expect(decide('for f in a b; do cat $f; done')).toBe('allow')
    expect(decide('for f in a b; do rm $f; done')).toBe('deny')
  })

  it('asks when the command name is computed or assigned', () => {
    expect(decide('$cmd a')).toBe('ask')
    expect(decide('FOO=bar ls')).toBe('ask')
    expect(decide('x=$(rm -rf /)')).toBe('ask')
  })

  it('asks for any redirect to a file, glued or not, and keeps the null device free', () => {
    expect(decide('echo x>out')).toBe('ask')
    expect(decide('git status > /dev/null 2>&1')).toBe('allow')
    expect(decide('cat < in')).toBe('allow')
    expect(decide('cat a | tee out')).toBe('ask')
  })

  it('does not read a here-document body as commands, but reads where it is piped', () => {
    expect(decide("cat <<'EOF'\nrm -rf /\nEOF")).toBe('allow')
    expect(decide("bash <<'EOF'\nls\nEOF")).toBe('ask')
  })

  it('keeps the text splitter for the script inside a PowerShell wrapper', () => {
    expect(decide('pwsh -Command "Get-ChildItem; Get-Date"')).toBe('allow')
    expect(decide('pwsh -Command "Get-ChildItem; Remove-Item x"')).toBe('deny')
  })
})
