import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorState, LoadingState } from '../../ui/Display'
import { formatBytes } from './catalog'
import { EXAMPLE } from './examples'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { MongoStats, MongoValidation, OxeQueryConnection } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'
import { jsonProblem } from './mongo-model'
import { FieldError, Select } from '../../ui/Field'
import { formatNumber } from '../../utils/formatTime'

/** Size figures and the validation rules of a collection. Rules are shown always and changed only on a read-write connection. */
export function CollectionFacts({ connection, database, collection }: { connection: OxeQueryConnection; database: string; collection: string }): ReactElement {
  const { t } = useTranslation('oxequery')
  const [statsOpen, setStatsOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [stats, setStats] = useState<MongoStats | null>(null)
  const [rules, setRules] = useState<MongoValidation | null>(null)
  const [text, setText] = useState('')
  const [level, setLevel] = useState<MongoValidation['level']>('strict')
  const [action, setAction] = useState<MongoValidation['action']>('error')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => { setStats(null); setRules(null); setError(''); setSaved('') }, [connection.id, database, collection])
  useEffect(() => {
    if (!statsOpen || stats) return
    let alive = true
    oq('mongo.stats', { connectionId: connection.id, database, collection }).then(value => { if (alive) setStats(value) }, cause => { if (alive) setError(errorMessage(cause)) })
    return () => { alive = false }
  }, [statsOpen, stats, connection.id, database, collection])
  useEffect(() => {
    if (!rulesOpen || rules) return
    let alive = true
    oq('mongo.validation', { connectionId: connection.id, database, collection }).then(value => {
      if (!alive) return
      setRules(value); setText(value.validator ?? ''); setLevel(value.level); setAction(value.action)
    }, cause => { if (alive) setError(errorMessage(cause)) })
    return () => { alive = false }
  }, [rulesOpen, rules, connection.id, database, collection])

  const problem = jsonProblem(text, 'object', true)
  const save = async (): Promise<void> => {
    setError(''); setSaved('')
    try {
      await oq('mongo.setValidation', { connectionId: connection.id, database, collection, validator: text.trim() === '' ? null : text, level, action })
      setSaved(text.trim() === '' ? t('facts.validationRemoved') : t('facts.validationSaved'))
      setRules(null)
    } catch (cause) { setError(errorMessage(cause)) }
  }

  const disclosure = (open: boolean, toggle: () => void, label: string): ReactElement =>
    <button type="button" className="oq-disclosure" aria-expanded={open} onClick={toggle}>{open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}{label}</button>

  return <>
    <section className="oq-columns" aria-label={t('facts.statsLabel')}>
      {disclosure(statsOpen, () => setStatsOpen(value => !value), stats ? t('facts.statsSummary', { documents: t('mongo.documents', { count: stats.documents, formatted: formatNumber(stats.documents) }) }) : t('facts.stats'))}
      {statsOpen && (stats
        ? <dl className="oq-facts">
          <div><dt>{t('mongo.view.documents')}</dt><dd>{formatNumber(stats.documents)}</dd></div>
          <div><dt>{t('facts.dataSize')}</dt><dd>{formatBytes(stats.sizeBytes)}</dd></div>
          <div><dt>{t('facts.average')}</dt><dd>{formatBytes(stats.avgDocumentBytes)}</dd></div>
          <div><dt>{t('facts.onDisk')}</dt><dd>{formatBytes(stats.storageBytes)}</dd></div>
          <div><dt>{t('structure.indexes')}</dt><dd>{formatNumber(stats.indexes)} · {formatBytes(stats.indexBytes)}</dd></div>
          {stats.capped && <div><dt>{t('structure.kind')}</dt><dd>{t('facts.capped')}</dd></div>}
        </dl>
        : <LoadingState label={t('facts.readingStats')} />)}
    </section>
    <section className="oq-columns" aria-label={t('facts.validationLabel')}>
      {disclosure(rulesOpen, () => setRulesOpen(value => !value), rules ? t(rules.validator ? 'facts.validationSet' : 'facts.validationNone') : t('facts.validation'))}
      {rulesOpen && (rules
        ? <div className="oq-columns-grid oq-rules">
          <label>{t('facts.rules')} (<code>{EXAMPLE.jsonSchemaKeyword}</code>)
            <textarea aria-label={t('facts.rulesLabel')} spellCheck={false} rows={8} value={text} readOnly={connection.readOnly} aria-invalid={problem ? true : undefined} aria-describedby={problem ? 'oq-rules-error' : undefined}
              placeholder={EXAMPLE.jsonSchema} onChange={event => setText(event.target.value)} />
            {problem && <FieldError id="oq-rules-error" className="oq-field-error">{problem}</FieldError>}
          </label>
          <label>{t('facts.appliesTo')}<Select className="oq-select" aria-label={t('facts.level')} value={level} disabled={connection.readOnly} onChange={event => setLevel(event.target.value as MongoValidation['level'])}>
            <option value="strict">{t('facts.strict')}</option><option value="moderate">{t('facts.moderate')}</option><option value="off">{t('facts.off')}</option></Select></label>
          <label>{t('facts.onViolation')}<Select className="oq-select" aria-label={t('facts.action')} value={action} disabled={connection.readOnly} onChange={event => setAction(event.target.value as MongoValidation['action'])}>
            <option value="error">{t('facts.refuse')}</option><option value="warn">{t('facts.warn')}</option></Select></label>
          {!connection.readOnly && <button type="button" className="oq-primary" disabled={problem !== null} onClick={() => void save()}>{t('facts.save')}</button>}
          {saved && <p role="status" className="oq-ok">{saved}</p>}
        </div>
        : <LoadingState label={t('facts.readingRules')} />)}
    </section>
    {error && <ErrorState compact title={t('facts.failed')} message={error} />}
  </>
}
