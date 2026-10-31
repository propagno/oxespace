import { describe, expect, it } from 'vitest'
import { evaluatePolicy, type LoadedPolicy } from '../../shared/policy'
import { DEFAULT_ENVIRONMENT_LIMITS } from '../../shared/oxequerySafety'
import { checkMongoWrite, guardConnection, type PolicyReader } from '../../electron/main/services/oxequery/oxequery-guard'
import { OxeQueryError, type ResolvedConnection } from '../../electron/main/services/oxequery/oxequery-errors'

/** B15: a Mongo document write on production needs the connection's name typed, checked in main, as SQL does. */
const resolved = (overrides: Partial<ResolvedConnection> = {}): ResolvedConnection => ({
  id: 'c1', engine: 'mongodb', host: 'db', port: 27017, database: 'shop', username: 'me', sslMode: 'disable', readOnly: false, environment: 'prod', ...overrides
})
const guarded = (overrides: Partial<ResolvedConnection> = {}, policy: PolicyReader | null = null) => guardConnection(resolved(overrides), 'Shop prod', DEFAULT_ENVIRONMENT_LIMITS, policy)

function refusal(run: () => void): OxeQueryError {
  try { run() } catch (error) { if (error instanceof OxeQueryError) return error; throw error }
  throw Error('expected a refusal')
}

describe('checkMongoWrite', () => {
  it('refuses a production write without the name, or with a wrong one, with C3 codes', () => {
    for (const typed of [undefined, null, '', 'shop prod', 'Shop', 'Shop prod!', 1, {}, ['Shop prod']]) {
      const error = refusal(() => checkMongoWrite(guarded(), 'replace', true, typed))
      expect(error.code, String(typed)).toBe('confirm-name')
      expect(error.codes).toEqual({ message: { code: 'oxequery.mongo.confirmName', params: {} }, reasons: [{ code: 'oxequery.mongo.production', params: {} }] })
      // The English stays for logs.
      expect(error.reasons).toEqual(['This is a production connection.'])
    }
  })

  it('lets a production write through with the name, surrounding space ignored', () => {
    for (const op of ['insert', 'replace'] as const) expect(() => checkMongoWrite(guarded(), op, false, '  Shop prod ')).not.toThrow()
  })

  it('still asks to confirm a delete on production once the name is typed', () => {
    const error = refusal(() => checkMongoWrite(guarded(), 'delete', false, 'Shop prod'))
    expect(error.code).toBe('confirm')
    expect(error.codes.reasons?.map(code => code.code)).toEqual(['oxequery.mongo.production', 'oxequery.mongo.deletes'])
    expect(() => checkMongoWrite(guarded(), 'delete', true, 'Shop prod')).not.toThrow()
  })

  it('names the delete without the name too, so the person sees both reasons at once', () => {
    expect(refusal(() => checkMongoWrite(guarded(), 'delete', true, undefined)).codes.reasons?.map(code => code.code)).toEqual(['oxequery.mongo.production', 'oxequery.mongo.deletes'])
  })

  it('leaves a non-production connection as it was: writes run, a delete needs its confirmation', () => {
    for (const environment of ['local', 'dev'] as const) {
      expect(() => checkMongoWrite(guarded({ environment }), 'replace', false, undefined), environment).not.toThrow()
      const error = refusal(() => checkMongoWrite(guarded({ environment }), 'delete', false, undefined))
      expect(error).toMatchObject({ code: 'confirm', codes: { message: { code: 'oxequery.mongo.confirm' }, reasons: [{ code: 'oxequery.mongo.deletes' }] } })
      expect(() => checkMongoWrite(guarded({ environment }), 'delete', true, undefined)).not.toThrow()
    }
  })

  it('refuses before the name when policy keeps the connection read-only, and leaves a read-only one to the worker', () => {
    const loaded: LoadedPolicy = { sources: [{ layer: 'managed', path: 'm', organization: 'Acme', rules: [{ effect: 'deny', action: 'db.write', resource: 'prod:*' }] }], problems: [] }
    const deny: PolicyReader = { decide: (action, resource) => evaluatePolicy(loaded, action, resource) }
    expect(refusal(() => checkMongoWrite(guarded({}, deny), 'replace', true, 'Shop prod')).code).toBe('read-only')
    expect(() => checkMongoWrite(guarded({ readOnly: true }), 'replace', false, undefined)).not.toThrow()
  })
})
