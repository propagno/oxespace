import { describe, expect, it } from 'vitest'
import { MAX_CHANGES, buildStatements, previewStatements, type ColumnMeta } from '../../electron/main/services/oxequery/table-editor'

const columns: ColumnMeta[] = [
  { name: 'id', type: 'integer', nullable: false, hasDefault: true, generated: false, key: true },
  { name: 'email', type: 'character varying(255)', nullable: false, hasDefault: false, generated: false, key: false },
  { name: 'note', type: 'text', nullable: true, hasDefault: false, generated: false, key: false },
  { name: 'tags', type: 'text[]', nullable: true, hasDefault: false, generated: false, key: false },
  { name: 'total', type: 'numeric', nullable: true, hasDefault: false, generated: true, key: false }
]

describe('table editor statements', () => {
  it('builds a parameterised update with the key and the old values', () => {
    const [statement] = buildStatements('public', 'users', columns, [{ kind: 'update', key: { id: 7 }, set: { email: 'new@example.com', note: null }, old: { id: 7, email: 'old@example.com', note: 'x' } }])
    expect(statement.text).toBe('UPDATE "public"."users" SET "email" = $1::character varying(255), "note" = $2::text WHERE "id" = $3::integer AND "email" IS NOT DISTINCT FROM $4::character varying(255) AND "note" IS NOT DISTINCT FROM $5::text')
    expect(statement.values).toEqual(['new@example.com', null, '7', 'old@example.com', 'x'])
    expect(statement.expectRows).toBe(1)
  })

  it('never puts a value or an identifier into the text unquoted', () => {
    const nasty = "x'; DROP TABLE users; --"
    const [statement] = buildStatements('public', 'users', columns, [{ kind: 'insert', values: { email: nasty } }])
    expect(statement.text).not.toContain('DROP')
    expect(statement.values).toEqual([nasty])
    const [quoted] = buildStatements('we"ird', 'ta"ble', columns, [{ kind: 'delete', key: { id: 1 } }])
    expect(quoted.text).toBe('DELETE FROM "we""ird"."ta""ble" WHERE "id" = $1::integer')
  })

  it('serialises json and arrays as text for the server to cast', () => {
    const [statement] = buildStatements('public', 'users', columns, [{ kind: 'insert', values: { email: 'a@b.c', tags: ['a', 'b'] } }])
    expect(statement.values).toEqual(['a@b.c', '["a","b"]'])
  })

  it('refuses edits that cannot be right', () => {
    expect(() => buildStatements('public', 'users', columns, [])).toThrow(/no changes/)
    expect(() => buildStatements('public', 'users', columns, [{ kind: 'update', key: { id: 1 }, set: { nope: 'x' } }])).toThrow(/no column "nope"/)
    expect(() => buildStatements('public', 'users', columns, [{ kind: 'update', key: { id: 1 }, set: { total: '5' } }])).toThrow(/generated/)
    expect(() => buildStatements('public', 'users', columns, [{ kind: 'update', key: { email: 'a' }, set: { note: 'x' } }])).toThrow(/identified by "id"/)
    expect(() => buildStatements('public', 'users', columns, [{ kind: 'update', key: { id: null }, set: { note: 'x' } }])).toThrow(/cannot be NULL/)
    expect(() => buildStatements('public', 'users', columns, [{ kind: 'update', key: { id: 1 }, set: {} }])).toThrow(/sets no column/)
    expect(() => buildStatements('public', 'users', columns.map(column => ({ ...column, key: false })), [{ kind: 'delete', key: {} }])).toThrow(/no primary key/)
    expect(() => buildStatements('public', 'users', columns, Array.from({ length: MAX_CHANGES + 1 }, () => ({ kind: 'delete' as const, key: { id: 1 } })))).toThrow(/At most/)
  })

  it('does not trust a column type that is not a plain type name', () => {
    const hostile = columns.map(column => column.name === 'note' ? { ...column, type: 'text); DROP TABLE users; --' } : column)
    expect(() => buildStatements('public', 'users', hostile, [{ kind: 'insert', values: { note: 'x' } }])).toThrow(/cannot write safely/)
  })

  it('previews values for reading only', () => {
    const statements = buildStatements('public', 'users', columns, [{ kind: 'update', key: { id: 3 }, set: { note: "it's" } }, { kind: 'insert', values: { email: 'a@b.c', note: null } }])
    expect(previewStatements(statements)).toEqual([
      `UPDATE "public"."users" SET "note" = 'it''s'::text WHERE "id" = '3'::integer;`,
      `INSERT INTO "public"."users" ("email", "note") VALUES ('a@b.c'::character varying(255), NULL::text);`
    ])
  })

  it('inserts defaults when no values are given', () => {
    expect(buildStatements('public', 'users', columns, [{ kind: 'insert', values: {} }])[0].text).toBe('INSERT INTO "public"."users" DEFAULT VALUES')
  })
})
