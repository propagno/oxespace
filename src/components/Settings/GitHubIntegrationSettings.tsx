// PU-03·8 (OXE-211): GitHub integration page in Settings › Integrations.
// Follows the BRD-06 settings mould (SettingsPageTitle, SettingsSection, SettingRow, src/ui Button)
// and copies "gh auth login" through copyText so success and failure always confirm with a toast.
import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { GitHubCliStatus } from '../../../shared/types/github'
import { useWorkspaceStore } from '../../store/workspace.store'
import { SettingRow, SettingsSection as SettingsGroup } from '../../ui'
import { SettingsPageTitle } from '../../ui/Settings'
import { GitHubAuthCommandRow } from '../GitHub/GitHubAuthCommandRow'

export function GitHubIntegrationSettings(): ReactElement {
  const { t } = useTranslation('settings')
  const [cli, setCli] = useState<GitHubCliStatus | null>(null)
  const [checking, setChecking] = useState(() => Boolean(window.oxe?.github?.getCliStatus))

  useEffect(() => {
    let active = true
    const check = window.oxe?.github?.getCliStatus
    if (!check) return
    const { workspaces, activeWorkspaceId } = useWorkspaceStore.getState()
    const current = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0]
    void check({ workspaceId: current?.id ?? '', rootPath: current?.rootPath ?? '' })
      .then((status) => {
        if (active) setCli(status)
      })
      .catch(() => {
        if (active) setCli(null)
      })
      .finally(() => {
        if (active) setChecking(false)
      })
    return () => {
      active = false
    }
  }, [])

  const isConnected = Boolean(cli?.available && cli.authenticated && cli.user)
  const statusText = checking
    ? t('github.checking')
    : isConnected
      ? t('github.connected', { user: cli!.user })
      : cli?.available
        ? t('github.notConnected')
        : t('github.noCli')

  return (
    <section className="settings-general" data-ui="settings-page" data-testid="settings-github-page">
      <SettingsPageTitle>{t('github.title')}</SettingsPageTitle>
      <p>{t('github.intro')}</p>
      <SettingsGroup title={t('github.section')}>
        <SettingRow
          label={t('github.statusLabel')}
          description={statusText}
          control={<span>{isConnected ? `@${cli!.user}` : t('github.disconnectedBadge')}</span>}
        />
        <SettingRow
          label={t('github.authLabel')}
          description={t('github.authHint')}
          control={<GitHubAuthCommandRow showCopyLabel />}
        />
      </SettingsGroup>
    </section>
  )
}
