import type { ReactElement, ReactNode } from 'react'
import { AlertCircle, Copy } from 'lucide-react'
import { Button } from '../../ui/Button'
import { copyText } from '../../ui/clipboard'

export interface QueryErrorInfo { message: string; code?: string; sqlState?: string; hint?: string; position?: number }

interface Plain { headline: string; recovery: string }

const BY_SQLSTATE: Record<string, Plain> = {
  '42601': { headline: 'The statement has a syntax error', recovery: 'Check the spelling near the position shown under Technical detail, or ask the agent to fix it.' },
  '42P01': { headline: 'A table or view in the statement does not exist', recovery: 'Check the name and schema in the tree on the left.' },
  '42703': { headline: 'A column in the statement does not exist', recovery: 'Open the table in the tree to see its columns.' },
  '42883': { headline: 'The function or operator does not exist for these types', recovery: 'Cast the values to the types the function expects.' },
  '42501': { headline: 'This user is not allowed to do that', recovery: 'Use a role with the right privileges, or ask whoever runs the server.' },
  '23505': { headline: 'A row with the same unique value already exists', recovery: 'Change the value, or update the existing row instead.' },
  '23503': { headline: 'The row refers to, or is referred to by, another row', recovery: 'Add or remove the related row first.' },
  '23502': { headline: 'A required column has no value', recovery: 'Provide a value for the column.' },
  '22P02': { headline: 'A value is not valid for its type', recovery: 'Check the format of the value, for example a number or a date.' },
  '57014': { headline: 'The statement was cancelled or took too long', recovery: 'Narrow it with a WHERE clause or a smaller limit, or raise the statement timeout on the connection.' },
  '40001': { headline: 'The database could not finish the transaction', recovery: 'Run it again.' },
  '40P01': { headline: 'Two transactions waited for each other', recovery: 'Run it again.' },
  '53300': { headline: 'The server has no free connections', recovery: 'Close other sessions or wait a moment.' }
}
const BY_CODE: Record<string, Plain> = {
  timeout: { headline: 'The statement took too long', recovery: 'Narrow it, or raise the statement timeout on the connection.' },
  cancelled: { headline: 'The statement was cancelled', recovery: 'Run it again when you are ready.' },
  'read-only': { headline: 'This connection is read-only', recovery: 'Turn read-only off in the connection settings to change data.' },
  connect: { headline: 'The connection to the database failed', recovery: 'Check that the server is running and that the host, port and credentials are right.' },
  tunnel: { headline: 'The SSH tunnel could not be opened', recovery: 'Check the SSH host, user and key in the connection settings.' }
}

/** What went wrong in a sentence a person can act on; the raw message stays one click away. */
export function describeQueryError(error: QueryErrorInfo): Plain {
  return (error.sqlState && BY_SQLSTATE[error.sqlState]) || (error.code && BY_CODE[error.code]) || { headline: 'The statement could not run', recovery: 'Read the technical detail below, or ask the agent to explain it.' }
}

/** A failed statement: a plain headline and what to do next, with the engine's own words collapsed. */
export function QueryError({ error, children }: { error: QueryErrorInfo; children?: ReactNode }): ReactElement {
  const plain = describeQueryError(error)
  const detail = [error.sqlState ? `SQLSTATE ${error.sqlState}` : '', error.position ? `position ${error.position}` : ''].filter(Boolean).join(' · ')
  return <div role="alert" className="oq-query-error">
    <div className="oq-query-error-head">
      <AlertCircle size={16} aria-hidden="true" />
      <div><strong>Query failed</strong><p>{plain.headline}. {plain.recovery}</p></div>
      <Button size="sm" variant="ghost" icon={<Copy size={12} aria-hidden="true" />} onClick={() => void copyText(error.message, 'Error')}>Copy error</Button>
    </div>
    <details className="oq-query-error-detail">
      <summary>Technical detail{detail ? <small> {detail}</small> : null}</summary>
      <pre>{error.message}</pre>
      {error.hint && <p className="oq-muted">Hint: {error.hint}</p>}
    </details>
    {children}
  </div>
}
