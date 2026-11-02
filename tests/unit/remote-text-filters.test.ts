import { describe, expect, test } from 'vitest'
import { clean, cut, longestMatch, redactCounted, relativeTo, scrubPaths, TERMINAL_SECRET_WINDOW, TerminalWindow, underRoot } from '../../electron/main/services/remote/text'
import { REMOTE_TEXT_LIMITS } from '../../shared/remote/protocol'
import { SECRET_PATTERNS } from '../../shared/secrets'

const WIN = ['C:\\Users\\dev\\proj', 'c:\\work\\app']
const POSIX = ['/work/app', '/home/dev/proj']

describe('remote paths: relative under a registered root, `…` anywhere else', () => {
  test('a path inside a registered root becomes relative, by the app\'s separator and case rules', () => {
    expect(scrubPaths('at C:\\Users\\dev\\proj\\src\\a.ts and c:/users/dev/proj', WIN, 'win32')).toBe('at ./src/a.ts and .')
    expect(scrubPaths('PS C:\\Users\\dev\\proj\\src> ', WIN, 'win32')).toBe('PS ./src> ')
    expect(scrubPaths('"C:\\\\Users\\\\dev\\\\proj\\\\x.json"', WIN, 'win32')).toBe('"./x.json"')
    expect(scrubPaths('see /work/app/src/x.ts, and /work/app.', POSIX, 'linux')).toBe('see ./src/x.ts, and ..')
    // Case folds only where the file system folds it.
    expect(scrubPaths('/WORK/app/x', POSIX, 'linux')).toBe('…')
    expect(scrubPaths('/WORK/app/x', POSIX, 'darwin')).toBe('./x')
  })

  test('a path that only shares a prefix with a root is not inside it', () => {
    expect(scrubPaths('/work/app-other/secret.txt and /work/apple', POSIX, 'linux')).toBe('… and …')
    expect(scrubPaths('C:\\work\\app2\\x', WIN, 'win32')).toBe('…')
    expect(underRoot('/work/app-other', POSIX, 'linux')).toBeUndefined()
    expect(underRoot('/work/app/../other', POSIX, 'linux')).toBeUndefined()
  })

  test('any other absolute path is replaced: unusual POSIX dirs, other drives, UNC, home and file URLs', () => {
    for (const [text, expected] of [
      ['cat /srv/acme/secret.txt', 'cat …'],
      ['ls /zzz/a', 'ls …'],
      ['/opt', '…'],
      ['open D:\\backup\\keys.txt now', 'open … now'],
      ['e:/data/x', '…'],
      ['copy \\\\fileserver\\share\\plans.docx', 'copy …'],
      ['mount //nas/media/x', 'mount …'],
      ['~/.ssh/id_rsa and ~bob/notes', '… and …'],
      ['file:///C:/Users/dev/x and FILE://host/y', '… and …'],
      ['PATH=/usr/local/bin:/zzz/bin', 'PATH=…'],
      ['2>/dev/null', '2>…'],
      ['("/var/lib/x")', '("…")'],
      ['\u001b[34m/srv/acme\u001b[0m', '\u001b[34m…\u001b[0m'],
      ['\u001b[1mD:\\x\u001b[0m', '\u001b[1m…\u001b[0m']
    ] as const) expect(scrubPaths(text, POSIX, 'linux'), text).toBe(expected)
  })

  test('relative paths, URLs and slashes inside words are left alone', () => {
    expect(scrubPaths('a/b/c and ./rel and ../up and https://example.com/home/x and 50/50 and a / b and </div>', [], 'linux'))
      .toBe('a/b/c and ./rel and ../up and https://example.com/home/x and 50/50 and a / b and </div>')
  })

  test('request cwd and paths: relative to the conversation root, or nothing', () => {
    expect(relativeTo('C:\\R', 'c:\\r\\pkg\\a', 'win32')).toBe('pkg/a')
    expect(relativeTo('/r', '/r', 'linux')).toBe('.')
    expect(relativeTo('/r', '/r/../x', 'linux')).toBeUndefined()
    expect(relativeTo('/r', '/r-other/x', 'linux')).toBeUndefined()
    expect(relativeTo('/r', '/other', 'linux')).toBeUndefined()
    expect(relativeTo('/r', 'src/x', 'linux')).toBe('src/x')
    expect(relativeTo('/r', '../x', 'linux')).toBeUndefined()
  })
})

describe('remote redaction', () => {
  test('the redactor\'s replacements are counted; cuts never split a surrogate pair', () => {
    expect(redactCounted(`a ghp_${'a'.repeat(36)} b sk-ant-${'b'.repeat(20)} [redacted]`)).toEqual({ text: 'a [redacted] b [redacted] [redacted]', redacted: 2 })
    expect(cut('ab😀', 3)).toEqual({ text: 'ab', truncated: true })
  })

  test('the terminal window is the longest secret the redactor knows, computed from its patterns', () => {
    expect(longestMatch(/ab{2,5}c?/, 100)).toBe(7)
    expect(longestMatch(/\bnpm_[A-Za-z0-9]{36}\b/g, 100)).toBe(40)
    expect(longestMatch(/(?:x|yyy)z+(?=q)/, 10)).toBe(13)
    expect(TERMINAL_SECRET_WINDOW).toBe(Math.max(...SECRET_PATTERNS.map(pattern => longestMatch(pattern, REMOTE_TEXT_LIMITS.terminalChunk))))
    // A JWT and a private key block are open-ended: the window covers at least a terminal chunk of each.
    expect(TERMINAL_SECRET_WINDOW).toBeGreaterThan(REMOTE_TEXT_LIMITS.terminalChunk)
  })
})

describe('remote terminal window', () => {
  const filter = (text: string) => { const out = clean(text, POSIX, Number.MAX_SAFE_INTEGER); return { text: out.text, redacted: out.redacted } }
  const SECRET = `sk-ant-${'k'.repeat(40)}`

  test('a token split across two batches is redacted, whatever the window', () => {
    for (const window of [TERMINAL_SECRET_WINDOW, 64]) {
      const terminal = new TerminalWindow(filter, window)
      const first = terminal.take(`${'line\r\n'.repeat(30)}key ${SECRET.slice(0, 20)}`)
      const second = terminal.take(`${SECRET.slice(20)} done\r\n`)
      const rest = terminal.flush()
      const out = first.text + second.text + rest.text
      expect(out, String(window)).toBe(`${'line\r\n'.repeat(30)}key [redacted] done\r\n`)
      expect(out).not.toContain(SECRET.slice(20, 40))
      expect(first.redacted + second.redacted + rest.redacted).toBe(1)
    }
  })

  test('output with no secret comes out whole, in order, once', () => {
    const terminal = new TerminalWindow(filter, 16)
    const batches = Array.from({ length: 200 }, (_, index) => `${index}: ${'x'.repeat(index % 23)}${index % 7 ? ' ' : '\r\n'}`)
    let out = ''
    for (const batch of batches) out += terminal.take(batch).text
    expect(terminal.heldLength).toBeLessThanOrEqual(16 + 40)
    out += terminal.flush().text
    expect(out).toBe(batches.join(''))
    expect(terminal.heldLength).toBe(0)
  })

  test('a path cut by a batch is still seen whole', () => {
    const terminal = new TerminalWindow(filter, 12)
    const out = terminal.take('ok cat /srv/ac').text + terminal.take('me/secret.txt now done here\r\n').text + terminal.flush().text
    expect(out).toBe('ok cat … now done here\r\n')
  })
})
