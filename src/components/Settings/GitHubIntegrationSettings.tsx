// PU-03·8 (OXE-211) & OXE-431: Git integration page in Settings (GitHub gh CLI + Azure DevOps az CLI).
// Follows the BRD-06 settings mould (SettingsPageTitle, SettingsSection, SettingRow, src/ui Button)
// and copies CLI commands through copyText so success and failure always confirm with a toast.
import { Copy } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { GitHubCliStatus } from '../../../shared/types/github'
import { useWorkspaceStore } from '../../store/workspace.store'
import { Badge, Button, copyText, SettingRow, SettingsSection as SettingsGroup } from '../../ui'
import { SettingsPageTitle } from '../../ui/Settings'
import { GitHubAuthCommandRow } from '../GitHub/GitHubAuthCommandRow'

const AZURE_LOGIN_COMMAND = 'az login'
const AZURE_DEVOPS_EXTENSION_COMMAND = 'az extension add --name azure-devops'

function CliCommandRow({ command }: { command: string }): ReactElement {
  const { t: tc } = useTranslation('code')
  const copyCommand = (): void => {
    void copyText(command, tc('github.setup.command'), tc('github.setup.commandCopied'))
  }

  return (
    <div className="github-setup-cmd-row">
      <code>{command}</code>
      <Button
        size="sm"
        variant="secondary"
        title={tc('github.actions.copy')}
        aria-label={tc('github.setup.copy', { command })}
        onClick={copyCommand}
      >
        <Copy size={12} aria-hidden="true" />
        {tc('github.actions.copy')}
      </Button>
    </div>
  )
}

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
          control={
            <Badge intent={isConnected ? 'success' : 'neutral'}>
              {isConnected ? `@${cli!.user}` : t('github.disconnectedBadge')}
            </Badge>
          }
        />
        <SettingRow
          label={t('github.authLabel')}
          description={t('github.authHint')}
          control={<GitHubAuthCommandRow showCopyLabel />}
        />
      </SettingsGroup>
      <SettingsGroup title={t('github.azure.section')} description={t('github.azure.description')}>
        <SettingRow
          label={t('github.azure.detectionLabel')}
          description={t('github.azure.detectionHint')}
          control={<Badge>{t('github.azure.cliBadge')}</Badge>}
        />
        <SettingRow
          label={t('github.azure.authLabel')}
          description={t('github.azure.authHint')}
          control={<CliCommandRow command={AZURE_LOGIN_COMMAND} />}
        />
        <SettingRow
          wide
          label={t('github.azure.extensionLabel')}
          description={t('github.azure.extensionHint')}
          control={<CliCommandRow command={AZURE_DEVOPS_EXTENSION_COMMAND} />}
        />
      </SettingsGroup>
    </section>
  )
}
