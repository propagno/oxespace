import type {
  ThreadRequest,
  ThreadRequestImpact,
  ThreadRequestImpactKind,
  ThreadRequestImpactLang,
  ThreadRequestImpactRisk
} from '../../../../shared/types/thread'
import { redactSecrets } from '../../../../shared/secrets'
import { checkWorkspacePath } from '../conversation/path-safety'
import { classifyShellRisk } from '../conversation/shell-risk'
import { baseName, splitShellCommand, tokenize, unwrapPowerShell, writesFile } from '../conversation/shell-command-rules'
import { parseShell } from '../conversation/shell-parse'
import { relativeTo } from '../remote/text'

export interface RequestImpactDatabaseContext {
  name: string
  env?: string
  engine?: string
}

export interface RequestImpactContext {
  root: string
  workspaceName?: string
  database?: RequestImpactDatabaseContext
}

const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch', 'fileChange', 'edit', 'write'])
const CONTAINER_DESTRUCTIVE = /^(remove|rm|delete|kill|prune|down)\b/i
const CONTAINER_REVERSIBLE = /^(stop|start|restart|pause|unpause)\b/i
const LOW_RISK_CHECKS = /^(?:(npm|pnpm|yarn|bun)\s+(?:test|t|tst|run\s+(?:test|lint|typecheck|check)(?::\S+)?)\b|(?:vitest|jest|pytest|tsc)\b|cargo\s+(?:test|check|clippy)\b|go\s+(?:test|vet)\b)/i

function bareToolName(toolName: string | undefined): string {
  const raw = (toolName ?? '').trim()
  const mcp = raw.match(/^mcp__.+?__(.+)$/)
  return mcp ? mcp[1] : raw
}

function stripLeadingWrappers(tokens: readonly string[]): string[] {
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]
    if (ENV_ASSIGN.test(token)) { index += 1; continue }
    const head = baseName(token)
    if (head === 'env') {
      index += 1
      while (index < tokens.length) {
        const next = tokens[index]
        if (ENV_ASSIGN.test(next)) { index += 1; continue }
        if (next === '-u' || next === '--unset' || next === '-C' || next === '--chdir' || next === '-S') { index += 2; continue }
        if (next.startsWith('-')) { index += 1; continue }
        break
      }
      continue
    }
    if (head === 'timeout') {
      index += 1
      while (index < tokens.length && tokens[index].startsWith('-')) {
        const flag = tokens[index]
        index += (flag === '-k' || flag === '-s') ? 2 : 1
      }
      if (index < tokens.length) index += 1
      continue
    }
    if (head === 'time') {
      index += 1
      while (index < tokens.length && tokens[index].startsWith('-')) index += 1
      continue
    }
    if (head === 'nohup') { index += 1; continue }
    break
  }
  return tokens.slice(index)
}

function gitSubcommand(tokens: readonly string[]): { verb: string; rest: string[] } | null {
  if (baseName(tokens[0] ?? '') !== 'git') return null
  let index = 1
  while (index < tokens.length) {
    const token = tokens[index]
    if (token === '-C' || token === '-c' || token === '--git-dir' || token === '--work-tree') { index += 2; continue }
    if (token.startsWith('-')) { index += 1; continue }
    return { verb: token, rest: tokens.slice(index + 1) }
  }
  return null
}

function isPushTokens(rawTokens: readonly string[]): boolean {
  const unwrapped = unwrapPowerShell([...rawTokens])
  if (unwrapped) return isPushLine(unwrapped)
  const tokens = stripLeadingWrappers(rawTokens)
  if (!tokens.length) return false
  const head = baseName(tokens[0])
  const git = gitSubcommand(tokens)
  if (git) return git.verb === 'push'
  if ((head === 'npm' || head === 'pnpm' || head === 'yarn' || head === 'bun' || head === 'cargo') && tokens[1] === 'publish') return true
  if ((head === 'docker' || head === 'podman') && (tokens[1] === 'push' || (tokens[1] === 'image' && tokens[2] === 'push'))) return true
  if (head === 'gh') {
    if (tokens[1] === 'pr' && (tokens[2] === 'merge' || tokens[2] === 'create')) return true
    if (tokens[1] === 'release') return true
  }
  if (head === 'twine' && tokens[1] === 'upload') return true
  return false
}

function isPushLine(line: string): boolean {
  const subs = splitShellCommand(line) ?? [line]
  return subs.some(sub => isPushTokens(tokenize(sub)))
}

function isExtraDestructiveTokens(rawTokens: readonly string[]): boolean {
  const unwrapped = unwrapPowerShell([...rawTokens])
  if (unwrapped) return isDestructiveLine(unwrapped)
  const tokens = stripLeadingWrappers(rawTokens)
  if (!tokens.length) return false
  const head = baseName(tokens[0])
  const git = gitSubcommand(tokens)
  if (git) {
    if (git.verb === 'stash' && (git.rest[0] === 'drop' || git.rest[0] === 'clear')) return true
    if (git.verb === 'checkout' && (git.rest.includes('--') || git.rest.includes('.'))) return true
    if (git.verb === 'restore') return true
    if (git.verb === 'branch' && git.rest.includes('-D')) return true
    if (git.verb === 'reset' && git.rest.includes('--hard')) return true
    if (git.verb === 'clean' && git.rest.some(arg => /^-[a-zA-Z]*f/.test(arg) || arg === '--force')) return true
  }
  if (head === 'sed' && tokens.slice(1).some(arg => /^-[a-zA-Z]*i/.test(arg) || arg.startsWith('--in-place'))) return true
  if (head === 'find' && tokens.slice(1).includes('-delete')) return true
  if (head === 'kubectl' && tokens[1] === 'delete') return true
  if (head === 'terraform' && (tokens[1] === 'apply' || tokens[1] === 'destroy')) return true
  if (head === 'docker' || head === 'podman') {
    if (tokens[1] === 'compose' && tokens.includes('down') && tokens.some(arg => arg === '-v' || arg === '--volumes')) return true
    if ((tokens[1] === 'system' || tokens[1] === 'volume' || tokens[1] === 'container' || tokens[1] === 'image') && tokens[2] === 'prune') return true
    if (tokens[1] === 'rm' || tokens[1] === 'rmi' || (tokens[1] === 'volume' && tokens[2] === 'rm')) return true
  }
  if (head === 'docker-compose' && tokens[1] === 'down' && tokens.some(arg => arg === '-v' || arg === '--volumes')) return true
  return false
}

function hasShellRedirect(line: string): boolean {
  const subs = splitShellCommand(line)
  if (subs ? subs.some(sub => writesFile(sub)) : writesFile(line)) return true
  const parsed = parseShell(line)
  return Boolean(parsed?.writes?.some(target => !['/dev/null', 'nul', '$null'].includes(target.toLowerCase())))
}

function isDestructiveLine(line: string): boolean {
  if (classifyShellRisk(line).level === 'red') return true
  const subs = splitShellCommand(line) ?? [line]
  return subs.some(sub => isExtraDestructiveTokens(tokenize(sub)))
}

function isLowRiskCommand(line: string): boolean {
  if (classifyShellRisk(line).level === 'green') return true
  const subs = splitShellCommand(line)
  if (!subs || !subs.length) return false
  return subs.every(sub => {
    const core = stripLeadingWrappers(tokenize(sub))
    if (!core.length) return true
    const normalized = [baseName(core[0]), ...core.slice(1)].join(' ')
    return classifyShellRisk(sub).level === 'green' || LOW_RISK_CHECKS.test(normalized)
  })
}

function folderName(root: string): string {
  return root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || root
}

function isProductionEnv(env: string | undefined): boolean {
  if (!env) return false
  const lower = env.trim().toLowerCase()
  return lower === 'production' || lower === 'prod'
}

function isInsideProject(root: string, candidate: string): boolean {
  if (!candidate || /^~(?:[\\/]|$|[A-Za-z0-9._-]+[\\/])/.test(candidate)) return false
  return checkWorkspacePath(root, candidate).safe
}

export function requestImpact(request: ThreadRequest, context: RequestImpactContext): ThreadRequestImpact {
  const tool = bareToolName(request.toolName)
  const defaultWhere = context.workspaceName || folderName(context.root)
  const why = request.reason ? redactSecrets(request.reason) : undefined
  const rawCommand = request.command ?? ''

  let kind: ThreadRequestImpactKind
  if (tool === 'oxespace_db_execute' || tool === 'oxespace_mongo_write' || context.database) {
    kind = 'db'
  } else if (tool === 'oxespace_container_action' || tool.startsWith('oxespace_container_')) {
    kind = 'container'
  } else if (FILE_TOOLS.has(tool) || (!request.command && Boolean(request.paths?.length))) {
    kind = 'file'
  } else if (rawCommand && isPushLine(rawCommand)) {
    kind = 'push'
  } else {
    kind = 'command'
  }

  if (kind === 'db') {
    const db = context.database
    const prod = isProductionEnv(db?.env)
    const lang: ThreadRequestImpactLang = tool === 'oxespace_mongo_write' || db?.engine === 'mongodb' ? 'text' : 'sql'
    return {
      ...(why ? { why } : {}),
      where: db?.name || defaultWhere,
      ...(db?.env ? { whereSub: db.env } : {}),
      affects: { count: null, unit: 'rows' },
      reversible: false,
      risk: prod ? 'critical' : 'high',
      kind: 'db',
      text: redactSecrets(request.command ?? request.detail ?? request.title),
      lang
    }
  }

  if (kind === 'file') {
    const paths = (request.paths ?? []).filter(Boolean)
    const allInside = paths.length > 0 ? paths.every(path => isInsideProject(context.root, path)) : true
    const textSource = request.command ?? request.detail ?? (paths.length ? paths.map(path => relativeTo(context.root, path) ?? path).join('\n') : request.title)
    const relCwd = request.cwd ? relativeTo(context.root, request.cwd) : undefined
    const whereSub = relCwd && relCwd !== '.' ? relCwd : undefined
    return {
      ...(why ? { why } : {}),
      where: defaultWhere,
      ...(whereSub ? { whereSub } : {}),
      affects: { count: paths.length || null, unit: 'files' },
      reversible: allInside,
      ...(allInside ? { undoHow: 'checkpoint' } : {}),
      risk: allInside ? 'low' : 'critical',
      kind: 'file',
      text: redactSecrets(textSource),
      lang: 'diff'
    }
  }

  if (kind === 'container') {
    const actionText = (request.command ?? request.detail ?? '').trim()
    const destructive = CONTAINER_DESTRUCTIVE.test(actionText) || !CONTAINER_REVERSIBLE.test(actionText)
    const reversible = !destructive
    return {
      ...(why ? { why } : {}),
      where: defaultWhere,
      affects: { count: 1, unit: 'resources' },
      reversible,
      ...(reversible ? { undoHow: 'start' } : {}),
      risk: reversible ? 'low' : 'critical',
      kind: 'container',
      text: redactSecrets(request.command ?? request.detail ?? request.title),
      lang: 'shell'
    }
  }

  const relCwd = request.cwd ? relativeTo(context.root, request.cwd) : undefined
  const whereSub = relCwd && relCwd !== '.' ? relCwd : undefined

  if (kind === 'push') {
    return {
      ...(why ? { why } : {}),
      where: defaultWhere,
      ...(whereSub ? { whereSub } : {}),
      affects: { count: 1, unit: 'resources' },
      reversible: false,
      risk: 'critical',
      kind: 'push',
      text: redactSecrets(request.command ?? request.detail ?? request.title),
      lang: 'shell'
    }
  }

  const redirected = Boolean(rawCommand && hasShellRedirect(rawCommand))
  const destructive = Boolean(rawCommand && isDestructiveLine(rawCommand))
  const reversible = !redirected && !destructive
  const risk: ThreadRequestImpactRisk = !reversible ? 'critical' : isLowRiskCommand(rawCommand) ? 'low' : 'medium'

  return {
    ...(why ? { why } : {}),
    where: defaultWhere,
    ...(whereSub ? { whereSub } : {}),
    affects: { count: null, unit: 'files' },
    reversible,
    risk,
    kind: 'command',
    text: redactSecrets(request.command ?? request.detail ?? request.title),
    lang: 'shell'
  }
}
