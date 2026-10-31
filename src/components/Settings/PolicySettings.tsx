import { useEffect, useState, type ReactElement } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PolicyLayer, PolicyView } from '../../../shared/policy'
import { Button } from '../../ui'

/** Read only: shows which policy files apply and what they block. Nothing here writes a policy. */
export function PolicySettings({ workspaceId }: { workspaceId?: string }): ReactElement {
  const { t } = useTranslation('settings')
  const label = (layer: PolicyLayer): string => t(`policy.layers.${layer}.label`)
  const [view, setView] = useState<PolicyView | null>(null)
  const [error, setError] = useState('')
  const [reloads, setReloads] = useState(0)
  useEffect(() => {
    let current = true
    window.oxe.policy.get(workspaceId).then(
      next => { if (current) { setView(next); setError('') } },
      (cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { current = false }
  }, [workspaceId, reloads])

  return <section className="settings-general" data-testid="policy-settings"><h2>{t('policy.title')}</h2>
    <p>{t('policy.intro')}</p>
    {error ? <div className="settings-callout" role="alert">{error}</div> : null}
    {view?.problems.map(problem => <div key={problem} className="settings-callout" role="alert">{t('policy.notApplied', { problem })}</div>)}
    {(view?.locations ?? []).map(({ layer, path }) => {
      const source = view?.sources.find(item => item.path === path)
      return <div key={path}>
        <h3>{label(layer)}{source?.organization ? ` · ${source.organization}` : ''}</h3>
        <div className="settings-general-card"><div>
          <p title={path}>{t(`policy.layers.${layer}.hint`)}. <code>{path}</code></p>
          {!source ? <p>{view?.problems.some(problem => problem.startsWith(path)) ? t('policy.fileError') : t('policy.noFile')}</p>
            : source.rules.length === 0 ? <p>{t('policy.noRules')}</p>
              : <ul className="diagnostics-checks" aria-label={t('policy.rules', { layer: label(layer) })}>
                {source.rules.map((rule, index) => <li key={index} className={`diagnostics-check tone-${rule.effect === 'deny' ? 'warning' : 'ok'}`}>
                  <span className="diagnostics-check-dot" aria-hidden="true" />
                  <span className="diagnostics-check-label">{rule.effect}</span>
                  <span className="diagnostics-check-detail">{rule.action} · {rule.resource}</span>
                </li>)}
              </ul>}
        </div></div>
      </div>
    })}
    <div className="settings-inline-actions">
      <Button variant="ghost" onClick={() => setReloads(count => count + 1)}><RefreshCw size={14} aria-hidden="true" /> {t('policy.reload')}</Button>
    </div>
  </section>
}
