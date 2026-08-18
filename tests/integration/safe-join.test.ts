import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { safeJoin } from '../../electron/main/utils/safe-join'

const IS_WINDOWS = process.platform === 'win32'
const describeWindows = IS_WINDOWS ? describe : describe.skip
const describePosix = IS_WINDOWS ? describe.skip : describe

describe('safeJoin', () => {
  const root = resolve('C:/workspace/root')

  test.each([
    ['file', ['README.md'], join(root, 'README.md')],
    ['nested file', ['src', 'index.ts'], join(root, 'src', 'index.ts')],
    ['current segment', ['.', 'src'], join(root, 'src')],
    ['nested current segment', ['src', '.', 'index.ts'], join(root, 'src', 'index.ts')],
    ['collapses child parent', ['src', '..', 'package.json'], join(root, 'package.json')],
    ['allows root', ['.'], root],
    ['allows empty child', [''], root],
    ['allows spaced name', ['My Project', 'notes.md'], join(root, 'My Project', 'notes.md')],
    ['allows unicode-like ascii fallback', ['cafe', 'resume.txt'], join(root, 'cafe', 'resume.txt')],
    ['allows dotted filename', ['.gitignore'], join(root, '.gitignore')],
    ['allows hidden nested file', ['.config', 'settings.json'], join(root, '.config', 'settings.json')],
    ['allows dash path', ['feature-a', 'task-1.md'], join(root, 'feature-a', 'task-1.md')],
    ['allows underscore path', ['feature_a', 'task_1.md'], join(root, 'feature_a', 'task_1.md')],
    ['allows numeric path', ['2026', '05', '07.md'], join(root, '2026', '05', '07.md')],
    ['allows repeated separators through segment', ['src//components'], join(root, 'src', 'components')],
    ['allows trailing separator', ['src/'], join(root, 'src')],
    ['allows deep path', ['a', 'b', 'c', 'd.txt'], join(root, 'a', 'b', 'c', 'd.txt')],
    ['allows file with extension chain', ['archive.tar.gz'], join(root, 'archive.tar.gz')],
    ['allows sibling-looking prefix inside root', ['root-copy', 'file.txt'], join(root, 'root-copy', 'file.txt')],
    ['allows parent then child inside root', ['src', '..', 'src', 'App.tsx'], join(root, 'src', 'App.tsx')]
  ])('accepts %s', (_name, segments, expected) => {
    expect(safeJoin(root, ...segments)).toBe(expected)
  })

  test.each([
    ['parent escape', ['..']],
    ['parent escape file', ['..', 'outside.txt']],
    ['double parent escape', ['src', '..', '..', 'outside.txt']],
    ['sibling prefix escape', ['..', 'root-copy', 'file.txt']],
    ['absolute posix escape', ['/tmp/outside']],
    ['absolute parent', [resolve(root, '..', 'outside.txt')]],
    ['absolute nested then escape', [join(root, 'src'), '..', '..', 'outside.txt']],
    ['root prefix trick', [resolve('C:/workspace/rooted/file.txt')]],
    ['empty root prefix trick via absolute', [resolve('C:/workspace/root2/file.txt')]],
    ['absolute temp escape', [resolve('C:/Temp/file.txt')]]
  ])('rejects %s', (_name, segments) => {
    expect(() => safeJoin(root, ...segments)).toThrow('escapes')
  })

  // Drive letters and backslashes are path syntax ONLY on Windows. On POSIX
  // `C:\workspace\outside.txt` is an ordinary relative filename that genuinely
  // resolves inside the root, so these are not escapes there and asserting a
  // throw would be asserting a bug.
  describeWindows('windows-specific path syntax', () => {
    test.each([
      ['absolute windows escape', ['C:/outside/file.txt']],
      ['absolute windows sibling', ['C:/workspace/root-copy/file.txt']],
      ['mixed separator escape', ['..\\outside.txt']],
      ['mixed deep escape', ['src\\..\\..\\outside.txt']],
      ['drive root escape', ['C:\\workspace\\outside.txt']]
    ])('rejects %s', (_name, segments) => {
      expect(() => safeJoin(root, ...segments)).toThrow('escapes')
    })
  })

  describePosix('posix path syntax', () => {
    test('treats a backslash name as an ordinary file inside the root', () => {
      expect(safeJoin(root, '..\\outside.txt')).toBe(join(root, '..\\outside.txt'))
    })

    test.each([
      ['absolute system escape', ['/etc/passwd']],
      ['absolute home escape', ['/home/other/file.txt']],
      ['deep parent escape', ['a', 'b', '..', '..', '..', 'outside.txt']]
    ])('rejects %s', (_name, segments) => {
      expect(() => safeJoin(root, ...segments)).toThrow('escapes')
    })
  })
})
