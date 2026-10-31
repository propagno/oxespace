import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfirmScript, MongoWritePreview } from './confirm-statements'
import { formatNumber } from '../../utils/formatTime'
import styles from './ConfirmStatements.module.css'

/** Read-only, line-numbered code: what will run, exactly as written. */
export function CodeLines({ text, firstLine, hitLines, label, testId, numbers = true }: { text: string; firstLine: number; hitLines?: ReadonlySet<number>; label: string; testId?: string; numbers?: boolean }): ReactElement {
  return <pre className={styles.code} tabIndex={0} role="region" aria-label={label} data-testid={testId}>
    {text.split('\n').map(line => line.replace(/\r$/, '')).map((line, index) => <span key={index} className={`${styles.row}${hitLines?.has(firstLine + index) ? ` ${styles.hit}` : ''}`}>
      {numbers && <span className={styles.number} aria-hidden="true">{firstLine + index}</span>}{line || ' '}</span>)}
  </pre>
}

/**
 * The statements a destructive or production confirmation is about, before any typed name: each flagged statement
 * with its line and reasons, then the whole script that will run, so a DELETE on line 1302 cannot hide.
 */
export function ConfirmStatements({ script, generalReasons }: { script: ConfirmScript; generalReasons: string[] }): ReactElement {
  const { t } = useTranslation('oxequery')
  const flaggedReasons = new Set(script.flagged.flatMap(statement => statement.reasons))
  const other = generalReasons.filter(reason => !flaggedReasons.has(reason))
  const hits = new Set(script.flagged.flatMap(statement => statement.text.split('\n').map((_, index) => statement.line + index)))
  return <div data-testid="oxequery-confirm-statements">
    {other.length > 0 && <ul className={styles.reasons}>{other.map(reason => <li key={reason}>{reason}</li>)}</ul>}
    {script.flagged.length > 0 && <section className={styles.section}>
      <h3>{t('workbench.confirm.flagged', { count: script.flagged.length })}</h3>
      <ol className={styles.flagged}>{script.flagged.map(statement => <li key={statement.line} data-testid="oxequery-confirm-flagged">
        <span className={styles.where}>{t('workbench.confirm.line', { line: statement.line })}</span>
        <ul className={styles.reasons}>{statement.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        <CodeLines text={statement.text} firstLine={statement.line} label={t('workbench.confirm.statementAt', { line: statement.line })} />
      </li>)}</ol>
    </section>}
    {(script.all.length > 1 || script.flagged.length === 0) && <section className={styles.section}>
      <h3>{t('workbench.confirm.willRun', { count: script.all.length, formatted: formatNumber(script.all.length) })}</h3>
      <CodeLines testId="oxequery-confirm-script" text={script.text}
        firstLine={script.firstLine} hitLines={script.all.length > 1 ? hits : undefined} label={t('workbench.confirm.willRunLabel')} />
    </section>}
  </div>
}

/** The Mongo write a confirmation is about: operation, filter and the document, read-only and in full. */
export function MongoWriteDetails({ preview }: { preview: MongoWritePreview }): ReactElement {
  const { t } = useTranslation('oxequery')
  return <div data-testid="oxequery-confirm-mongo">
    <section className={styles.section}><h3>{t('workbench.confirm.operation')}</h3>
      <CodeLines text={preview.operation} firstLine={1} numbers={false} label={t('workbench.confirm.operation')} testId="oxequery-confirm-mongo-operation" /></section>
    {preview.filter !== null && <section className={styles.section}><h3>{t('workbench.confirm.filter')}</h3>
      <CodeLines text={preview.filter} firstLine={1} label={t('workbench.confirm.filter')} testId="oxequery-confirm-mongo-filter" /></section>}
    {preview.document !== null && <section className={styles.section}><h3>{preview.filter !== null ? t('workbench.confirm.update') : t('workbench.confirm.documents')}</h3>
      <CodeLines text={preview.document} firstLine={1} label={preview.filter !== null ? t('workbench.confirm.update') : t('workbench.confirm.documents')} testId="oxequery-confirm-mongo-document" /></section>}
  </div>
}
