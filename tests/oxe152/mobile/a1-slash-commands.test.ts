// Frozen acceptance test for 1.5.2 Celular A1 (OXE program oxespace-152-mobile, phase F1, Jira OXE-20).
// Written by the planner; the executor must not edit it.
// Problem: electron/main/services/remote/text.ts scrubPaths() treats every token starting with "/" as an absolute POSIX
// path, so the phone reads "o comando de … e dou enter" for "/resume" (and /compact, /model, /help…).
// Contract: a token of ONE segment shaped like a slash command (`/` + a letter, then letters, digits, `:`, `_` or `-`,
// no second `/`, no dot) is not a path and stays as it is, unless it is a well-known file-system root (/opt, /tmp,
// /etc, /home, /Users, /var…), which stays hidden, or a registered root, which still becomes `.`. Every path with two
// or more segments is scrubbed exactly as before (tests/unit/remote-text-filters.test.ts stays green unchanged).
import { describe, expect, test } from 'vitest'
import { clean, scrubPaths } from '../../../electron/main/services/remote/text'

const POSIX = ['/work/app']

describe('A1 · slash commands reach the phone as they are (OXE-20)', () => {
  test('/resume in a sentence is kept', () => {
    expect(scrubPaths('o comando de /resume e dou enter', POSIX, 'linux')).toBe('o comando de /resume e dou enter')
    expect(scrubPaths('o comando de /resume e dou enter', ['C:\\work\\app'], 'win32')).toBe('o comando de /resume e dou enter')
  })

  test('other slash commands are kept, with hyphens, digits, underscores and a namespace colon', () => {
    for (const command of ['/compact', '/model', '/help', '/fork-session', '/review_pr', '/oxe-plan', '/skill:deploy', '/v2']) {
      expect(scrubPaths(`run ${command} now`, POSIX, 'linux'), command).toBe(`run ${command} now`)
    }
  })

  test('a command at the start, in quotes, in backticks, in brackets or before punctuation is kept', () => {
    for (const text of ['/resume', 'type "/resume".', 'type `/compact`', '(/model)', 'then /help, and /clear!', 'use /resume:'] as const) {
      expect(scrubPaths(text, POSIX, 'linux'), text).toBe(text)
    }
  })

  test('well-known file-system roots of one segment stay hidden', () => {
    for (const root of ['/opt', '/tmp', '/etc', '/home', '/Users', '/var', '/usr', '/root', '/mnt', '/srv', '/Volumes', '/private']) {
      expect(scrubPaths(`cd ${root}`, POSIX, 'linux'), root).toBe('cd …')
    }
  })

  test('paths with two or more segments are hidden as before, even when the first looks like a command', () => {
    for (const [text, expected] of [
      ['/home/x/y', '…'],
      ['/Users/x', '…'],
      ['open /resume/notes.txt', 'open …'],
      ['ls /compact/a', 'ls …'],
      ['cat /srv/acme/secret.txt', 'cat …'],
      ['/resume.txt', '…']
    ] as const) expect(scrubPaths(text, POSIX, 'linux'), text).toBe(expected)
  })

  test('a registered root of one segment still becomes relative', () => {
    expect(scrubPaths('cd /work', ['/work'], 'linux')).toBe('cd .')
    expect(scrubPaths('see /work/src/a.ts', ['/work'], 'linux')).toBe('see ./src/a.ts')
  })

  test('clean(), which every text sent to the phone goes through, keeps the command and still hides the path', () => {
    const result = clean('I typed /resume in /home/dev/secret', POSIX, 200)
    expect(result.text).toBe('I typed /resume in …')
    expect(result.truncated).toBe(false)
  })
})
