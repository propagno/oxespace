import { Bot, ExternalLink, RefreshCw } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentProvider } from '../../../shared/types/agent'
import { RichText } from '../../i18n/RichText'
import { Button } from '../../ui'
import { installDocLabel, PROVIDER_INSTALL_DOCS, type ProviderInstallDoc } from '../Settings/providerInstallDocs'

export function openInstallDocs(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** One button per install guide. Shared by the first-run guide and the Agents settings page. */
export function AgentInstallLinks({ providers, size }: { providers?: AgentProvider[]; size?: 'sm' }): ReactElement {
  const entries = (Object.entries(PROVIDER_INSTALL_DOCS) as Array<[AgentProvider, ProviderInstallDoc]>)
    .filter(([id]) => !providers || providers.includes(id))
  return <>
    {entries.map(([id, doc]) => (
      <Button key={id} variant="ghost" size={size} icon={<ExternalLink size={12} aria-hidden="true" />} onClick={() => openInstallDocs(doc.url)} data-testid={`btn-onboarding-install-${id}`}>
        {installDocLabel(doc)}
      </Button>
    ))}
  </>
}

/** What the Agents settings page shows when no agent CLI was found on this machine. */
export function AgentCliOnboarding({ checking, onCheck }: { checking: boolean; onCheck: () => void }): ReactElement {
  const { t } = useTranslation('settings')
  return (
    <div className="settings-onboarding" data-testid="providers-onboarding" role="status">
      <Bot size={20} aria-hidden="true" />
      <div>
        <p>{t('providers.onboarding.title')}</p>
        <span><RichText text={t('providers.onboarding.body')} /></span>
      </div>
      <div className="settings-onboarding-links"><AgentInstallLinks /></div>
      <Button variant="primary" disabled={checking} onClick={onCheck} data-testid="btn-onboarding-health-check">
        <RefreshCw size={14} aria-hidden="true" className={checking ? 'spin' : undefined} />
        {checking ? t('providers.checking') : t('providers.onboarding.detect')}
      </Button>
    </div>
  )
}
