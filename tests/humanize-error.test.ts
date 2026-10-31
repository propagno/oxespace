import { describe, expect, it } from 'vitest'
import { errorText, humanizeError } from '../src/utils/humanizeError'

describe('humanizeError', () => {
  it('strips the Electron IPC wrapper and the error name', () => {
    const cause = new Error("Error invoking remote method 'thread:send': Error: Finish the active turn before applying configuration")
    expect(errorText(cause)).toBe('Finish the active turn before applying configuration')
    expect(humanizeError(cause)).toBe('Finish the active turn before applying configuration')
    expect(humanizeError(new Error("Error invoking remote method 'x': TypeError: bad input"))).toBe('bad input')
  })

  it('turns common system failures into plain sentences', () => {
    expect(humanizeError(new Error('spawn gh ENOENT'))).toBe('gh was not found. Install it or add it to your PATH, then try again.')
    expect(humanizeError(new Error("ENOENT: no such file or directory, open 'C:\\repo\\a.txt'"))).toBe('C:\\repo\\a.txt does not exist.')
    expect(humanizeError(new Error("EACCES: permission denied, open '/etc/x'"))).toBe('No permission to use /etc/x.')
    expect(humanizeError(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toContain('connection was refused')
    expect(humanizeError(new Error('getaddrinfo ENOTFOUND api.github.com'))).toContain('could not be resolved')
    expect(humanizeError(new Error('fetch failed'))).toContain('Could not connect')
    expect(humanizeError(new Error('Request failed with status code 401'))).toContain('Sign in again')
    expect(humanizeError(new Error('HTTP 429 Too Many Requests'))).toContain('Too many requests')
    expect(humanizeError(new Error('SQLITE_BUSY: database is locked'))).toContain('database is busy')
    expect(humanizeError(new Error('fatal: not a git repository (or any of the parent directories): .git'))).toBe('This folder is not a Git repository.')
  })

  it('leaves unrelated numbers alone', () => {
    expect(humanizeError(new Error('Unexpected token at line 401'))).toBe('Unexpected token at line 401')
  })

  it('keeps the first line, bounds its length and falls back when there is no text', () => {
    expect(humanizeError(new Error('First line\n    at stack frame'))).toBe('First line')
    expect(humanizeError(new Error('x'.repeat(500)))).toHaveLength(300)
    expect(humanizeError(undefined, 'Could not save the file.')).toBe('Could not save the file.')
    expect(humanizeError(new Error(''), 'Could not save the file.')).toBe('Could not save the file.')
    expect(humanizeError('plain string')).toBe('plain string')
    expect(humanizeError({ message: 'from an object' })).toBe('from an object')
  })
})
