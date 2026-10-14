import { KeyRound, Loader2, LogIn, Play, Plus, SlidersHorizontal, Square, Terminal } from 'lucide-react'
import { useMemo, type ReactElement } from 'react'
import type { McpServer } from '../../../shared/types/mcp'
import { isDarkBrand, MCP_CATALOG, MCP_CATALOG_CATEGORIES, searchCatalog, type McpCatalogEntry } from './connectorCatalog'
import './McpCatalog.css'

export function McpBrandTile({ entry, size = 40 }: { entry: McpCatalogEntry; size?: number }): ReactElement {
  const color = isDarkBrand(entry.brand.hex) ? '#f8f8f2' : `#${entry.brand.hex}`
  return <span className="mcp-brand-tile" style={{ width: size, height: size }} aria-hidden="true">
    {entry.brand.icon
      ? <svg viewBox="0 0 24 24" width={size * 0.55} height={size * 0.55}><path d={entry.brand.icon.path} fill={color} /></svg>
      : <span className="mcp-brand-letter" style={{ background: `#${entry.brand.hex}`, color: readableOn(entry.brand.hex), fontSize: size * 0.42 }}>{entry.name.slice(0, 1).toUpperCase()}</span>}
  </span>
}

type ServerActions = { onStart(server: McpServer): void; onStop(server: McpServer): void }

const STATE_LABEL: Record<McpServer['health'], string> = { healthy: 'Running', starting: 'Starting', unhealthy: 'Error', unknown: 'Stopped' }

const waitingForSignIn = (server: McpServer): boolean => server.health === 'starting' && /sign in/i.test(server.healthMessage ?? '')

function CatalogRow({ entry, server, busy, onAdd, onStart, onStop }: { entry: McpCatalogEntry; server: McpServer | undefined; busy: boolean; onAdd(entry: McpCatalogEntry): void } & ServerActions): ReactElement {
  const hint = entry.signIn ? { icon: <LogIn size={11} aria-hidden="true" />, text: 'Browser sign-in' } : entry.requiredEnv?.length ? { icon: <KeyRound size={11} aria-hidden="true" />, text: 'Token' }
    : entry.configure ? { icon: <SlidersHorizontal size={11} aria-hidden="true" />, text: 'Setup' } : entry.command === 'uvx' ? { icon: <Terminal size={11} aria-hidden="true" />, text: 'Needs uv' } : null
  const running = server?.health === 'healthy' || server?.health === 'starting'
  return <li className="mcp-catalog-row">
    <McpBrandTile entry={entry} />
    <span className="mcp-catalog-text">
      <strong>{entry.name}{server && <i className={`mcp-catalog-state is-${server.health}`} title={server.healthMessage ?? STATE_LABEL[server.health]}>{waitingForSignIn(server) ? 'Signing in…' : STATE_LABEL[server.health]}</i>}</strong>
      <small title={server?.health === 'unhealthy' && server.healthMessage ? server.healthMessage : entry.description}>{server && waitingForSignIn(server) ? 'Finish the sign-in in your browser to connect.' : server?.health === 'unhealthy' && server.healthMessage ? server.healthMessage : entry.description}</small>
    </span>
    {server && waitingForSignIn(server) && <button type="button" className="mcp-catalog-hint is-action" onClick={() => void window.oxe.mcp.openSignIn(server.id)}><LogIn size={11} aria-hidden="true" />Open sign-in page</button>}
    {!server && hint && <span className="mcp-catalog-hint" title={entry.signIn ? 'Signs in with your browser' : entry.requiredEnv?.length ? 'Needs an access token' : entry.configure ? 'Needs a value before it can start' : 'Runs with uv (uvx), which must be installed'}>{hint.icon}{hint.text}</span>}
    {server
      ? <button type="button" className="mcp-catalog-add" aria-label={`${running ? 'Stop' : 'Start'} ${entry.name}`} title={`${running ? 'Stop' : 'Start'} ${entry.name}`} disabled={busy} onClick={() => running ? onStop(server) : onStart(server)}>
        {busy ? <Loader2 size={15} className="usage-spin" aria-hidden="true" /> : running ? <Square size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
      </button>
      : <button type="button" className="mcp-catalog-add" aria-label={`Add ${entry.name}`} title={`Add ${entry.name}`} disabled={busy} onClick={() => onAdd(entry)}>
        {busy ? <Loader2 size={15} className="usage-spin" aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
      </button>}
  </li>
}

/**
 * Connector catalog: brand tiles grouped by category, one `+` per server.
 * Servers that need no secrets are added directly; the rest open the form.
 */
export function McpCatalog({ servers, query, busyId, onAdd, onStart, onStop }: {
  servers: McpServer[]; query: string; busyId: string | null; onAdd(entry: McpCatalogEntry): void
} & ServerActions): ReactElement {
  const byName = useMemo(() => new Map(servers.map(server => [server.name.toLowerCase(), server])), [servers])
  const matches = useMemo(() => searchCatalog(query), [query])
  const searching = query.trim().length > 0
  const sections = useMemo(() => {
    const result: Array<{ title: string; entries: McpCatalogEntry[] }> = []
    if (!searching) result.push({ title: 'Popular', entries: matches.filter(entry => entry.popular) })
    for (const category of MCP_CATALOG_CATEGORIES) result.push({ title: category, entries: matches.filter(entry => entry.category === category && (searching || !entry.popular)) })
    return result.filter(section => section.entries.length > 0)
  }, [matches, searching])
  if (!matches.length) return <div className="mcp-panel-empty"><strong>No matching connectors</strong><span>Try another name, or add a custom server.</span></div>
  return <div className="mcp-catalog">
    {sections.map(section => <section key={section.title} aria-label={section.title}>
      <h3>{section.title}</h3>
      <ul>{section.entries.map(entry => {
        const server = byName.get(entry.id) ?? byName.get(entry.name.toLowerCase())
        return <CatalogRow key={`${section.title}:${entry.id}`} entry={entry} server={server} busy={busyId === entry.id || (server !== undefined && busyId === server.id)} onAdd={onAdd} onStart={onStart} onStop={onStop} />
      })}</ul>
    </section>)}
    <p className="mcp-catalog-count">{MCP_CATALOG.length} connectors</p>
  </div>
}

/** White or near-black lettering, whichever reads better on a brand color (WCAG relative luminance). */
function readableOn(hex: string): string {
  const [r, g, b] = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return (1.05 / (luminance + 0.05)) >= ((luminance + 0.05) / 0.05) ? '#ffffff' : '#111111'
}
