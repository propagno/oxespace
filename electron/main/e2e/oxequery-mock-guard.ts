/**
 * The E2E mock's answer to "may this SQL run?": the real classifier (`sql-guard.ts`, pure and shared) applied in the
 * order the real service applies it, so a statement that asks for a confirmation in production asks for the same one
 * under test. Read-only first, then the production name, then the destructive confirmation.
 *
 * Pure: no Electron, so it is unit-tested on its own (`tests/unit/e2e-oxequery-mock-guard.test.ts`).
 */
import type { MainMessage } from '../../../shared/messages'
import type { OxeQueryErrorInfo, SqlGuardVerdict } from '../../../shared/types/oxequery'
import { guardSql, isMutating } from '../services/oxequery/sql-guard'

export interface MockSqlTarget { name: string; environment: string; readOnly: boolean }
export interface MockSqlRefusal { code: OxeQueryErrorInfo['code']; message: string; reasons?: string[]; codes?: MainMessage[] }

const flagged = (verdict: SqlGuardVerdict): { reasons?: string[]; codes?: MainMessage[] } =>
  ({ ...(verdict.reasons.length ? { reasons: verdict.reasons } : {}), ...(verdict.codes?.length ? { codes: verdict.codes } : {}) })

/** Why the statement may not run yet, or null when it may. The same sentences as the real service. */
export function refuseSql(target: MockSqlTarget | undefined, sql: string, input: { confirmName?: unknown; confirmed?: unknown }): MockSqlRefusal | null {
  const verdict = guardSql(sql)
  if (verdict.kind === 'empty') return { code: 'invalid', message: 'There is nothing to run.' }
  if (!isMutating(verdict)) return null
  if (target?.readOnly) return { code: 'read-only', message: 'This connection is read-only. Turn read-only off to run statements that change data.', ...flagged(verdict) }
  if (target?.environment === 'prod' && String(input.confirmName ?? '').trim() !== target.name) {
    return { code: 'confirm-name', message: 'This is a production connection. Type its name to run a statement that changes data.', ...flagged(verdict) }
  }
  if (verdict.kind === 'destructive' && input.confirmed !== true) {
    return { code: 'confirm', message: verdict.statements > 1 ? 'This script has destructive statements and needs confirmation.' : 'This statement is destructive and needs confirmation.', ...flagged(verdict) }
  }
  return null
}

/** The verb the fake result reports for a statement that changes data. */
export function commandOf(sql: string): string {
  return (/^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*([A-Za-z]+)/.exec(sql)?.[1] ?? 'SQL').toUpperCase()
}

export { guardSql, isMutating }
