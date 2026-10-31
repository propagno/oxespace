import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SqlTableDetails } from '../shared/types/oxequery'
import { ColumnsTab, ConstraintsTab, IndexesTab } from '../src/components/OxeQuery/StructureParts'
import { draftFromDetails, type StructureDraft } from '../src/components/OxeQuery/structure-model'

const details: SqlTableDetails = {
  columns: [
    { name: 'id', type: 'integer', nullable: false, primaryKey: true, position: 1, identity: 'always' },
    { name: 'email', type: 'text', nullable: false, primaryKey: false, position: 2, default: "''" },
    { name: 'total', type: 'numeric', nullable: true, primaryKey: false, position: 3, generated: '(price * qty)' }
  ],
  indexes: [{ name: 'users_pkey', definition: 'CREATE UNIQUE INDEX users_pkey ON users (id)', unique: true, primary: true }, { name: 'users_email', definition: 'CREATE INDEX users_email ON users (email)', unique: false, primary: false }],
  foreignKeys: [{ name: 'users_org_fk', definition: 'FOREIGN KEY (org) REFERENCES orgs (id)' }],
  constraints: [{ name: 'users_pkey', kind: 'primary', definition: 'PRIMARY KEY (id)' }], dependents: [], privileges: [], properties: null
}

let current: StructureDraft
function Host({ tab }: { tab: 'columns' | 'constraints' | 'indexes' }) {
  const [draft, setDraft] = useState(() => draftFromDetails('users', details))
  current = draft
  const props = { draft, details, onChange: setDraft }
  return tab === 'columns' ? <ColumnsTab {...props} /> : tab === 'constraints' ? <ConstraintsTab {...props} /> : <IndexesTab {...props} />
}
afterEach(() => cleanup())

describe('ColumnsTab', () => {
  it('locks generated columns, and makes identity and default exclusive', () => {
    render(<Host tab="columns" />)
    expect(screen.getByLabelText('Type of total')).toBeDisabled()
    expect(screen.getByLabelText('total is not null')).toBeDisabled()
    expect(screen.getByTitle('Generated column')).toHaveTextContent('= (price * qty)')
    expect(screen.getByLabelText('Default of email')).not.toBeDisabled()
    expect(screen.getByLabelText('Identity of email')).toBeDisabled()
    expect(screen.getByLabelText('Default of id')).toBeDisabled()
  })

  it('edits a column, adds one, removes the added one and marks an existing one to drop', () => {
    render(<Host tab="columns" />)
    fireEvent.change(screen.getByLabelText('Name of email'), { target: { value: 'mail' } })
    fireEvent.change(screen.getByLabelText('Type of email'), { target: { value: 'varchar(255)' } })
    fireEvent.click(screen.getByLabelText('email is not null'))
    expect(current.rows[1]).toMatchObject({ name: 'mail', type: 'varchar(255)', nullable: true })
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }))
    expect(current.rows).toHaveLength(4)
    fireEvent.change(screen.getByLabelText('Name of new column'), { target: { value: 'age' } })
    fireEvent.change(screen.getByLabelText('Identity of age'), { target: { value: 'by-default' } })
    expect(current.rows[3]).toMatchObject({ name: 'age', identity: 'by-default' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove age' }))
    expect(current.rows).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Drop mail'.replace('mail', 'email') }))
    expect(current.rows[1]?.removed).toBe(true)
    expect(screen.getByLabelText('Name of email')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep email' }))
    expect(current.rows[1]?.removed).toBe(false)
  })
})

describe('ConstraintsTab', () => {
  it('lists the existing constraints and foreign keys and toggles a drop', () => {
    render(<Host tab="constraints" />)
    const list = screen.getByRole('list', { name: 'Constraints' })
    expect(list).toHaveTextContent('PRIMARY KEY (id)')
    expect(list).toHaveTextContent('users_org_fk')
    fireEvent.click(screen.getByRole('button', { name: 'Drop users_org_fk' }))
    expect(current.droppedConstraints).toEqual(['users_org_fk'])
    fireEvent.click(screen.getByRole('button', { name: 'Keep users_org_fk' }))
    expect(current.droppedConstraints).toEqual([])
  })

  it('adds a unique, a check and a foreign key, and removes one', () => {
    render(<Host tab="constraints" />)
    const add = (): void => fireEvent.click(screen.getByRole('button', { name: 'Add constraint' }))
    fireEvent.change(screen.getByLabelText('Columns'), { target: { value: 'email, id' } })
    fireEvent.change(screen.getByLabelText('Name (optional)'), { target: { value: 'uq_email' } })
    add()
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'check' } })
    fireEvent.change(screen.getByLabelText('Expression'), { target: { value: 'id > 0' } })
    add()
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'foreign' } })
    fireEvent.change(screen.getByLabelText('Columns'), { target: { value: 'org' } })
    fireEvent.change(screen.getByLabelText('References table'), { target: { value: 'orgs' } })
    fireEvent.change(screen.getByLabelText('References columns'), { target: { value: 'id' } })
    fireEvent.change(screen.getByLabelText('On delete'), { target: { value: 'cascade' } })
    add()
    expect(current.addedConstraints).toEqual([
      { kind: 'unique', name: 'uq_email', columns: ['email', 'id'] },
      { kind: 'check', expression: 'id > 0' },
      { kind: 'foreign', columns: ['org'], refSchema: 'public', refTable: 'orgs', refColumns: ['id'], onDelete: 'cascade', onUpdate: 'no action' }
    ])
    const list = screen.getByRole('list', { name: 'Constraints' })
    expect(list).toHaveTextContent('UNIQUE (email, id)')
    expect(list).toHaveTextContent('CHECK (id > 0)')
    expect(list).toHaveTextContent('FOREIGN KEY (org) → public.orgs (id)')
    fireEvent.click(within(list).getByRole('button', { name: 'Remove new constraint 2' }))
    expect(current.addedConstraints).toHaveLength(2)
  })
})

describe('IndexesTab', () => {
  it('lists the indexes that are not keys, and toggles a drop', () => {
    render(<Host tab="indexes" />)
    const list = screen.getByRole('list', { name: 'Indexes' })
    expect(list).toHaveTextContent('users_email')
    expect(list).not.toHaveTextContent('users_pkey')
    fireEvent.click(screen.getByRole('button', { name: 'Drop users_email' }))
    expect(current.droppedIndexes).toEqual(['users_email'])
    fireEvent.click(screen.getByRole('button', { name: 'Keep users_email' }))
    expect(current.droppedIndexes).toEqual([])
  })

  it('adds a partial unique index with its method, and removes it', () => {
    render(<Host tab="indexes" />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'idx_live' } })
    fireEvent.change(screen.getByLabelText('Columns'), { target: { value: 'email' } })
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'gin' } })
    fireEvent.change(screen.getByLabelText('Only rows where (optional)'), { target: { value: 'deleted_at IS NULL' } })
    fireEvent.click(screen.getByLabelText('Unique'))
    fireEvent.click(screen.getByRole('button', { name: 'Add index' }))
    expect(current.addedIndexes).toEqual([{ name: 'idx_live', columns: ['email'], unique: true, method: 'gin', where: 'deleted_at IS NULL' }])
    expect(screen.getByRole('list', { name: 'Indexes' })).toHaveTextContent('UNIQUE idx_live (email) USING gin WHERE deleted_at IS NULL')
    fireEvent.click(screen.getByRole('button', { name: 'Remove new index 1' }))
    expect(current.addedIndexes).toEqual([])
    expect(screen.getByRole('list', { name: 'Indexes' })).toBeInTheDocument()
  })
})
