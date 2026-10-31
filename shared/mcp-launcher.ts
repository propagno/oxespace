import type { McpServerConfig } from './types/mcp'

const RUNNERS = new Set(['npx', 'pnpx', 'bunx', 'uvx', 'pipx'])
const EXACT = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/

/**
 * The package a runner starts (`npx -y pkg@1.2.3`, `uvx pkg==1.2.3`), with its version when it is an exact one.
 * `version` null means each start may run a different release. Null for a local program or a URL.
 */
export function launcherPackage(config: McpServerConfig): { package: string; version: string | null } | null {
  if (config.transport !== 'stdio') return null
  const command = ((config.command ?? '').trim().replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase().replace(/\.(?:cmd|exe|bat|ps1)$/, '')
  const args = config.args ?? []
  let rest: string[]
  if (RUNNERS.has(command)) rest = args
  else if (['npm', 'pnpm', 'yarn', 'bun'].includes(command) && (args[0] === 'dlx' || args[0] === 'exec' || args[0] === 'x')) rest = args.slice(1)
  else return null
  // Flags that take a value ("--from pkg", "-p pkg") name the package themselves.
  const from = rest.findIndex(arg => arg === '--from' || arg === '-p' || arg === '--package')
  const spec = from >= 0 ? rest[from + 1] : rest.find(arg => !arg.startsWith('-'))
  if (!spec) return null
  const match = /^(@[^/@]+\/[^@=]+|[^@=/][^@=]*?)(?:(?:@|==)(.+))?$/.exec(spec)
  if (!match) return null
  const version = match[2] ?? null
  return { package: match[1], version: version && EXACT.test(version) ? version : null }
}
