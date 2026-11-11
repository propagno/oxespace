import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AgentHostAccess,
  AgentPermissionPolicyRow,
  AgentPermissionRule,
  AgentPermissionsPage
} from '../../../shared/types/agent-permissions'
import { i18n } from '../../i18n'
import { Button, Select, SettingsSection, SettingRow, toast } from '../../ui'

const EMPTY_PAGE: AgentPermissionsPage = {
  rules: [],
  databases: [],
  hosts: [],
  policy: []
}

function folderName(project?: string): string {
  if (!project) return ''
  const trimmed = project.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || trimmed
}

function isProductionEnv(env: string): boolean {
  const normalized = env.trim().toLowerCase()
  return normalized === 'production' || normalized === 'prod'
}

export function AgentPermissionsSettings({ workspaceId }: { workspaceId: string }): ReactElement {
  const { t } = useTranslation('settings')
  const [page, setPage] = useState<AgentPermissionsPage>(EMPTY_PAGE)

  const refresh = useCallback(async (): Promise<void> => {
    const api = window.oxe?.agentPermissions
    if (!api?.list) return
    try {
      const next = await api.list({ workspaceId })
      if (next && typeof next === 'object') {
        setPage({
          rules: Array.isArray(next.rules) ? next.rules : [],
          databases: Array.isArray(next.databases) ? next.databases : [],
          hosts: Array.isArray(next.hosts) ? next.hosts : [],
          policy: Array.isArray(next.policy) ? next.policy : []
        })
      }
    } catch {
      // Keep last known permissions snapshot if main fails transiently.
    }
  }, [workspaceId])

  useEffect(() => {
    let active = true
    const api = window.oxe?.agentPermissions
    if (api?.list) {
      void api.list({ workspaceId }).then(next => {
        if (!active || !next || typeof next !== 'object') return
        setPage({
          rules: Array.isArray(next.rules) ? next.rules : [],
          databases: Array.isArray(next.databases) ? next.databases : [],
          hosts: Array.isArray(next.hosts) ? next.hosts : [],
          policy: Array.isArray(next.policy) ? next.policy : []
        })
      }).catch(() => undefined)
    }
    const unsubscribe = api?.onChanged?.(() => {
      if (active) void refresh()
    })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [workspaceId, refresh])

  const showUndoToast = (title: string, undoToken?: string): void => {
    if (!undoToken) return
    toast({
      title,
      intent: 'info',
      action: {
        label: i18n.t('ui.undo'),
        run: () => {
          void window.oxe?.agentPermissions?.undo?.(undoToken).then(() => refresh())
        }
      }
    })
  }

  const handleRevoke = async (rule: AgentPermissionRule): Promise<void> => {
    const res = await window.oxe?.agentPermissions?.revokeRule?.(rule.id)
    if (!res?.ok) return
    setPage(prev => ({ ...prev, rules: prev.rules.filter(item => item.id !== rule.id) }))
    void refresh()
    showUndoToast(t('agentPermissions.commands.revokedToast', { rule: rule.text }), res.undoToken)
  }

  const handleDatabaseAccess = async (id: string, name: string, access: string): Promise<void> => {
    const res = await window.oxe?.agentPermissions?.setDatabaseAccess?.({ id, access })
    if (!res?.ok) return
    setPage(prev => ({
      ...prev,
      databases: prev.databases.map(item => (item.id === id ? { ...item, access } : item))
    }))
    void refresh()
    showUndoToast(t('agentPermissions.databases.updatedToast', { name }), res.undoToken)
  }

  const handleHostAccess = async (host: string, access: AgentHostAccess): Promise<void> => {
    const res = await window.oxe?.agentPermissions?.setHostAccess?.({ workspaceId, host, access })
    if (!res?.ok) return
    setPage(prev => ({
      ...prev,
      hosts: prev.hosts.map(item => (item.host === host ? { ...item, access } : item))
    }))
    void refresh()
    showUndoToast(t('agentPermissions.hosts.updatedToast', { host }), res.undoToken)
  }

  const openPolicyInEditor = async (): Promise<void> => {
    let policyPath = '.oxe/policy.yaml'
    try {
      const view = await window.oxe?.policy?.get?.(workspaceId)
      const found = view?.sources?.[0]?.path ?? view?.locations?.[0]?.path
      if (found) policyPath = found
    } catch {
      // Fall back to project policy path.
    }
    void window.oxe?.app?.openIn?.({
      workspaceId,
      rootPath: '',
      path: policyPath,
      target: 'vscode'
    })
  }

  const ruleSubtitle = (rule: AgentPermissionRule): string => {
    const provider = rule.provider === 'codex'
      ? t('agentPermissions.providers.codex')
      : t('agentPermissions.providers.claude')
    if (rule.scope === 'session') return t('agentPermissions.commands.scopeSession', { provider })
    if (rule.scope === 'project') {
      const folder = folderName(rule.project)
      return folder
        ? t('agentPermissions.commands.scopeProjectFolder', { provider, folder })
        : t('agentPermissions.commands.scopeProject', { provider })
    }
    return t('agentPermissions.commands.scopeUser', { provider })
  }

  const renderPolicyRows = (section: AgentPermissionPolicyRow['section']): ReactElement | null => {
    const rows = page.policy.filter(item => item.section === section)
    if (!rows.length) return null
    return (
      <ul className="diagnostics-checks">
        {rows.map((row, index) => (
          <li key={`${section}-${index}-${row.text}`} className="diagnostics-check">
            <code>{row.text}</code>
            <span>{t('agentPermissions.policy.fromFile')}</span>
            <Button variant="ghost" size="sm" onClick={() => void openPolicyInEditor()}>
              {t('agentPermissions.policy.openInEditor')}
            </Button>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section className="settings-general" data-testid="agent-permissions-settings">
      <h2>{t('agentPermissions.title')}</h2>
      <p>{t('agentPermissions.description')}</p>

      <SettingsSection title={t('agentPermissions.sections.commands')}>
        {page.rules.length === 0 ? (
          <p>{t('agentPermissions.commands.empty')}</p>
        ) : (
          <ul className="diagnostics-checks">
            {page.rules.map(rule => (
              <li key={rule.id} className="diagnostics-check">
                <div>
                  <code>{rule.text}</code>
                  <p>{ruleSubtitle(rule)}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void handleRevoke(rule)}>
                  {t('agentPermissions.revoke')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {renderPolicyRows('commands')}
      </SettingsSection>

      <SettingsSection title={t('agentPermissions.sections.databases')}>
        {page.databases.length === 0 ? (
          <p>{t('agentPermissions.databases.empty')}</p>
        ) : (
          page.databases.map(db => {
            const prod = isProductionEnv(db.env)
            const selectLabel = prod
              ? t('agentPermissions.databases.prodSelectLabel', { name: db.name })
              : t('agentPermissions.databases.selectLabel', { name: db.name, env: db.env })
            return (
              <SettingRow
                key={db.id}
                label={db.name}
                description={db.env}
                control={
                  <Select
                    aria-label={selectLabel}
                    value={db.access}
                    onChange={event => {
                      const next = event.target.value
                      void handleDatabaseAccess(db.id, db.name, next)
                    }}
                  >
                    <option value="off">{t('agentPermissions.databases.access.off')}</option>
                    <option value="read">{t('agentPermissions.databases.access.read')}</option>
                    {!prod ? <option value="write">{t('agentPermissions.databases.access.write')}</option> : null}
                  </Select>
                }
              />
            )
          })
        )}
        {renderPolicyRows('databases')}
      </SettingsSection>

      <SettingsSection title={t('agentPermissions.sections.hosts')}>
        {page.hosts.length === 0 ? (
          <p>{t('agentPermissions.hosts.empty')}</p>
        ) : (
          page.hosts.map(host => {
            const parts = [t('agentPermissions.hosts.callsToday', { count: host.callsToday })]
            if (host.production) parts.push(t('agentPermissions.hosts.production'))
            if (host.insecure) parts.push(t('agentPermissions.hosts.insecure'))
            return (
              <SettingRow
                key={host.host}
                label={host.host}
                description={parts.join(' · ')}
                control={
                  <Select
                    aria-label={host.host}
                    value={host.access}
                    onChange={event => {
                      const next = event.target.value as AgentHostAccess
                      void handleHostAccess(host.host, next)
                    }}
                  >
                    <option value="allowed">{t('agentPermissions.hosts.access.allowed')}</option>
                    <option value="ask">{t('agentPermissions.hosts.access.ask')}</option>
                    <option value="blocked">{t('agentPermissions.hosts.access.blocked')}</option>
                  </Select>
                }
              />
            )
          })
        )}
        {renderPolicyRows('hosts')}
      </SettingsSection>

      <SettingsSection title={t('agentPermissions.sections.alwaysOn')}>
        <ul>
          <li>{t('agentPermissions.alwaysOn.noProdWrite')}</li>
          <li>{t('agentPermissions.alwaysOn.denyAndHold')}</li>
        </ul>
      </SettingsSection>
    </section>
  )
}
