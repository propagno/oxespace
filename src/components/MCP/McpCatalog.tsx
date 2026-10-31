import { KeyRound, LogIn, PlugZap, Plus, SlidersHorizontal, Terminal } from 'lucide-react'
import { useMemo, type ReactElement } from 'react'
import type { McpServer } from '../../../shared/types/mcp'
import { categoryLabel, isDarkBrand, MCP_CATALOG, MCP_CATALOG_CATEGORIES, searchCatalog, type McpCatalogEntry } from './connectorCatalog'
import { EmptyState, Spinner } from '../../ui'
import { useTranslation } from 'react-i18next'
import './McpCatalog.css'

export function McpBrandTile({ entry, size = 40 }: { entry: McpCatalogEntry; size?: number }): ReactElement {
  const color = isDarkBrand(entry.brand.hex) ? 'var(--text-primary)' : `#${entry.brand.hex}`
  return <span className="mcp-brand-tile" style={{ width: size, height: size }} aria-hidden="true">
    {entry.brand.icon
      ? <svg viewBox="0 0 24 24" width={size * 0.55} height={size * 0.55}><path d={entry.brand.icon.path} fill={color} /></svg>
      : <span className="mcp-brand-letter" style={{ background: `#${entry.brand.hex}`, color: readableOn(entry.brand.hex), fontSize: size * 0.48 }}>{entry.name.slice(0, 1).toUpperCase()}</span>}
  </span>
}

type ServerActions = { onTest(server: McpServer): void }

/** What OXESpace's test found. Agents keep their own connection, so nothing here is "running". */

const waitingForSignIn = (server: McpServer): boolean => server.health === 'starting' && /sign in/i.test(server.healthMessage ?? '')

function CatalogRow({ entry, server, busy, onAdd, onTest }: { entry: McpCatalogEntry; server: McpServer | undefined; busy: boolean; onAdd(entry: McpCatalogEntry): void } & ServerActions): ReactElement {
  const { t } = useTranslation('code')
  const stateLabel = (health: McpServer['health']): string => t(`mcp.health.${health}`)
  const hint = entry.signIn ? { icon: <LogIn size={12} aria-hidden="true" />, text: t('mcp.hint.signIn'), title: t('mcp.hint.signInTitle') } : entry.requiredEnv?.length ? { icon: <KeyRound size={12} aria-hidden="true" />, text: t('mcp.hint.token'), title: t('mcp.hint.tokenTitle') }
    : entry.configure ? { icon: <SlidersHorizontal size={12} aria-hidden="true" />, text: t('mcp.hint.setup'), title: t('mcp.hint.setupTitle') } : entry.transport === 'stdio' && entry.command === 'uvx' ? { icon: <Terminal size={12} aria-hidden="true" />, text: t('mcp.hint.uv'), title: t('mcp.hint.uvTitle') } : null
  const testing = server?.health === 'starting'
  const signInByAgent = server?.health === 'needs-auth'
  return <li className="mcp-catalog-row">
    <McpBrandTile entry={entry} />
    <span className="mcp-catalog-text">
      <strong>{entry.name}{server && <i className={`mcp-catalog-state is-${server.health}`} title={server.healthMessage ?? stateLabel(server.health)}>{waitingForSignIn(server) ? t('mcp.signingIn') : stateLabel(server.health)}</i>}</strong>
      <small title={server?.health === 'unhealthy' && server.healthMessage ? server.healthMessage : entry.description}>{server && waitingForSignIn(server) ? t('mcp.finishSignIn') : signInByAgent ? t('mcp.agentSignsIn') : server?.health === 'unhealthy' && server.healthMessage ? server.healthMessage : entry.description}</small>
    </span>
    {server && waitingForSignIn(server) && <button type="button" className="mcp-catalog-hint is-action" onClick={() => void window.oxe.mcp.openSignIn(server.id)}><LogIn size={12} aria-hidden="true" />{t('mcp.openSignIn')}</button>}
    {!server && hint && <span className="mcp-catalog-hint" title={hint.title}>{hint.icon}{hint.text}</span>}
    {server
      ? <button type="button" className="mcp-catalog-add" aria-label={t('mcp.testLabel', { name: entry.name })} title={t('mcp.testTitle', { name: entry.name })} disabled={busy || testing} onClick={() => onTest(server)}>
        {busy || testing ? <Spinner size="sm" decorative /> : <PlugZap size={14} aria-hidden="true" />}
      </button>
      : <button type="button" className="mcp-catalog-add" aria-label={t('newWorkspace.add', { name: entry.name })} title={t('newWorkspace.add', { name: entry.name })} disabled={busy} onClick={() => onAdd(entry)}>
        {busy ? <Spinner size="sm" decorative /> : <Plus size={16} aria-hidden="true" />}
      </button>}
  </li>
}

/**
 * Connector catalog: brand tiles grouped by category, one `+` per server.
 * Servers that need no secrets are added directly; the rest open the form.
 */
export function McpCatalog({ servers, query, busyId, onAdd, onTest }: {
  servers: McpServer[]; query: string; busyId: string | null; onAdd(entry: McpCatalogEntry): void
} & ServerActions): ReactElement {
  const { t, i18n: { language } } = useTranslation('code')
  const byName = useMemo(() => new Map(servers.map(server => [server.name.toLowerCase(), server])), [servers])
  // The language is a dependency: searching reads descriptions in the interface language.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const matches = useMemo(() => searchCatalog(query), [query, language])
  const searching = query.trim().length > 0
  const sections = useMemo(() => {
    const result: Array<{ title: string; entries: McpCatalogEntry[] }> = []
    if (!searching) result.push({ title: t('mcp.popular'), entries: matches.filter(entry => entry.popular) })
    for (const category of MCP_CATALOG_CATEGORIES) result.push({ title: categoryLabel(category), entries: matches.filter(entry => entry.category === category && (searching || !entry.popular)) })
    return result.filter(section => section.entries.length > 0)
  }, [matches, searching, t])
  if (!matches.length) return <EmptyState compact title={t('mcp.noMatch')}>{t('mcp.noMatchHint')}</EmptyState>
  return <div className="mcp-catalog">
    {sections.map(section => <section key={section.title} aria-label={section.title}>
      <h3>{section.title}</h3>
      <ul>{section.entries.map(entry => {
        const server = byName.get(entry.id) ?? byName.get(entry.name.toLowerCase())
        return <CatalogRow key={`${section.title}:${entry.id}`} entry={entry} server={server} busy={busyId === entry.id || (server !== undefined && busyId === server.id)} onAdd={onAdd} onTest={onTest} />
      })}</ul>
    </section>)}
    <p className="mcp-catalog-count">{t('mcp.count', { count: MCP_CATALOG.length })}</p>
  </div>
}

/** White or near-black lettering, whichever reads better on a brand color (WCAG relative luminance). */
function readableOn(hex: string): string {
  const [r, g, b] = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return (1.05 / (luminance + 0.05)) >= ((luminance + 0.05) / 0.05) ? '#ffffff' : '#111111'
}
