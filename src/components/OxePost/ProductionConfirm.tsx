import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { PostEnvironmentView } from '../../../shared/oxepost/types'
import { ConfirmDialog, Notice } from '../../ui'
import { productionTarget } from './productionTarget'
import styles from './OxePost.module.css'

/**
 * Confirms a send to a production environment with the real address (P1-10): the URL resolved with the
 * environment's variables, the host set apart, secrets masked. When a variable has no value the address is not
 * known, so the dialog says so and the send stays off; raw `{{braces}}` are never shown as if they were the target.
 */
export function ProductionConfirm({ method, url, environment, onConfirm, onCancel }: {
  method: string
  url: string
  environment: PostEnvironmentView | undefined
  onConfirm: () => void
  onCancel: () => void
}): ReactElement {
  const { t, i18n } = useTranslation('post')
  const target = productionTarget(url, environment)
  const name = environment?.name ?? ''
  return <ConfirmDialog title={t('production.title', { name })} description={t('production.lead', { name })}
    confirmLabel={t('production.confirm')} cancelLabel={t('common.cancel')} danger confirmDisabled={target.kind === 'missing'}
    onConfirm={onConfirm} onCancel={onCancel} testId="oxepost-production-confirm">
    {target.kind === 'resolved'
      ? <dl className={styles.target} data-testid="oxepost-production-target">
        <dt>{t('production.request')}</dt>
        <dd><span className={styles.targetMethod}>{method}</span> <code className={styles.targetUrl}>{target.origin ? <><strong data-testid="oxepost-production-host">{target.origin}</strong>{target.rest}</> : target.url}</code></dd>
        <dt>{t('production.environment')}</dt>
        <dd>{name}</dd>
        {target.maskedSecrets.length > 0 && <dd className={styles.hint}>{t('production.secretsMasked')}</dd>}
      </dl>
      : <Notice intent="warning" title={t('production.unknownTitle')}>
        {t('production.missing', { names: new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(target.missing), count: target.missing.length, name })}
      </Notice>}
  </ConfirmDialog>
}
