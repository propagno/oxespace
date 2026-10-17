import { describe, expect, it } from 'vitest'
import { SQL_SNIPPETS, formatSql } from '../../src/components/OxeQuery/sql-snippets'

describe('SQL snippets and formatter', () => {
  it('has unique labels and balanced tab stops', () => {
    expect(new Set(SQL_SNIPPETS.map(snippet => snippet.label)).size).toBe(SQL_SNIPPETS.length)
    for (const snippet of SQL_SNIPPETS) {
      expect((snippet.body.match(/\$\{/g) ?? []).length).toBe((snippet.body.match(/\$\{[^}]*\}/g) ?? []).length)
    }
  })

  it('formats a statement with upper-case keywords and leaves unparseable text alone', async () => {
    const formatted = await formatSql('select a,b from t where x=1 and y in (1,2)')
    expect(formatted).toContain('SELECT')
    expect(formatted).toContain('\nFROM')
    expect(formatted.split('\n').length).toBeGreaterThan(3)
    expect(await formatSql('select $$ unterminated')).toBeTruthy()
  })
})
