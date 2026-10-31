import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { McpServerConfig, McpTrustedSnapshot } from '../../../shared/types/mcp'
import { trustedSnapshot } from '../../../shared/mcp-trusted'

interface Field { id: string; label: string; trusted?: string; now: string; list?: boolean }

/** The fields to compare, both sides redacted by the same function main uses, so like is compared with like. */
function fields(now: McpTrustedSnapshot, trusted: McpTrustedSnapshot | undefined, t: (key: string) => string): Field[] {
  const words = (values: readonly string[]): string => values.join(' ')
  if (now.transport === 'stdio') {
    const before = trusted?.transport === 'stdio' ? trusted : undefined
    return [
      { id: 'command', label: t('mcp.safety.command'), now: words([now.command, ...now.args]), trusted: before && words([before.command, ...before.args]) },
      { id: 'keys', label: t('mcp.safety.envKeys'), now: words(now.envKeys), trusted: before && words(before.envKeys), list: true }
    ]
  }
  const before = trusted && trusted.transport !== 'stdio' ? trusted : undefined
  return [
    { id: 'url', label: t('mcp.safety.url'), now: now.url, trusted: before?.url },
    { id: 'keys', label: t('mcp.safety.headerKeys'), now: words(now.headerKeys), trusted: before && words(before.headerKeys), list: true }
  ]
}

/**
 * What a server runs now, for a quarantine that came from a changed configuration, beside what was trusted when main
 * kept it (older records did not). Values of variables and headers, secret-looking arguments and a URL's query never
 * show. When nothing visible differs, the change was in one of those, and the view says so instead of "the same".
 */
export function McpRunsNow({ config, trusted }: { config: McpServerConfig; trusted?: McpTrustedSnapshot }): ReactElement {
  const { t } = useTranslation('code')
  const rows = fields(trustedSnapshot(config), trusted, t as unknown as (key: string) => string)
  const compared = trusted !== undefined
  const visibleChange = rows.some(row => compared && row.trusted !== row.now)
  const show = (value: string | undefined, list?: boolean): ReactElement | string =>
    !value ? t('mcp.safety.none') : list ? <>{value.split(' ').map(name => <code key={name}>{name}</code>)}</> : <code>{value}</code>
  return <div className="mcp-runs-now" data-testid="mcp-runs-now">
    <strong>{compared ? t('mcp.safety.changedSinceTrust') : t('mcp.safety.runsNow')}</strong>
    <dl>
      {rows.map(row => compared
        ? <div key={row.id} className={row.trusted !== row.now ? 'is-changed' : undefined} data-testid={`mcp-runs-now-${row.id}`} data-changed={row.trusted !== row.now || undefined}>
          <dt>{row.label}</dt>
          <dd><span className="mcp-runs-now-side">{t('mcp.safety.trustedSide')}</span>{show(row.trusted, row.list)}</dd>
          <dd><span className="mcp-runs-now-side">{t('mcp.safety.nowSide')}</span>{show(row.now, row.list)}</dd>
        </div>
        : <div key={row.id} data-testid={`mcp-runs-now-${row.id}`}><dt>{row.label}</dt><dd>{show(row.now, row.list)}</dd></div>)}
    </dl>
    {compared && !visibleChange && <p className="mcp-runs-now-hidden" data-testid="mcp-runs-now-hidden">{t('mcp.safety.hiddenChange')}</p>}
  </div>
}
