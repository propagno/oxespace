import type { ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy } from 'lucide-react'
import { Button } from '../../ui/Button'
import { ErrorState } from '../../ui/Display'
import { copyText, tq } from './catalog'

export interface QueryErrorInfo { message: string; code?: string; sqlState?: string; hint?: string; position?: number }

interface Plain { headline: string; recovery: string }

/** SQLSTATE codes with a plain explanation in the catalog (queryError.sqlState.*). */
const SQLSTATES = new Set(['42601', '42P01', '42703', '42883', '42501', '23505', '23503', '23502', '22P02', '57014', '40001', '40P01', '53300'])
/** OxeQuery's own error codes with a plain explanation (queryError.code.*). */
const CODES = new Set(['timeout', 'cancelled', 'read-only', 'connect', 'tunnel'])

/** What went wrong in a sentence a person can act on; the raw message stays one click away. */
export function describeQueryError(error: QueryErrorInfo): Plain {
  const key = error.sqlState && SQLSTATES.has(error.sqlState) ? `sqlState.${error.sqlState}` : error.code && CODES.has(error.code) ? `code.${error.code}` : 'unknown'
  return { headline: tq(`queryError.${key}.headline` as 'queryError.unknown.headline'), recovery: tq(`queryError.${key}.recovery` as 'queryError.unknown.recovery') }
}

/** A failed statement: the shared error state with a plain headline and what to do next, the engine's own words collapsed. */
export function QueryError({ error, children }: { error: QueryErrorInfo; children?: ReactNode }): ReactElement {
  const { t } = useTranslation('oxequery')
  const plain = describeQueryError(error)
  const detail = [error.sqlState ? `SQLSTATE ${error.sqlState}` : '', error.position ? t('queryError.position', { position: error.position }) : ''].filter(Boolean).join(' · ')
  return <div className="oq-query-error">
    <ErrorState compact title={t('queryError.title')} message={`${plain.headline}. ${plain.recovery}`}
      actions={<Button size="sm" variant="ghost" icon={<Copy size={12} aria-hidden="true" />} onClick={() => void copyText(error.message, t('queryError.copied'), t('queryError.copiedDone'))}>{t('queryError.copy')}</Button>} />
    <details className="oq-query-error-detail">
      <summary>{t('queryError.technical')}{detail ? <small> {detail}</small> : null}</summary>
      <pre>{error.message}</pre>
      {error.hint && <p className="oq-muted">{t('queryError.hint', { hint: error.hint })}</p>}
    </details>
    {children}
  </div>
}
