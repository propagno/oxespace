/**
 * B10 · What the approval modal shows for a SQL statement, from the classifier's verdict. The classifier (sql-guard.ts)
 * is unchanged, so OxeQuery's own confirmation keeps working from `kind`; this only grades the risk the person sees
 * and turns the reasons into C3 notes.
 *
 * - Risk: `riskFromSql(kind)`, one step up in production. A `DO` block or a `CALL` runs code whose effect is not known
 *   before it runs, so it is `high` even though the classifier calls it a write; a destructive one stays `critical`.
 * - Notes: the classifier's C3 `codes` when it has them (SQL risk reasons, #237; read defensively until it lands), and
 *   the plain reasons it has always given, mapped to their `approvals.note.sql.*` codes.
 */
import { raiseRisk, riskFromSql } from '../../../../shared/approval-rules'
import { mainMessage, type MainMessage } from '../../../../shared/messages'
import type { ApprovalRisk } from '../../../../shared/types/approvals'
import type { SqlGuardVerdict } from '../../../../shared/types/oxequery'

const RUNS_CODE = new Set(['oxequery.sql.doBlock', 'oxequery.sql.callProcedure'])

/** The classifier's English reasons that predate its C3 codes, as the app's own notes. */
const PLAIN: Array<[RegExp, (match: RegExpExecArray) => MainMessage]> = [
  [/^(DROP|TRUNCATE) permanently removes/, match => mainMessage('approvals.note.sql.removes', { statement: match[1] })],
  [/^(DELETE|UPDATE) without a WHERE clause/, match => mainMessage('approvals.note.sql.noWhere', { statement: match[1] })],
  [/^ALTER \.\.\. DROP removes/, () => mainMessage('approvals.note.sql.alterDrop', {})],
  [/^(\w+) inside WITH has no WHERE clause/, match => mainMessage('approvals.note.sql.withNoWhere', { statement: match[1] })],
  [/^EXPLAIN ANALYZE executes/, () => mainMessage('approvals.note.sql.explainAnalyze', {})],
  [/^SELECT INTO creates a table/, () => mainMessage('approvals.note.sql.selectInto', {})],
  [/^(\w+) is not a recognised read-only statement/, match => mainMessage('approvals.note.sql.notReadOnly', { statement: match[1] })],
  [/^Calls (.+), which reaches outside the database/, match => mainMessage('approvals.note.sql.outsideReach', { calls: match[1].split(', ') })]
]

export function sqlNotes(verdict: SqlGuardVerdict): MainMessage[] {
  const plain = verdict.reasons.flatMap(reason => {
    for (const [pattern, note] of PLAIN) {
      const match = pattern.exec(reason)
      if (match) return [note(match)]
    }
    return []
  })
  return [...plain, ...((verdict as { codes?: MainMessage[] }).codes ?? [])]
}

export function sqlRisk(verdict: SqlGuardVerdict, production: boolean): ApprovalRisk {
  const codes = (verdict as { codes?: MainMessage[] }).codes ?? []
  const runsCode = verdict.kind === 'write' && codes.some(code => RUNS_CODE.has(code.code as string))
  if (!runsCode) return riskFromSql(verdict.kind, production)
  return production ? raiseRisk('high') : 'high'
}
