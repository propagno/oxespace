import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MAX_SSH_CONFIG_BYTES = 256 * 1024

export interface ParsedSshConfigHost {
  name: string
  host: string
  port: number
  username: string
  authType: 'key' | 'agent'
  keyPath: string | null
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function expandHome(rawPath: string, homeDir: string): string {
  const cleaned = unquote(rawPath)
  if (cleaned === '~') return homeDir
  if (cleaned.startsWith('~/') || cleaned.startsWith('~\\')) {
    const base = homeDir.replace(/[\\/]+$/, '')
    const sep = homeDir.includes('\\') && !homeDir.includes('/') ? '\\' : '/'
    return `${base}${sep}${cleaned.slice(2)}`
  }
  return cleaned
}

function isWildcardPattern(alias: string): boolean {
  return !alias || alias.includes('*') || alias.includes('?') || alias.startsWith('!')
}

/**
 * Parses an OpenSSH client config (`~/.ssh/config`) into concrete host entries suitable for
 * assisted import into OXESpace's unified Remote SSH Hosts sidebar.
 *
 * Wildcard (`Host *`, `*.internal`) and negated patterns are skipped.
 */
export function parseSshConfig(content: string, homeDir: string = homedir()): ParsedSshConfigHost[] {
  const defaultUser = process.env.USER || process.env.USERNAME || 'root'
  const lines = content.split(/\r?\n/)
  const results: ParsedSshConfigHost[] = []

  interface DraftBlock {
    aliases: string[]
    hostName?: string
    port?: number
    user?: string
    identityFile?: string
  }

  let current: DraftBlock | null = null

  const flush = (): void => {
    if (!current) return
    for (const alias of current.aliases) {
      if (isWildcardPattern(alias)) continue
      const host = current.hostName?.trim() || alias
      const port = current.port && Number.isInteger(current.port) && current.port >= 1 && current.port <= 65535
        ? current.port
        : 22
      const username = current.user?.trim() || defaultUser
      const keyPath = current.identityFile ? expandHome(current.identityFile, homeDir) : null
      results.push({
        name: alias,
        host,
        port,
        username,
        authType: keyPath ? 'key' : 'agent',
        keyPath
      })
    }
    current = null
  }

  for (const rawLine of lines) {
    const withoutComment = rawLine.replace(/^\s*#.*$/, '').trim()
    if (!withoutComment) continue
    const match = /^([A-Za-z][A-Za-z0-9_-]*)(?:\s*=\s*|\s+)(.+)$/.exec(withoutComment)
    if (!match) continue
    const directive = match[1].toLowerCase()
    const rawValue = match[2].trim()

    if (directive === 'host') {
      flush()
      const aliases = rawValue.split(/\s+/).map(unquote).filter(Boolean)
      current = { aliases }
      continue
    }
    if (directive === 'match') {
      flush()
      current = null
      continue
    }
    if (!current) continue

    if (directive === 'hostname' && !current.hostName) {
      current.hostName = unquote(rawValue)
    } else if (directive === 'port' && current.port === undefined) {
      const parsedPort = Number(unquote(rawValue))
      if (Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535) current.port = parsedPort
    } else if (directive === 'user' && !current.user) {
      current.user = unquote(rawValue)
    } else if (directive === 'identityfile' && !current.identityFile) {
      current.identityFile = unquote(rawValue)
    }
  }

  flush()
  return results
}

/** Reads `~/.ssh/config` safely with a 256 KiB cap; returns `''` if the file does not exist. */
export function readUserSshConfig(homeDir: string = homedir()): string {
  const configPath = join(homeDir, '.ssh', 'config')
  try {
    const buf = readFileSync(configPath)
    if (buf.byteLength > MAX_SSH_CONFIG_BYTES) {
      return buf.subarray(0, MAX_SSH_CONFIG_BYTES).toString('utf8')
    }
    return buf.toString('utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}
