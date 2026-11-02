import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { McpServerConfig } from '../../../shared/types/mcp'

/**
 * What a server runs now, for a quarantine that came from a changed configuration: the command and its arguments,
 * or the URL, and only the names of its environment variables or headers. Values are never shown: they can be keys.
 * TODO(CCR F25): show what was trusted beside it once main keeps that snapshot in the quarantine record.
 */
export function McpRunsNow({ config }: { config: McpServerConfig }): ReactElement {
  const { t } = useTranslation('code')
  const names = config.transport === 'stdio' ? Object.keys(config.env ?? {}) : Object.keys(config.headers ?? {})
  return <div className="mcp-runs-now" data-testid="mcp-runs-now">
    <strong>{t('mcp.safety.runsNow')}</strong>
    <dl>
      {config.transport === 'stdio'
        ? <div><dt>{t('mcp.safety.command')}</dt><dd><code data-testid="mcp-runs-now-command">{[config.command, ...config.args].join(' ')}</code></dd></div>
        : <div><dt>{t('mcp.safety.url')}</dt><dd><code data-testid="mcp-runs-now-url">{config.url}</code></dd></div>}
      <div>
        <dt>{t(config.transport === 'stdio' ? 'mcp.safety.envKeys' : 'mcp.safety.headerKeys')}</dt>
        <dd data-testid="mcp-runs-now-keys">{names.length ? names.map(name => <code key={name}>{name}</code>) : t('mcp.safety.none')}</dd>
      </div>
    </dl>
  </div>
}
