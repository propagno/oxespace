import { describe, expect, it } from 'vitest'
import { parseProjectPath, splitPosition } from '../../src/lib/projectPath'

const POSIX = '/home/a/project'
const WINDOWS = String.raw`C:\Users\a\project`

describe('parseProjectPath', () => {
  it('reads relative paths, with ./ and a line or column', () => {
    expect(parseProjectPath('src/app.ts', POSIX)).toEqual({ relativePath: 'src/app.ts' })
    expect(parseProjectPath('./src/app.ts:42', POSIX)).toEqual({ relativePath: 'src/app.ts', line: 42 })
    expect(parseProjectPath('src/app.ts:42:7', POSIX)).toEqual({ relativePath: 'src/app.ts', line: 42, column: 7 })
    expect(parseProjectPath('src/app.ts(42,7)', POSIX)).toEqual({ relativePath: 'src/app.ts', line: 42, column: 7 })
    expect(parseProjectPath('package.json', POSIX)).toEqual({ relativePath: 'package.json' })
    expect(parseProjectPath(String.raw`src\lib\a.ts:3`, WINDOWS)).toEqual({ relativePath: 'src/lib/a.ts', line: 3 })
  })

  it('reads absolute paths inside the root: POSIX with case, Windows without', () => {
    expect(parseProjectPath('/home/a/project/src/app.ts:9', POSIX)).toEqual({ relativePath: 'src/app.ts', line: 9 })
    expect(parseProjectPath('/home/a/Project/src/app.ts', POSIX)).toBeNull()
    expect(parseProjectPath(String.raw`c:\users\A\Project\src\app.ts`, WINDOWS)).toEqual({ relativePath: 'src/app.ts' })
    expect(parseProjectPath('C:/Users/a/project/src/app.ts:1:1', WINDOWS)).toEqual({ relativePath: 'src/app.ts', line: 1, column: 1 })
  })

  it('is never a link for a path outside the root', () => {
    expect(parseProjectPath('../other/app.ts', POSIX)).toBeNull()
    expect(parseProjectPath('src/../../other/app.ts', POSIX)).toBeNull()
    expect(parseProjectPath('/etc/passwd', POSIX)).toBeNull()
    expect(parseProjectPath('/home/a/project-other/x.ts', POSIX)).toBeNull()
    expect(parseProjectPath(String.raw`C:\Windows\win.ini`, WINDOWS)).toBeNull()
    expect(parseProjectPath('//server/share/x.ts', WINDOWS)).toBeNull()
  })

  it('collapses . and .. that stay inside', () => {
    expect(parseProjectPath('src/./lib/../app.ts', POSIX)).toEqual({ relativePath: 'src/app.ts' })
  })

  it('leaves prose, commands, options and URLs alone', () => {
    for (const text of ['build', 'README', 'npm run dev', '--force', '-v', '~/x.ts', 'https://example.com/a.ts', '$HOME/a.ts', '', '.', './', 'src/app.ts:0', 'src/app.ts:99999999999']) {
      expect(parseProjectPath(text, POSIX), text).toBeNull()
    }
  })
})

describe('splitPosition', () => {
  it('keeps a Windows drive colon as part of the path', () => {
    expect(splitPosition(String.raw`C:\a.ts`)).toEqual({ path: String.raw`C:\a.ts` })
    expect(splitPosition(String.raw`C:\a.ts:5`)).toEqual({ path: String.raw`C:\a.ts`, line: 5, column: undefined })
  })
})
