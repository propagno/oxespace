/**
 * Plain-language reasons an MCP server may not start, read from the test's error, the server's
 * command and variables, and the Node.js it runs on. Providers only report "failed".
 */
export interface McpFailureInput {
  message: string | null
  command?: string
  env?: Record<string, string>
  /** Variables the catalog entry says the server cannot start without. */
  requiredEnv?: string[]
  /** `node --version` as the server would run it, e.g. "v18.19.1"; null when unknown. */
  node?: string | null
}

/** Node.js below this is too old for current MCP servers (mongodb-mcp-server needs ^20.19, ^22.13 or 24+). */
const NODE_MINIMUM: [number, number] = [20, 19]

const nodeTooOld = (version: string): boolean => {
  const match = /^v?(\d+)\.(\d+)/.exec(version)
  if (!match) return false
  const [major, minor] = [Number(match[1]), Number(match[2])]
  return major < NODE_MINIMUM[0] || (major === NODE_MINIMUM[0] && minor < NODE_MINIMUM[1])
}

/** A connection string whose password has a character that must be percent-encoded. */
const unencodedCredentials = (value: string): boolean => {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?]*)/i.exec(value.trim())
  if (!match) return false
  const authority = match[1]
  const at = authority.lastIndexOf('@')
  if (at < 0) return false
  // Two "@" means one belongs to the password; "#" there cuts the string short.
  return authority.slice(0, at).includes('@') || /[#\s]/.test(authority.slice(0, at))
}

export function mcpFailureHints(input: McpFailureInput): string[] {
  const hints: string[] = []
  const message = input.message ?? ''
  const env = input.env ?? {}
  if (input.node && nodeTooOld(input.node)) {
    hints.push(`Node.js ${input.node} is too old for this server; it needs 20.19 or newer (22 LTS recommended). Ubuntu 24.04's apt package is Node 18: install Node 22 (NodeSource or nvm), then restart OXESpace.`)
  } else if (!input.node && /\b(?:npx|node|npm)\b/i.test(input.command ?? '') && /ENOENT|not found|not recognized/i.test(message)) {
    hints.push('Node.js was not found on the PATH OXESpace uses. Install Node 22 LTS, then restart OXESpace.')
  }
  const missing = (input.requiredEnv ?? []).filter(name => !env[name]?.trim())
  if (missing.length) hints.push(`Set ${missing.join(', ')} in the server's variables; it cannot start without ${missing.length === 1 ? 'it' : 'them'}.`)
  const badConnection = Object.entries(env).find(([, value]) => unencodedCredentials(value))
  if (badConnection) hints.push(`The password in ${badConnection[0]} has a character that must be encoded: write @ as %40, # as %23 and : as %3A.`)
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timed? ?out|Server selection/i.test(message)) {
    hints.push('The server could not reach its host. Check the network or VPN and, for a cloud database such as MongoDB Atlas, that this machine’s IP is in its access list.')
  }
  if (/auth(?:entication)? failed|bad auth|unauthori[sz]ed|\b40[13]\b/i.test(message)) hints.push('The credentials were refused. Check the user, password and the database the user belongs to.')
  return hints
}
