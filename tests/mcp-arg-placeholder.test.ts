// OXE-356 (HML round 2): the MCP form's placeholder check had `s` where `\s` was meant, so it let `<postgres-url>`,
// `<secret>`, `<host>` and `<user>` through (they contain an "s"), and the server broke at run time.
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { firstArgPlaceholder } from '../src/components/MCP/mcpArgPlaceholder'

describe('OXE-356 · MCP arguments with a placeholder left in', () => {
  test.each(['<postgres-url>', '<secret>', '<host>', '<user>', '<api-key>', '<path>'])('%s is refused', value => {
    expect(firstArgPlaceholder(`--connection ${value} --read-only`)).toBe(value)
  })

  test('real arguments pass, including a comparison or redirection with spaces', () => {
    for (const args of ['--port 5432 --host db.internal', 'postgres://user:pw@localhost/db', 'node server.js', 'a < b > c', '']) {
      expect(firstArgPlaceholder(args), args).toBeNull()
    }
  })

  test('the form uses the shared check, not its own pattern', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/MCP/McpPanel.tsx'), 'utf8')
    expect(source).toContain('firstArgPlaceholder(argsText)')
    expect(source).not.toMatch(/\/<\[\^<>s\]\+>\//)
  })
})
