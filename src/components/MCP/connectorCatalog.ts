import type { SimpleIcon } from 'simple-icons'
import {
  siAirtable, siAsana, siAtlassian, siBrave, siCloudflare, siDiscord, siDocker, siDropbox, siFigma, siFirebase, siGithub, siGitlab,
  siGooglemaps, siGrafana, siHubspot, siLinear, siMongodb, siMysql, siNetlify, siNotion, siPostgresql, siRedis, siSentry, siShopify,
  siSqlite, siStripe, siSupabase, siTrello, siVercel
} from 'simple-icons'

export type McpCatalogCategory = 'Development' | 'Productivity' | 'Data' | 'Browser & Docs' | 'Communication' | 'Utilities'

export const MCP_CATALOG_CATEGORIES: McpCatalogCategory[] = ['Development', 'Productivity', 'Data', 'Browser & Docs', 'Communication', 'Utilities']

export interface McpCatalogEntry {
  id: string
  name: string
  description: string
  category: McpCatalogCategory
  /** Shown in the "Popular" band at the top of the catalog. */
  popular?: boolean
  brand: { hex: string; icon?: SimpleIcon }
  command: string
  args: string[]
  /** Variables the user must provide before the server can start. */
  requiredEnv?: string[]
  /** Remote servers authenticate in the browser through `mcp-remote`. */
  signIn?: boolean
  /** Non-secret defaults written to the environment (for example read-only mode). */
  env?: Record<string, string>
  /** Something in `args` must be edited before the server can start; opens the form with this note. */
  configure?: string
}

/** Remote MCP endpoints are bridged to stdio with `mcp-remote`, which also handles OAuth in the browser. */
const remote = (url: string): Pick<McpCatalogEntry, 'command' | 'args' | 'signIn'> => ({ command: 'npx', args: ['-y', 'mcp-remote', url], signIn: true })
const npx = (...args: string[]): Pick<McpCatalogEntry, 'command' | 'args'> => ({ command: 'npx', args: ['-y', ...args] })
const uvx = (...args: string[]): Pick<McpCatalogEntry, 'command' | 'args'> => ({ command: 'uvx', args })

export const MCP_CATALOG: McpCatalogEntry[] = [
  { id: 'github', name: 'GitHub', description: 'Triage PRs, issues, CI, and publish flows', category: 'Development', popular: true, brand: { hex: '181717', icon: siGithub }, ...npx('@modelcontextprotocol/server-github'), requiredEnv: ['GITHUB_PERSONAL_ACCESS_TOKEN'] },
  { id: 'git', name: 'Git', description: 'Local repository operations', category: 'Development', brand: { hex: 'F05032' }, ...uvx('mcp-server-git', '--repository', '.') },
  { id: 'gitlab', name: 'GitLab', description: 'Projects, merge requests and pipelines', category: 'Development', brand: { hex: 'FC6D26', icon: siGitlab }, ...npx('@modelcontextprotocol/server-gitlab'), requiredEnv: ['GITLAB_PERSONAL_ACCESS_TOKEN'] },
  { id: 'linear', name: 'Linear', description: 'Issues, projects and cycles', category: 'Development', popular: true, brand: { hex: '5E6AD2', icon: siLinear }, ...remote('https://mcp.linear.app/sse') },
  { id: 'sentry', name: 'Sentry', description: 'Inspect errors and performance issues', category: 'Development', brand: { hex: '362D59', icon: siSentry }, ...remote('https://mcp.sentry.dev/mcp') },
  { id: 'vercel', name: 'Vercel', description: 'Projects, deployments and logs', category: 'Development', brand: { hex: '000000', icon: siVercel }, ...remote('https://mcp.vercel.com') },
  { id: 'cloudflare', name: 'Cloudflare', description: 'Search Cloudflare documentation', category: 'Development', brand: { hex: 'F38020', icon: siCloudflare }, ...remote('https://docs.mcp.cloudflare.com/sse') },
  { id: 'netlify', name: 'Netlify', description: 'Create, deploy and manage sites', category: 'Development', brand: { hex: '00C7B7', icon: siNetlify }, ...npx('@netlify/mcp') },
  { id: 'firebase', name: 'Firebase', description: 'Manage Firebase projects and apps', category: 'Development', brand: { hex: 'DD2C00', icon: siFirebase }, ...npx('firebase-tools@latest', 'experimental:mcp') },
  { id: 'docker', name: 'Docker', description: 'Containers, images and volumes', category: 'Development', brand: { hex: '2496ED', icon: siDocker }, ...uvx('mcp-server-docker') },
  { id: 'figma', name: 'Figma', description: 'Create designs, ship to code', category: 'Productivity', popular: true, brand: { hex: 'F24E1E', icon: siFigma }, ...remote('http://127.0.0.1:3845/sse') },
  { id: 'notion', name: 'Notion', description: 'Create docs, tasks and databases', category: 'Productivity', popular: true, brand: { hex: '000000', icon: siNotion }, ...remote('https://mcp.notion.com/mcp') },
  { id: 'notion-token', name: 'Notion (API token)', description: 'Local server with an integration token, no browser sign-in', category: 'Productivity', brand: { hex: '000000', icon: siNotion }, ...npx('@notionhq/notion-mcp-server'), requiredEnv: ['NOTION_TOKEN'], configure: 'Create an integration at notion.so/profile/integrations, paste its token, and share the pages it should read with that integration.' },
  { id: 'azure-devops', name: 'Azure DevOps', description: 'Work items, repos, pull requests and pipelines', category: 'Development', popular: true, brand: { hex: '0078D7' }, ...npx('@azure-devops/mcp', '<your-organization>'), configure: 'Replace <your-organization> with the name in dev.azure.com/<organization>. A Microsoft sign-in opens in your browser on first use; append "-a azcli" to the arguments to reuse an existing "az login" instead.' },
  { id: 'atlassian', name: 'Atlassian', description: 'Jira issues and Confluence pages', category: 'Productivity', brand: { hex: '0052CC', icon: siAtlassian }, ...remote('https://mcp.atlassian.com/v1/sse') },
  { id: 'asana', name: 'Asana', description: 'Tasks, projects and goals', category: 'Productivity', brand: { hex: 'F06A6A', icon: siAsana }, ...remote('https://mcp.asana.com/sse') },
  { id: 'airtable', name: 'Airtable', description: 'Read and write bases and records', category: 'Productivity', brand: { hex: '18BFFF', icon: siAirtable }, ...npx('airtable-mcp-server'), requiredEnv: ['AIRTABLE_API_KEY'] },
  { id: 'trello', name: 'Trello', description: 'Boards, lists and cards', category: 'Productivity', brand: { hex: '0052CC', icon: siTrello }, ...npx('@delorenj/mcp-server-trello'), requiredEnv: ['TRELLO_API_KEY', 'TRELLO_TOKEN'] },
  { id: 'hubspot', name: 'HubSpot', description: 'Insights to action in HubSpot', category: 'Productivity', brand: { hex: 'FF7A59', icon: siHubspot }, ...npx('@hubspot/mcp-server'), requiredEnv: ['PRIVATE_APP_ACCESS_TOKEN'] },
  { id: 'shopify', name: 'Shopify', description: 'Create and manage your store', category: 'Productivity', brand: { hex: '7AB55C', icon: siShopify }, ...npx('@shopify/dev-mcp@latest') },
  { id: 'stripe', name: 'Stripe', description: 'Accept payments. Grow revenue.', category: 'Productivity', brand: { hex: '635BFF', icon: siStripe }, ...remote('https://mcp.stripe.com') },
  { id: 'dropbox', name: 'Dropbox', description: 'Find, create, and take action', category: 'Productivity', brand: { hex: '0061FF', icon: siDropbox }, ...npx('@dropbox/mcp-server'), requiredEnv: ['DROPBOX_ACCESS_TOKEN'] },
  { id: 'supabase', name: 'Supabase', description: 'Manage and query databases', category: 'Data', popular: true, brand: { hex: '3FCF8E', icon: siSupabase }, ...npx('@supabase/mcp-server-supabase@latest'), requiredEnv: ['SUPABASE_ACCESS_TOKEN'] },
  { id: 'postgres', name: 'PostgreSQL', description: 'Read-only SQL against a database', category: 'Data', brand: { hex: '4169E1', icon: siPostgresql }, ...npx('@modelcontextprotocol/server-postgres', 'postgresql://user:password@localhost:5432/database'), configure: 'Replace the connection string in the arguments with your database URL. This server is read-only.' },
  { id: 'sqlite', name: 'SQLite', description: 'Query a local SQLite database', category: 'Data', brand: { hex: '003B57', icon: siSqlite }, ...uvx('mcp-server-sqlite', '--db-path', './database.db') },
  { id: 'mysql', name: 'MySQL', description: 'Inspect schemas and run queries', category: 'Data', brand: { hex: '4479A1', icon: siMysql }, ...npx('@benborla29/mcp-server-mysql'), requiredEnv: ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASS', 'MYSQL_DB'] },
  { id: 'mongodb', name: 'MongoDB', description: 'Collections, documents and aggregations', category: 'Data', brand: { hex: '47A248', icon: siMongodb }, ...npx('mongodb-mcp-server@latest'), requiredEnv: ['MDB_MCP_CONNECTION_STRING'], env: { MDB_MCP_READ_ONLY: 'true' }, configure: 'Starts in read-only mode. Set MDB_MCP_READ_ONLY=false in the variables to allow writes.' },
  { id: 'redis', name: 'Redis', description: 'Keys, streams and data structures', category: 'Data', brand: { hex: 'FF4438', icon: siRedis }, ...uvx('--from', 'redis-mcp-server@latest', 'redis-mcp-server') },
  { id: 'grafana', name: 'Grafana', description: 'Dashboards, alerts and datasources', category: 'Data', brand: { hex: 'F46800', icon: siGrafana }, ...uvx('mcp-grafana'), requiredEnv: ['GRAFANA_URL', 'GRAFANA_API_KEY'] },
  { id: 'playwright', name: 'Playwright', description: 'Browser automation, screenshots and UI tests', category: 'Browser & Docs', popular: true, brand: { hex: '2EAD33' }, ...npx('@playwright/mcp@latest') },
  { id: 'context7', name: 'Context7', description: 'Up-to-date library documentation', category: 'Browser & Docs', brand: { hex: '059669' }, ...npx('@upstash/context7-mcp@latest') },
  { id: 'fetch', name: 'Fetch', description: 'Fetch web pages as Markdown', category: 'Browser & Docs', brand: { hex: '0EA5E9' }, ...uvx('mcp-server-fetch') },
  { id: 'brave-search', name: 'Brave Search', description: 'Web and local search', category: 'Browser & Docs', brand: { hex: 'FB542B', icon: siBrave }, ...npx('@modelcontextprotocol/server-brave-search'), requiredEnv: ['BRAVE_API_KEY'] },
  { id: 'google-maps', name: 'Google Maps', description: 'Places, directions and geocoding', category: 'Browser & Docs', brand: { hex: '4285F4', icon: siGooglemaps }, ...npx('@modelcontextprotocol/server-google-maps'), requiredEnv: ['GOOGLE_MAPS_API_KEY'] },
  { id: 'slack', name: 'Slack', description: 'Read and manage Slack', category: 'Communication', popular: true, brand: { hex: '4A154B' }, ...npx('@modelcontextprotocol/server-slack'), requiredEnv: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'] },
  { id: 'discord', name: 'Discord', description: 'Send and read channel messages', category: 'Communication', brand: { hex: '5865F2', icon: siDiscord }, ...npx('mcp-discord'), requiredEnv: ['DISCORD_TOKEN'] },
  { id: 'filesystem', name: 'Filesystem', description: 'Read and write files in this workspace', category: 'Utilities', brand: { hex: '64748B' }, ...npx('@modelcontextprotocol/server-filesystem', '.') },
  { id: 'memory', name: 'Memory', description: 'Persistent knowledge graph', category: 'Utilities', brand: { hex: '8B5CF6' }, ...npx('@modelcontextprotocol/server-memory') },
  { id: 'sequential-thinking', name: 'Sequential Thinking', description: 'Structured step-by-step reasoning', category: 'Utilities', brand: { hex: 'F59E0B' }, ...npx('@modelcontextprotocol/server-sequential-thinking') },
  { id: 'time', name: 'Time', description: 'Current time and timezone conversion', category: 'Utilities', brand: { hex: '14B8A6' }, ...uvx('mcp-server-time') }
]

/** Whether a brand colour is too dark to read on a dark tile. */
export function isDarkBrand(hex: string): boolean {
  const value = parseInt(hex, 16)
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(channel => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.12
}

/** `KEY=` lines pre-filled into the form for variables the user must provide. */
export function envTemplate(entry: McpCatalogEntry): string {
  return [...(entry.requiredEnv ?? []).map(key => `${key}=`), ...Object.entries(entry.env ?? {}).map(([key, value]) => `${key}=${value}`)].join('\n')
}

export function searchCatalog(query: string, entries: McpCatalogEntry[] = MCP_CATALOG): McpCatalogEntry[] {
  const needle = query.trim().toLowerCase()
  return needle ? entries.filter(entry => `${entry.name} ${entry.description} ${entry.category}`.toLowerCase().includes(needle)) : entries
}
