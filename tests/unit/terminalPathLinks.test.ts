import { describe, expect, it } from 'vitest'
import { findPathsInLine } from '../../src/components/Terminal/terminalPathLinks'

const ROOT = '/home/a/project'

describe('findPathsInLine', () => {
  it('finds project paths with their line, by column, as an agent or a compiler prints them', () => {
    const line = 'error in src/app.ts:12:4: expected ";" (see ./lib/util.ts(3,1)).'
    expect(findPathsInLine(line, ROOT).map(({ start, end, text, path }) => ({ start, end, text, path }))).toEqual([
      { start: 9, end: 24, text: 'src/app.ts:12:4', path: { relativePath: 'src/app.ts', line: 12, column: 4 } },
      { start: 44, end: 62, text: './lib/util.ts(3,1)', path: { relativePath: 'lib/util.ts', line: 3, column: 1 } }
    ])
  })

  it('drops a sentence full stop or colon after the path', () => {
    expect(findPathsInLine('Edited package.json.', ROOT).map(found => found.text)).toEqual(['package.json'])
    expect(findPathsInLine('/home/a/project/README.md: done', ROOT).map(found => found.path.relativePath)).toEqual(['README.md'])
  })

  it('links nothing outside the project, nor URLs, options or prose', () => {
    expect(findPathsInLine('echo ../secret.txt:1 /etc/hosts https://x.dev/a.ts --flag build done', ROOT)).toEqual([])
  })
})
