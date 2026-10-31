import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { OnMount } from '@monaco-editor/react'
import { useTranslation } from 'react-i18next'
import type { OxeQueryConnection } from '../../../shared/types/oxequery'
import { formatNumber } from '../../utils/formatTime'
import { cacheFor } from './sql-completion'
import { lintSql, type LintFinding } from './sql-lint'

const OWNER = 'oxequery-lint'
const DELAY_MS = 350

/**
 * Advice about the SQL in the editor (sql-lint.ts) as warning markers, kept apart from the error marker a failed
 * statement leaves. `check` gives the same findings for any text, which is how a destructive statement earns its
 * confirmation before it runs.
 */
export function useSqlLint(connection: OxeQueryConnection, editor: RefObject<Parameters<OnMount>[0] | null>, monaco: RefObject<Parameters<OnMount>[1] | null>) {
  const { t } = useTranslation('oxequery')
  const timer = useRef<number | undefined>(undefined)

  const describe = useCallback((finding: LintFinding): string => t(`lint.${finding.code}`, { ...finding.params, formatted: typeof finding.params.rows === 'number' ? formatNumber(finding.params.rows) : '' }), [t])

  const check = useCallback((text: string): LintFinding[] => lintSql(text, {
    environment: connection.environment,
    rowEstimate: (schema, table) => cacheFor(connection).rowEstimate(schema, table)
  }), [connection])

  const mark = useCallback((): void => {
    const model = editor.current?.getModel()
    const api = monaco.current
    if (!model || !api) return
    api.editor.setModelMarkers(model, OWNER, check(model.getValue()).map(finding => {
      const start = model.getPositionAt(finding.start), end = model.getPositionAt(finding.end)
      return { severity: api.MarkerSeverity.Warning, message: describe(finding), code: finding.code, startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: Math.max(end.column, start.column + 1) }
    }))
  }, [check, describe, editor, monaco])

  /** After a pause in typing, so a long script is not scanned on every key. */
  const schedule = useCallback((): void => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(mark, DELAY_MS)
  }, [mark])

  // New row estimates, another environment or another language change the advice without a keystroke.
  useEffect(() => {
    schedule()
    const stop = cacheFor(connection).subscribe(schedule)
    return () => { stop(); window.clearTimeout(timer.current) }
  }, [connection, schedule])

  return { check, describe, mark, schedule }
}
