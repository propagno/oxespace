import { describe, expect, it } from 'vitest'
import { sqlNotes, sqlRisk } from '../../electron/main/services/oxequery/sql-approval'
import { guardSql } from '../../electron/main/services/oxequery/sql-guard'
import type { SqlGuardVerdict } from '../../shared/types/oxequery'

/** A verdict carrying the classifier's C3 codes (SQL risk reasons, #237), whichever lands first. */
const withCodes = (kind: SqlGuardVerdict['kind'], ...codes: string[]): SqlGuardVerdict => ({ kind, reasons: [], statements: 1, codes: codes.map(code => ({ code, params: {} })) } as SqlGuardVerdict)

describe('SQL risk in the approval modal (B10)', () => {
  it('grades a DO block or a CALL high, though the classifier calls it a write', () => {
    expect(sqlRisk(withCodes('write', 'oxequery.sql.doBlock'), false)).toBe('high')
    expect(sqlRisk(withCodes('write', 'oxequery.sql.callProcedure'), false)).toBe('high')
    expect(sqlRisk(withCodes('write', 'oxequery.sql.doBlock'), true)).toBe('critical')
  })

  it('keeps a destructive DO critical and a plain write medium', () => {
    expect(sqlRisk(withCodes('destructive', 'oxequery.sql.doBlock', 'oxequery.sql.destructiveInside'), false)).toBe('critical')
    expect(sqlRisk(guardSql('UPDATE t SET a = 1 WHERE id = 2'), false)).toBe('medium')
    expect(sqlRisk(withCodes('write', 'oxequery.sql.rowLock'), false)).toBe('medium')
  })

  it('leaves the classifier alone, so OxeQuery\'s own confirmation still reads its kind', () => {
    expect(guardSql('DO $$ BEGIN PERFORM 1; END $$').kind).toBe('write')
    expect(guardSql('CALL refresh_totals()').kind).toBe('write')
    expect(guardSql('/* read only */ DROP TABLE orders').kind).toBe('destructive')
  })

  it('turns the plain reasons into the app\'s notes and keeps the classifier\'s own codes', () => {
    expect(sqlNotes(guardSql('-- read only, safe\nDROP TABLE orders'))).toEqual([{ code: 'approvals.note.sql.removes', params: { statement: 'DROP' } }])
    expect(sqlNotes(guardSql('DELETE FROM orders'))).toEqual([{ code: 'approvals.note.sql.noWhere', params: { statement: 'DELETE' } }])
    expect(sqlNotes(guardSql("SELECT pg_read_file('/etc/passwd')"))).toContainEqual({ code: 'approvals.note.sql.outsideReach', params: { calls: ['pg_read_file'] } })
    expect(sqlNotes(withCodes('write', 'oxequery.sql.doBlock'))).toEqual([{ code: 'oxequery.sql.doBlock', params: {} }])
    expect(sqlNotes(guardSql('SELECT 1'))).toEqual([])
  })
})
