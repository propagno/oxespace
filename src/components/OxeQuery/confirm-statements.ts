import { splitStatements } from '../../../shared/sqlText'

/** One statement a confirmation is about: where it sits in the editor, its exact text and why it was flagged. */
export interface ConfirmStatement { line: number; text: string; reasons: string[] }
export interface ConfirmScript {
  /** The exact text that will run and the editor line it starts on. */
  text: string
  firstLine: number
  /** Statements with a reason of their own, in order. */
  flagged: ConfirmStatement[]
  /** Every statement that will run, in order: the exact text, so nothing in a long script runs unseen. */
  all: ConfirmStatement[]
}

/** 1-based line of `offset` in `source`. */
export function lineAt(source: string, offset: number): number {
  let line = 1
  for (let index = 0; index < Math.min(offset, source.length); index++) if (source.charCodeAt(index) === 10) line++
  return line
}

/**
 * Splits what is about to run into statements, each with its editor line (`firstLine` is the line `text` starts on)
 * and the findings that fall inside it (offsets relative to `text`).
 */
export function confirmScript(text: string, firstLine: number, findings: ReadonlyArray<{ start: number; reason: string }>): ConfirmScript {
  const spans = splitStatements(text)
  const all = (spans.length ? spans : [{ start: 0, end: text.length }]).map(span => ({
    line: firstLine + lineAt(text, span.start) - 1,
    text: text.slice(span.start, span.end),
    reasons: [...new Set(findings.filter(finding => finding.start >= span.start && finding.start < Math.max(span.end, span.start + 1)).map(finding => finding.reason))]
  }))
  return { text, firstLine, flagged: all.filter(statement => statement.reasons.length > 0), all }
}

/** What a Mongo write will send, for its confirmation: the operation, the filter it matches and the document it writes. */
export interface MongoWritePreview { operation: string; filter: string | null; document: string | null }

export function mongoWritePreview(input: { op: 'insert' | 'replace' | 'delete'; database: string; collection: string; original: string | null; document: string | null }): MongoWritePreview {
  const pretty = (value: unknown): string => JSON.stringify(value, null, 2)
  let filter: string | null = null
  if (input.original !== null) {
    try {
      const parsed = JSON.parse(input.original) as Record<string, unknown>
      filter = '_id' in parsed ? pretty({ _id: parsed._id }) : pretty(parsed)
    } catch { filter = input.original }
  }
  let document: string | null = null
  if (input.op !== 'delete' && input.document !== null) {
    try { document = pretty(JSON.parse(input.document)) } catch { document = input.document }
  }
  const method = input.op === 'insert' ? 'insertOne' : input.op === 'replace' ? 'replaceOne' : 'deleteOne'
  return { operation: `db.${input.collection}.${method}() · ${input.database}`, filter, document }
}
