import { describe, expect, it } from 'vitest'
import { redactSecrets } from '../shared/secrets'

describe('redactSecrets', () => {
  it('removes tokens recognized by their prefix', () => {
    const samples = [
      'sk-ant-api03-' + 'a'.repeat(40), 'sk-proj-' + 'B'.repeat(30), 'ghp_' + 'c'.repeat(36), 'github_pat_' + 'd'.repeat(40),
      'glpat-' + 'e'.repeat(20), 'xoxb-1234567890-abcdef', 'AIza' + 'f'.repeat(35), 'AKIA' + 'G'.repeat(16),
      'sk_live_' + 'h'.repeat(24), 'npm_' + 'i'.repeat(36), 'lin_api_' + 'j'.repeat(40),
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    ]
    for (const secret of samples) expect(redactSecrets(`token in the middle ${secret} of a line`)).toBe('token in the middle [redacted] of a line')
  })

  it('keeps the name of a named secret and removes its value', () => {
    expect(redactSecrets('password=hunter2 user=me')).toBe('password=[redacted] user=me')
    expect(redactSecrets('{"api_key": "abc123", "name": "x"}')).toBe('{"api_key": [redacted], "name": "x"}')
    expect(redactSecrets('Authorization: Bearer abc.def.ghi-jkl')).toBe('Authorization: [redacted]')
    expect(redactSecrets('curl -H "x" --token=s3cr3t')).toBe('curl -H "x" --token=[redacted]')
  })

  it('removes a password from a URL but keeps the user and the host', () => {
    expect(redactSecrets('postgres://app:pa55word@db.local:5432/app')).toBe('postgres://app:[redacted]@db.local:5432/app')
    expect(redactSecrets('https://user:tok@github.com/o/r.git')).toBe('https://user:[redacted]@github.com/o/r.git')
  })

  it('removes a private key block whole', () => {
    const key = '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\nBBBB\n-----END OPENSSH PRIVATE KEY-----'
    expect(redactSecrets(`before\n${key}\nafter`)).toBe('before\n[redacted]\nafter')
  })

  it('leaves ordinary text alone', () => {
    const text = 'Ran npm test: 42 passed. The tokenizer splits words; skip-list and task-runner are fine. See https://example.com/a?b=1'
    expect(redactSecrets(text)).toBe(text)
  })
})

describe('log redaction', () => {
  it('removes secrets from strings and errors before electron-log writes them', async () => {
    const { redactLogMessage } = await import('../electron/main/services/log-redaction')
    const error = new Error('connect failed for postgres://app:pa55word@db/app')
    const message = redactLogMessage({ data: ['[mcp] token=abc123', error, 42], date: new Date(), level: 'info' } as never)
    expect(message.data[0]).toBe('[mcp] token=[redacted]')
    expect((message.data[1] as Error).message).toBe('connect failed for postgres://app:[redacted]@db/app')
    expect(message.data[2]).toBe(42)
  })
})
