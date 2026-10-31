import { describe, expect, it } from 'vitest'
import type { SqlTableDetails } from '../../shared/types/oxequery'
import { changesFromDraft, createFromDraft, draftFromDetails, draftProblems, emptyDraft, newColumnRow, standaloneIndexes } from '../../src/components/OxeQuery/structure-model'

const details: SqlTableDetails = {
  columns: [
    { name: 'id', type: 'integer', nullable: false, primaryKey: true, position: 1, identity: 'always' },
    { name: 'email', type: 'text', nullable: false, primaryKey: false, position: 2 },
    { name: 'legacy', type: 'text', nullable: true, primaryKey: false, position: 3 },
    { name: 'total', type: 'numeric', nullable: true, primaryKey: false, position: 4, generated: 'price * 2' }
  ],
  indexes: [{ name: 'users_pkey', definition: '', unique: true, primary: true }, { name: 'users_email_key', definition: '', unique: true, primary: false }, { name: 'users_name', definition: '', unique: false, primary: false }],
  foreignKeys: [],
  dependents: [],
  privileges: [],
  constraints: [{ name: 'users_pkey', kind: 'primary', definition: 'PRIMARY KEY (id)' }, { name: 'users_email_key', kind: 'unique', definition: 'UNIQUE (email)' }],
  properties: { kind: 'table', owner: 'oxe', sizeBytes: 8192, estimatedRows: 3, comment: 'people' }
}

describe('diffing the draft against the table', () => {
  it('produces nothing when nothing was touched', () => {
    expect(changesFromDraft(draftFromDetails('users', details), 'users', 'people')).toEqual([])
  })

  it('orders drops, renames, alters and adds, and ignores generated columns', () => {
    const draft = draftFromDetails('users', details)
    draft.rows[1]!.name = 'mail'
    draft.rows[1]!.type = 'varchar(200)'
    draft.rows[1]!.default = "''"
    draft.rows[2]!.removed = true
    draft.rows[3]!.type = 'text'
    draft.rows.push(newColumnRow({ name: 'age', type: 'int' }))
    draft.droppedIndexes.push('users_name')
    draft.addedIndexes.push({ name: 'users_mail', columns: ['mail'] })
    draft.tableName = 'people'
    draft.comment = 'changed'
    expect(changesFromDraft(draft, 'users', 'people')).toEqual([
      { op: 'dropIndex', name: 'users_name' },
      { op: 'dropColumn', name: 'legacy' },
      { op: 'renameColumn', from: 'email', to: 'mail' },
      { op: 'alterColumn', name: 'mail', type: 'varchar(200)', default: "''" },
      { op: 'addColumn', column: { name: 'age', type: 'int', nullable: true } },
      { op: 'addIndex', index: { name: 'users_mail', columns: ['mail'] } },
      { op: 'setComment', comment: 'changed' },
      { op: 'renameTable', to: 'people' }
    ])
  })

  it('turns an identity off with null and a cleared default into a drop', () => {
    const draft = draftFromDetails('users', { ...details, columns: [{ ...details.columns[0]!, default: 'nextval(x)' }] })
    draft.rows[0]!.identity = ''
    draft.rows[0]!.default = ''
    expect(changesFromDraft(draft, 'users', 'people')).toEqual([{ op: 'alterColumn', name: 'id', default: null, identity: null }])
  })
})

describe('validation and create', () => {
  it('reports what a person must fix', () => {
    const draft = emptyDraft()
    draft.rows.push(newColumnRow({ name: 'id' }), newColumnRow({ name: '' }))
    draft.addedConstraints.push({ kind: 'check', expression: ' ' }, { kind: 'foreign', columns: ['id'], refSchema: 'public', refTable: '', refColumns: [] })
    const problems = draftProblems(draft, true)
    expect(problems).toEqual(expect.arrayContaining(['Give the table a name.', 'Two columns are called "id".', 'Every column needs a name.', 'A check constraint needs an expression.', 'A foreign key needs the table and columns it points to.']))
  })

  it('builds the create definition from live columns only', () => {
    const draft = emptyDraft()
    draft.tableName = 'items'
    draft.rows.push(newColumnRow({ name: 'gone', removed: true }), newColumnRow({ name: 'sku', nullable: false, default: "'x'" }))
    expect(createFromDraft(draft)).toEqual({
      columns: [{ name: 'id', type: 'bigint', nullable: false, identity: 'always' }, { name: 'sku', type: 'text', nullable: false, default: "'x'" }],
      constraints: [{ kind: 'primary', columns: ['id'] }]
    })
    expect(draftProblems(draft, true)).toEqual([])
  })

  it('lists only indexes that no constraint owns', () => {
    expect(standaloneIndexes(details).map(index => index.name)).toEqual(['users_name'])
  })
})
