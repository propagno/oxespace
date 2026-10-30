import { describe, expect, it } from 'vitest'
import { evaluatePolicy, parsePolicy, type LoadedPolicy } from '../../shared/policy'
import { DEFAULT_ENVIRONMENT_LIMITS, dbWriteResource, effectiveSafety, nameMatches } from '../../shared/oxequerySafety'
import { capRows, checkWrite, guardConnection, writeDenied, type PolicyReader } from '../../electron/main/services/oxequery/oxequery-guard'
import { DEFAULT_PREFERENCES, PreferenceInputError, normalizePreferences } from '../../electron/main/services/oxequery/preferences'
import { OxeQueryError, type ResolvedConnection } from '../../electron/main/services/oxequery/oxequery-errors'

const resolved = (overrides: Partial<ResolvedConnection> = {}): ResolvedConnection => ({
  id: 'c1', engine: 'postgres', host: 'db', port: 5432, database: 'app', username: 'me', sslMode: 'disable',
  readOnly: false, environment: 'prod', statementTimeoutMs: 60_000, maxRows: 500, ...overrides
})

function policy(...rules: Array<{ effect: 'allow' | 'deny'; resource: string }>): PolicyReader {
  const loaded: LoadedPolicy = { sources: [{ layer: 'managed', path: 'm', organization: 'Acme', rules: rules.map(rule => ({ ...rule, action: 'db.write' as const })) }], problems: [] }
  return { decide: (action, resource) => evaluatePolicy(loaded, action, resource) }
}

describe('effective safety', () => {
  const base = { readOnly: false, maxRows: 500, statementTimeoutMs: 60_000 }

  it('holds production to 1,000 rows and 30 seconds by default and leaves the other kinds alone', () => {
    expect(effectiveSafety({ ...base, environment: 'prod' }, DEFAULT_ENVIRONMENT_LIMITS, false)).toMatchObject({ maxRows: 500, maxRowsCeiling: 1000, statementTimeoutMs: 30_000, typedConfirmation: true })
    expect(effectiveSafety({ ...base, environment: 'prod', maxRows: 50_000 }, DEFAULT_ENVIRONMENT_LIMITS, false).maxRows).toBe(1000)
    for (const environment of ['local', 'dev'] as const) {
      expect(effectiveSafety({ ...base, environment, maxRows: 50_000, statementTimeoutMs: 600_000 }, DEFAULT_ENVIRONMENT_LIMITS, false))
        .toEqual({ readOnly: false, readOnlyBy: null, typedConfirmation: false, maxRows: 50_000, maxRowsCeiling: 100_000, statementTimeoutMs: 600_000 })
    }
  })

  it('never raises a connection above its own values', () => {
    const safety = effectiveSafety({ ...base, environment: 'prod', maxRows: 100, statementTimeoutMs: 5000 }, DEFAULT_ENVIRONMENT_LIMITS, false)
    expect(safety).toMatchObject({ maxRows: 100, statementTimeoutMs: 5000 })
  })

  it('applies ceilings chosen for any environment', () => {
    const limits = { ...DEFAULT_ENVIRONMENT_LIMITS, dev: { maxRows: 200, statementTimeoutMs: 10_000 } }
    expect(effectiveSafety({ ...base, environment: 'dev' }, limits, false)).toMatchObject({ maxRows: 200, maxRowsCeiling: 200, statementTimeoutMs: 10_000, typedConfirmation: false })
  })

  it('says who made the connection read-only, and policy has the last word', () => {
    expect(effectiveSafety({ ...base, environment: 'dev', readOnly: true }, DEFAULT_ENVIRONMENT_LIMITS, false)).toMatchObject({ readOnly: true, readOnlyBy: 'connection' })
    expect(effectiveSafety({ ...base, environment: 'dev' }, DEFAULT_ENVIRONMENT_LIMITS, true)).toMatchObject({ readOnly: true, readOnlyBy: 'policy' })
    expect(effectiveSafety({ ...base, environment: 'dev', readOnly: true }, DEFAULT_ENVIRONMENT_LIMITS, true).readOnlyBy).toBe('policy')
  })
})

describe('typed connection name', () => {
  it('matches the name exactly, ignoring only surrounding space', () => {
    expect(nameMatches('Shop prod', 'Shop prod')).toBe(true)
    expect(nameMatches('  Shop prod \n', 'Shop prod')).toBe(true)
    expect(nameMatches('shop prod', 'Shop prod')).toBe(false)
    expect(nameMatches('Shop', 'Shop prod')).toBe(false)
    expect(nameMatches('', '')).toBe(false)
    expect(nameMatches(undefined, 'Shop prod')).toBe(false)
    expect(nameMatches(true, 'Shop prod')).toBe(false)
  })
})

describe('write guard', () => {
  const guarded = (overrides: Partial<ResolvedConnection> = {}, rules: Parameters<typeof policy> = []) =>
    guardConnection(resolved(overrides), 'Shop prod', DEFAULT_ENVIRONMENT_LIMITS, policy(...rules))

  it('asks a production connection for its name before any statement that changes data', () => {
    const connection = guarded()
    for (const sql of ['INSERT INTO t VALUES (1)', 'UPDATE t SET a = 1 WHERE id = 1', 'DELETE FROM t WHERE id = 1', 'CREATE TABLE x (id int)', 'DROP TABLE x', 'TRUNCATE t', 'ALTER TABLE t ADD COLUMN a int', 'SELECT 1; DELETE FROM t WHERE id = 1']) {
      try { checkWrite(connection, sql, undefined); throw Error(`${sql} was allowed`) } catch (error) {
        expect(error, sql).toBeInstanceOf(OxeQueryError)
        expect((error as OxeQueryError).code, sql).toBe('confirm-name')
      }
    }
  })

  it('carries the guard reasons so the person sees why', () => {
    expect(() => checkWrite(guarded(), 'DELETE FROM t', undefined)).toThrow(expect.objectContaining({ code: 'confirm-name', reasons: [expect.stringContaining('WHERE')] }))
  })

  it('lets a production write through when the right name is typed', () => {
    expect(() => checkWrite(guarded(), 'DELETE FROM t WHERE id = 1', 'Shop prod')).not.toThrow()
    expect(() => checkWrite(guarded(), 'DROP TABLE t', ' Shop prod ')).not.toThrow()
  })

  it('refuses a wrong or non-text name', () => {
    for (const typed of ['shop prod', 'Shop', '', null, 1, {}, ['Shop prod']]) expect(() => checkWrite(guarded(), 'UPDATE t SET a = 1 WHERE id = 1', typed)).toThrow(expect.objectContaining({ code: 'confirm-name' }))
  })

  it('never asks for the name to read, explain or look at the session', () => {
    for (const sql of ['SELECT * FROM t', 'EXPLAIN SELECT 1', 'SHOW search_path', 'WITH a AS (SELECT 1) SELECT * FROM a', '', '-- just a comment']) expect(() => checkWrite(guarded(), sql, undefined), sql).not.toThrow()
  })

  it('does not ask on other kinds of environment', () => {
    for (const environment of ['local', 'dev'] as const) expect(() => checkWrite(guarded({ environment }), 'DROP TABLE t', undefined)).not.toThrow()
  })

  it('leaves a read-only connection to the worker, which explains it', () => {
    expect(() => checkWrite(guarded({ readOnly: true }), 'DROP TABLE t', undefined)).not.toThrow()
    expect(guarded({ readOnly: true }).connection.readOnly).toBe(true)
  })

  it('makes a connection read-only when policy denies writes to its environment', () => {
    const connection = guarded({ environment: 'prod' }, [{ effect: 'deny', resource: 'prod:*' }])
    expect(connection.connection.readOnly).toBe(true)
    expect(connection.safety).toMatchObject({ readOnly: true, readOnlyBy: 'policy' })
    expect(() => checkWrite(connection, 'UPDATE t SET a = 1 WHERE id = 1', 'Shop prod')).toThrow(expect.objectContaining({ code: 'read-only', message: expect.stringContaining('Acme policy') }))
    expect(() => checkWrite(connection, 'SELECT 1', undefined)).not.toThrow()
  })

  it('keeps policy in force even when the right name is typed', () => {
    const connection = guarded({}, [{ effect: 'deny', resource: 'prod:*' }])
    expect(() => checkWrite(connection, 'DROP TABLE t', 'Shop prod')).toThrow(expect.objectContaining({ code: 'read-only' }))
  })

  it('applies a policy rule to the environment and name it names, and to nothing else', () => {
    const rules = [{ effect: 'deny' as const, resource: 'prod:*' }]
    expect(guarded({ environment: 'dev', readOnly: false }, rules).safety.readOnly).toBe(false)
    expect(guarded({ environment: 'local' }, rules).safety.readOnly).toBe(false)
    const byName = [{ effect: 'deny' as const, resource: '*:Shop prod' }]
    expect(guarded({ environment: 'dev' }, byName).safety.readOnlyBy).toBe('policy')
    expect(guardConnection(resolved({ environment: 'dev' }), 'Other', DEFAULT_ENVIRONMENT_LIMITS, policy(...byName)).safety.readOnly).toBe(false)
    const everything = [{ effect: 'deny' as const, resource: '*' }]
    expect(guarded({ environment: 'local' }, everything).safety.readOnlyBy).toBe('policy')
  })

  it('lets a later allow lift a deny, as every policy rule does', () => {
    expect(writeDenied('prod', 'Shop prod', policy({ effect: 'deny', resource: 'prod:*' }, { effect: 'allow', resource: 'prod:Shop prod' }))).toBeUndefined()
    expect(writeDenied('prod', 'Shop prod', policy({ effect: 'deny', resource: 'prod:*' }))).toMatchObject({ allowed: false, organization: 'Acme' })
  })

  it('is not read-only without a policy, or with rules that do not match', () => {
    expect(writeDenied('prod', 'x', null)).toBeUndefined()
    expect(guardConnection(resolved(), 'Shop prod', DEFAULT_ENVIRONMENT_LIMITS, null).safety.readOnly).toBe(false)
  })

  it('hands the worker the lowered limits and the connection otherwise unchanged', () => {
    const connection = guarded({ maxRows: 50_000, statementTimeoutMs: 600_000 }).connection
    expect(connection).toMatchObject({ id: 'c1', host: 'db', maxRows: 1000, statementTimeoutMs: 30_000, readOnly: false })
  })

  it('uses the product defaults for a connection that does not carry limits', () => {
    const { maxRows, statementTimeoutMs, ...bare } = resolved()
    void maxRows; void statementTimeoutMs
    expect(guardConnection(bare as ResolvedConnection, 'x', DEFAULT_ENVIRONMENT_LIMITS, null).safety).toMatchObject({ maxRows: 500, statementTimeoutMs: 30_000 })
  })

  it('holds a requested row limit to the connection, and passes "none" through', () => {
    const { safety } = guarded()
    expect(capRows(undefined, safety)).toBeUndefined()
    expect(capRows(100, safety)).toBe(100)
    expect(capRows(100_000, safety)).toBe(1000)
    expect(capRows(900, safety)).toBe(900)
  })
})

describe('policy rule db.write', () => {
  it('is a known action, with the environment and connection as the resource', () => {
    expect(parsePolicy('{"rules":[{"effect":"deny","action":"db.write","resource":"prod:*"}]}', 'user', 'u')).toEqual({ source: { layer: 'user', path: 'u', rules: [{ effect: 'deny', action: 'db.write', resource: 'prod:*' }] } })
    expect(dbWriteResource('prod', 'Shop prod')).toBe('prod:Shop prod')
    expect(parsePolicy('{"rules":[{"effect":"deny","action":"db.drop","resource":"x"}]}', 'user', 'u')).toMatchObject({ problem: expect.stringContaining('db.write') })
  })
})

describe('environment limits in preferences', () => {
  it('start with production held to 1,000 rows and 30 seconds', () => {
    expect(DEFAULT_PREFERENCES.environmentLimits.prod).toEqual({ maxRows: 1000, statementTimeoutMs: 30_000 })
    expect(DEFAULT_PREFERENCES.environmentLimits.dev).toEqual({ maxRows: null, statementTimeoutMs: null })
    expect(normalizePreferences({}).environmentLimits).toEqual(DEFAULT_ENVIRONMENT_LIMITS)
  })

  it('accept a ceiling for any environment, or none', () => {
    const next = normalizePreferences({ environmentLimits: { dev: { maxRows: 250, statementTimeoutMs: 20_000 }, prod: { maxRows: null, statementTimeoutMs: 5000 } } }, true)
    expect(next.environmentLimits).toEqual({ local: { maxRows: null, statementTimeoutMs: null }, dev: { maxRows: 250, statementTimeoutMs: 20_000 }, prod: { maxRows: null, statementTimeoutMs: 5000 } })
  })

  it('refuse out-of-range or malformed values when set, and fall back when read', () => {
    for (const bad of [{ maxRows: 0, statementTimeoutMs: 1000 }, { maxRows: 100_001, statementTimeoutMs: 1000 }, { maxRows: 10, statementTimeoutMs: 999 }, { maxRows: 10, statementTimeoutMs: 3_600_001 }, { maxRows: 1.5, statementTimeoutMs: 1000 }, { maxRows: '10', statementTimeoutMs: 1000 }, { maxRows: 10 }, null, 'x']) {
      expect(() => normalizePreferences({ environmentLimits: { prod: bad } }, true), JSON.stringify(bad)).toThrow(PreferenceInputError)
      expect(normalizePreferences({ environmentLimits: { prod: bad } }).environmentLimits.prod).toEqual(DEFAULT_ENVIRONMENT_LIMITS.prod)
    }
  })

  it('ignore environments that do not exist', () => {
    expect(normalizePreferences({ environmentLimits: { staging: { maxRows: 1, statementTimeoutMs: 1000 } } }, true).environmentLimits).toEqual(DEFAULT_ENVIRONMENT_LIMITS)
  })
})
