import { describe, expect, it } from 'vitest'
import { extractCdPrefix, presentInlineScript } from '../shared/commandPresenters'

describe('presentInlineScript', () => {
  it('reads the script of an inline interpreter call', () => {
    expect(presentInlineScript(`node -e "console.log('a')"`)).toEqual({ language: 'JavaScript', script: `console.log('a')` })
    expect(presentInlineScript(`python3 -c 'import os\\nprint(os.getcwd())'`)).toEqual({ language: 'Python', script: 'import os\nprint(os.getcwd())' })
    expect(presentInlineScript(`ruby -e "puts 1"`)).toEqual({ language: 'Ruby', script: 'puts 1' })
    expect(presentInlineScript(`"C:\\Program Files\\nodejs\\node.exe" --print "1 + 1"`)?.script).toBe('1 + 1')
    expect(presentInlineScript(`python -u -c "print(1)"`)?.script).toBe('print(1)')
  })

  it('undoes escaped quotes inside double quotes only', () => {
    expect(presentInlineScript(String.raw`node -e "console.log(\"hi\")"`)?.script).toBe('console.log("hi")')
  })

  it('leaves everything else alone', () => {
    expect(presentInlineScript('node script.js')).toBeNull()
    expect(presentInlineScript('python -m pytest')).toBeNull()
    expect(presentInlineScript('ls -la')).toBeNull()
    expect(presentInlineScript('node -e "unterminated')).toBeNull()
    expect(presentInlineScript('node -e ""')).toBeNull()
  })
})

describe('extractCdPrefix', () => {
  it('splits a leading cd from the command that follows', () => {
    expect(extractCdPrefix('cd /work/app && npm test')).toEqual({ directory: '/work/app', rest: 'npm test' })
    expect(extractCdPrefix('cd "C:\\My Project"; git status')).toEqual({ directory: 'C:\\My Project', rest: 'git status' })
    expect(extractCdPrefix('cd /d C:\\x && dir')).toEqual({ directory: 'C:\\x', rest: 'dir' })
  })

  it('ignores a cd that stands alone or is not first', () => {
    expect(extractCdPrefix('cd /work')).toBeNull()
    expect(extractCdPrefix('ls && cd /work && ls')).toBeNull()
  })
})
