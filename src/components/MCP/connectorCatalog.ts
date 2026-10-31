import type { SimpleIcon } from 'simple-icons'
import type { McpServerConfig } from '../../../shared/types/mcp'
import type codeCatalog from '../../../shared/locales/en/code.json'
import { i18n } from '../../i18n'
import {
  siAirtable, siAsana, siAtlassian, siBrave, siCloudflare, siDiscord, siDocker, siFigma, siFirebase, siGithub, siGitlab,
  siGrafana, siHubspot, siLinear, siMongodb, siMysql, siNetlify, siNotion, siPostgresql, siRedis, siSentry, siShopify,
  siSqlite, siStripe, siSupabase, siTrello, siVercel
} from 'simple-icons'

export type McpCatalogCategory = 'Development' | 'Productivity' | 'Data' | 'Browser & Docs' | 'Communication' | 'Utilities'

export const MCP_CATALOG_CATEGORIES: McpCatalogCategory[] = ['Development', 'Productivity', 'Data', 'Browser & Docs', 'Communication', 'Utilities']

interface McpCatalogBase {
  id: string
  name: string
  /** One line about the connector, from the code catalog (mcp.connectors.<id>) in the interface language. */
  readonly description: string
  category: McpCatalogCategory
  /** Shown in the "Popular" band at the top of the catalog. */
  popular?: boolean
  brand: { hex: string; icon?: SimpleIcon }
  /** Values the user must provide: environment variables, or `${NAME}` in a remote server's headers. */
  requiredEnv?: string[]
  /** The agent signs in to this remote server in the browser on first use. */
  signIn?: boolean
  /** Non-secret defaults written to the environment (for example read-only mode). */
  env?: Record<string, string>
  /** Something must be filled in before the server can start; opens the form with this note (mcp.connectors.<id>.configure). */
  readonly configure?: string
}

/** A catalog entry as written below: its words are attached from the code catalog afterwards. */
type CatalogSource = Omit<McpCatalogBase, 'description' | 'configure'> & (
  | { transport: 'stdio'; command: string; args: string[] }
  | { transport: 'http' | 'sse'; url: string; headers?: Record<string, string> }
)

/**
 * A local server the agent spawns, or a remote one it reaches over HTTP. Remote
 * servers are written to the agent's configuration as they are, so the agent
 * owns the connection and the sign-in; OXESpace only tests that they answer.
 */
export type McpCatalogEntry = McpCatalogBase & (
  | { transport: 'stdio'; command: string; args: string[] }
  | { transport: 'http' | 'sse'; url: string; headers?: Record<string, string> }
)

/** Streamable HTTP endpoint that signs in with OAuth (dynamic client registration), done by the agent. */
const remote = (url: string) => ({ transport: 'http' as const, url, signIn: true })
const npx = (...args: string[]) => ({ transport: 'stdio' as const, command: 'npx', args: ['-y', ...args] })
const uvx = (...args: string[]) => ({ transport: 'stdio' as const, command: 'uvx', args })

const SOURCES: CatalogSource[] = [
  // GitHub's own server. It does not offer a browser sign-in to other apps, so it takes a personal access token in a header.
  { id: 'github', name: 'GitHub', category: 'Development', popular: true, brand: { hex: '181717', icon: siGithub },
    transport: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}' }, requiredEnv: ['GITHUB_PERSONAL_ACCESS_TOKEN'] },
  { id: 'git', name: 'Git', category: 'Development', brand: { hex: 'F05032' }, ...uvx('mcp-server-git', '--repository', '.') },
  { id: 'gitlab', name: 'GitLab', category: 'Development', brand: { hex: 'FC6D26', icon: siGitlab }, ...remote('https://gitlab.com/api/v4/mcp') },
  { id: 'linear', name: 'Linear', category: 'Development', popular: true, brand: { hex: '5E6AD2', icon: siLinear }, ...remote('https://mcp.linear.app/mcp') },
  { id: 'sentry', name: 'Sentry', category: 'Development', brand: { hex: '362D59', icon: siSentry }, ...remote('https://mcp.sentry.dev/mcp') },
  { id: 'vercel', name: 'Vercel', category: 'Development', brand: { hex: '000000', icon: siVercel }, ...remote('https://mcp.vercel.com') },
  { id: 'cloudflare', name: 'Cloudflare', category: 'Development', brand: { hex: 'F38020', icon: siCloudflare }, ...remote('https://docs.mcp.cloudflare.com/mcp'), signIn: false },
  { id: 'netlify', name: 'Netlify', category: 'Development', brand: { hex: '00C7B7', icon: siNetlify }, ...npx('@netlify/mcp') },
  { id: 'firebase', name: 'Firebase', category: 'Development', brand: { hex: 'DD2C00', icon: siFirebase }, ...npx('firebase-tools@latest', 'experimental:mcp') },
  { id: 'docker', name: 'Docker', category: 'Development', brand: { hex: '2496ED', icon: siDocker }, ...uvx('mcp-server-docker') },
  { id: 'figma', name: 'Figma', category: 'Productivity', popular: true, brand: { hex: 'F24E1E', icon: siFigma }, ...remote('https://mcp.figma.com/mcp') },
  { id: 'notion', name: 'Notion', category: 'Productivity', popular: true, brand: { hex: '000000', icon: siNotion }, ...remote('https://mcp.notion.com/mcp') },
  { id: 'notion-token', name: 'Notion (API token)', category: 'Productivity', brand: { hex: '000000', icon: siNotion }, ...npx('@notionhq/notion-mcp-server'), requiredEnv: ['NOTION_TOKEN'] },
  { id: 'azure-devops', name: 'Azure DevOps', category: 'Development', popular: true, brand: { hex: '0078D7' }, ...npx('@azure-devops/mcp', '<your-organization>') },
  { id: 'atlassian', name: 'Atlassian', category: 'Productivity', brand: { hex: '0052CC', icon: siAtlassian }, ...remote('https://mcp.atlassian.com/v1/mcp') },
  { id: 'asana', name: 'Asana', category: 'Productivity', brand: { hex: 'F06A6A', icon: siAsana }, transport: 'sse', url: 'https://mcp.asana.com/sse', signIn: true },
  { id: 'airtable', name: 'Airtable', category: 'Productivity', brand: { hex: '18BFFF', icon: siAirtable }, ...npx('airtable-mcp-server'), requiredEnv: ['AIRTABLE_API_KEY'] },
  { id: 'trello', name: 'Trello', category: 'Productivity', brand: { hex: '0052CC', icon: siTrello }, ...npx('@delorenj/mcp-server-trello'), requiredEnv: ['TRELLO_API_KEY', 'TRELLO_TOKEN'] },
  { id: 'hubspot', name: 'HubSpot', category: 'Productivity', brand: { hex: 'FF7A59', icon: siHubspot }, ...npx('@hubspot/mcp-server'), requiredEnv: ['PRIVATE_APP_ACCESS_TOKEN'] },
  { id: 'shopify', name: 'Shopify', category: 'Productivity', brand: { hex: '7AB55C', icon: siShopify }, ...npx('@shopify/dev-mcp@latest') },
  { id: 'stripe', name: 'Stripe', category: 'Productivity', brand: { hex: '635BFF', icon: siStripe }, ...remote('https://mcp.stripe.com') },
  { id: 'supabase', name: 'Supabase', category: 'Data', popular: true, brand: { hex: '3FCF8E', icon: siSupabase }, ...npx('@supabase/mcp-server-supabase@latest'), requiredEnv: ['SUPABASE_ACCESS_TOKEN'] },
  { id: 'postgres', name: 'PostgreSQL', category: 'Data', brand: { hex: '4169E1', icon: siPostgresql }, ...npx('@microsoft/postgres-mcp@latest', 'run'), requiredEnv: ['POSTGRES_MCP_CONNECTION_STRING'] },
  { id: 'sqlite', name: 'SQLite', category: 'Data', brand: { hex: '003B57', icon: siSqlite }, ...uvx('mcp-server-sqlite', '--db-path', './database.db') },
  { id: 'mysql', name: 'MySQL', category: 'Data', brand: { hex: '4479A1', icon: siMysql }, ...npx('@benborla29/mcp-server-mysql'), requiredEnv: ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASS', 'MYSQL_DB'] },
  { id: 'mongodb', name: 'MongoDB', category: 'Data', brand: { hex: '47A248', icon: siMongodb }, ...npx('mongodb-mcp-server@latest'), requiredEnv: ['MDB_MCP_CONNECTION_STRING'], env: { MDB_MCP_READ_ONLY: 'true' } },
  { id: 'redis', name: 'Redis', category: 'Data', brand: { hex: 'FF4438', icon: siRedis }, ...uvx('--from', 'redis-mcp-server@latest', 'redis-mcp-server') },
  { id: 'grafana', name: 'Grafana', category: 'Data', brand: { hex: 'F46800', icon: siGrafana }, ...uvx('mcp-grafana'), requiredEnv: ['GRAFANA_URL', 'GRAFANA_API_KEY'] },
  { id: 'playwright', name: 'Playwright', category: 'Browser & Docs', popular: true, brand: { hex: '2EAD33' }, ...npx('@playwright/mcp@latest') },
  { id: 'context7', name: 'Context7', category: 'Browser & Docs', brand: { hex: '059669' }, ...npx('@upstash/context7-mcp@latest') },
  { id: 'fetch', name: 'Fetch', category: 'Browser & Docs', brand: { hex: '0EA5E9' }, ...uvx('mcp-server-fetch') },
  { id: 'brave-search', name: 'Brave Search', category: 'Browser & Docs', brand: { hex: 'FB542B', icon: siBrave }, ...npx('@brave/brave-search-mcp-server', '--transport', 'stdio'), requiredEnv: ['BRAVE_API_KEY'] },
  { id: 'slack', name: 'Slack', category: 'Communication', popular: true, brand: { hex: '4A154B' }, ...npx('slack-mcp-server@latest', '--transport', 'stdio'), requiredEnv: ['SLACK_MCP_XOXB_TOKEN'] },
  { id: 'discord', name: 'Discord', category: 'Communication', brand: { hex: '5865F2', icon: siDiscord }, ...npx('mcp-discord'), requiredEnv: ['DISCORD_TOKEN'] },
  { id: 'filesystem', name: 'Filesystem', category: 'Utilities', brand: { hex: '64748B' }, ...npx('@modelcontextprotocol/server-filesystem', '.') },
  { id: 'memory', name: 'Memory', category: 'Utilities', brand: { hex: '8B5CF6' }, ...npx('@modelcontextprotocol/server-memory') },
  { id: 'sequential-thinking', name: 'Sequential Thinking', category: 'Utilities', brand: { hex: 'F59E0B' }, ...npx('@modelcontextprotocol/server-sequential-thinking') },
  { id: 'time', name: 'Time', category: 'Utilities', brand: { hex: '14B8A6' }, ...uvx('mcp-server-time') }
]

// The English text above documents each entry; on screen, description and setup note come from the code catalog
// (mcp.connectors.<id>) in the interface language.
type ConnectorKey = keyof typeof codeCatalog.mcp.connectors
/** Connectors with a setup note: the form opens with it before the server can be added. */
const NEEDS_SETUP = new Set(['github', 'notion-token', 'azure-devops', 'mongodb'])

export const MCP_CATALOG: McpCatalogEntry[] = SOURCES.map(source => {
  const id = source.id as ConnectorKey
  const entry = Object.defineProperty({ ...source }, 'description', { enumerable: true, get: () => i18n.t(`mcp.connectors.${id}.description`, { ns: 'code' }) })
  if (NEEDS_SETUP.has(id)) Object.defineProperty(entry, 'configure', { enumerable: true, get: () => i18n.t(`mcp.connectors.${id}.configure` as `mcp.connectors.github.configure`, { ns: 'code' }) })
  return entry as McpCatalogEntry
})

/** A catalog category in the interface language. */
export function categoryLabel(category: McpCatalogCategory): string {
  return i18n.t(`mcp.category.${category}`, { ns: 'code' })
}

/** Whether a brand colour is too dark to read on a dark tile. */
export function isDarkBrand(hex: string): boolean {
  const value = parseInt(hex, 16)
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(channel => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.12
}

/**
 * The server configuration for a catalog entry and the values the user gave.
 * For a remote server the values fill `${NAME}` in its headers and are not
 * kept as environment.
 */
export function catalogConfig(entry: McpCatalogEntry, values: Record<string, string> = {}): McpServerConfig {
  if (entry.transport === 'stdio') return { transport: 'stdio', command: entry.command, args: entry.args, env: { ...(entry.env ?? {}), ...values } }
  const headers = Object.fromEntries(Object.entries(entry.headers ?? {}).map(([name, value]) => [name, value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key: string) => values[key] ?? '')]))
  return { transport: entry.transport, url: entry.url, headers }
}

/** `KEY=` lines pre-filled into the form for variables the user must provide. */
export function envTemplate(entry: McpCatalogEntry): string {
  return [...(entry.requiredEnv ?? []).map(key => `${key}=`), ...Object.entries(entry.env ?? {}).map(([key, value]) => `${key}=${value}`)].join('\n')
}

export function searchCatalog(query: string, entries: McpCatalogEntry[] = MCP_CATALOG): McpCatalogEntry[] {
  const needle = query.trim().toLowerCase()
  return needle ? entries.filter(entry => `${entry.name} ${entry.description} ${entry.category}`.toLowerCase().includes(needle)) : entries
}
