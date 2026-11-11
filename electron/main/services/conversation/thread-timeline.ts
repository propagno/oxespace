import type { AppDatabase } from '../../db'
import type { ThreadSnapshot, ThreadTimeline, ThreadTimelineCheckpoint } from '../../../../shared/types/thread'
import { requestImpact } from '../approvals/request-impact'
import { checkWorkspacePath } from './path-safety'
import { baseName, splitShellCommand, tokenize, unwrapPowerShell } from './shell-command-rules'

export interface ThreadTimelineInput {
  db: AppDatabase
  snapshot: ThreadSnapshot
}

interface TimelineCheckpointRow {
  id: string
  turn_id: string | null
  root_path: string
  label: string | null
  state: string
  created_at: number
}

const READ_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch', 'fileChange', 'edit', 'write'])
const SHELL_TOOLS = new Set(['Bash', 'bash', 'command', 'shell', 'exec_command'])
const GITHUB_PUSH_ACTIONS = new Set(['create_pull_request', 'merge', 'merge_pull_request', 'auto-merge', 'auto_merge', 'create_release'])
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/
const SQL_WRITE_RE = /(?:^|;)\s*(?:WITH\b[\s\S]*?\)\s*)?(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|MERGE|GRANT|REVOKE|VACUUM|REINDEX|CALL|DO)\b|\bCOPY\b[\s\S]+\bFROM\b/i
const MONGO_WRITE_RE = /\.\s*(?:insertOne|insertMany|insert|updateOne|updateMany|update|deleteOne|deleteMany|remove|replaceOne|findOneAndUpdate|findOneAndDelete|findOneAndReplace|drop|dropDatabase|dropCollection|bulkWrite|createIndex|dropIndex|renameCollection)\s*\(/

function bareToolName(name: string): string {
  const raw = name.trim()
  const mcp = raw.match(/^mcp__.+?__(.+)$/)
  return mcp ? mcp[1] : raw
}

function parseToolInput(detail: string): Record<string, unknown> | null {
  const trimmed = detail.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function isLoopbackHost(host: string | null | undefined): boolean {
  const clean = (host ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!clean) return true
  return clean === 'localhost' || clean.endsWith('.localhost') || clean === '::1' || clean === '0.0.0.0' || clean.startsWith('127.')
}

function stripWrappers(tokens: readonly string[]): string[] {
  let i = 0
  while (i < tokens.length) {
    const tok = tokens[i]
    if (ENV_ASSIGN.test(tok)) { i += 1; continue }
    const head = baseName(tok)
    if (head === 'env') {
      i += 1
      while (i < tokens.length) {
        const next = tokens[i]
        if (ENV_ASSIGN.test(next)) { i += 1; continue }
        if (next === '-u' || next === '--unset' || next === '-C' || next === '--chdir' || next === '-S') { i += 2; continue }
        if (next.startsWith('-')) { i += 1; continue }
        break
      }
      continue
    }
    if (head === 'timeout') {
      i += 1
      while (i < tokens.length && tokens[i].startsWith('-')) {
        i += (tokens[i] === '-k' || tokens[i] === '-s') ? 2 : 1
      }
      if (i < tokens.length) i += 1
      continue
    }
    if (head === 'time') {
      i += 1
      while (i < tokens.length && tokens[i].startsWith('-')) i += 1
      continue
    }
    if (head === 'nohup') { i += 1; continue }
    if ((head === 'npx' || head === 'bunx') && i + 1 < tokens.length) {
      i += 1
      while (i < tokens.length && (tokens[i] === '-y' || tokens[i] === '--yes')) i += 1
      continue
    }
    if ((head === 'pnpm' || head === 'yarn') && (tokens[i + 1] === 'dlx' || tokens[i + 1] === 'exec') && i + 2 < tokens.length) {
      i += 2
      continue
    }
    break
  }
  return tokens.slice(i)
}

function isIrreversibleContainerTokens(rawTokens: readonly string[]): boolean {
  const unwrapped = unwrapPowerShell([...rawTokens])
  if (unwrapped) return isIrreversibleContainerLine(unwrapped)
  const tokens = stripWrappers(rawTokens)
  if (!tokens.length) return false
  const head = baseName(tokens[0])
  if (head === 'docker' || head === 'podman') {
    if (tokens[1] === 'compose') {
      return tokens.includes('down') && tokens.some(arg => arg === '-v' || arg === '--volumes' || /^-[a-zA-Z]*v/.test(arg))
    }
    if (tokens[1] === 'rm' || tokens[1] === 'rmi') return true
    if ((tokens[1] === 'container' || tokens[1] === 'volume' || tokens[1] === 'image' || tokens[1] === 'network') && (tokens[2] === 'rm' || tokens[2] === 'prune')) return true
    if (tokens[1] === 'system' && tokens[2] === 'prune') return true
  }
  if (head === 'docker-compose') {
    return tokens.includes('down') && tokens.some(arg => arg === '-v' || arg === '--volumes' || /^-[a-zA-Z]*v/.test(arg))
  }
  return false
}

function isIrreversibleContainerLine(line: string): boolean {
  const subs = splitShellCommand(line) ?? [line]
  return subs.some(sub => isIrreversibleContainerTokens(tokenize(sub)))
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\r\n]*/g, ' ')
}

function flagValues(tokens: readonly string[], shortFlag: string, longFlag: string): string[] {
  const values: string[] = []
  for (let i = 1; i < tokens.length; i += 1) {
    const tok = tokens[i]
    if ((tok === shortFlag || tok === longFlag) && i + 1 < tokens.length) {
      values.push(tokens[i + 1])
      i += 1
    } else if (tok.startsWith(`${longFlag}=`)) {
      values.push(tok.slice(longFlag.length + 1))
    } else if (shortFlag.length === 2 && tok.startsWith(shortFlag) && tok.length > 2 && !tok.startsWith('--')) {
      values.push(tok.slice(2))
    }
  }
  return values
}

function isCliDbOrSchemaWriteTokens(rawTokens: readonly string[]): boolean {
  const unwrapped = unwrapPowerShell([...rawTokens])
  if (unwrapped) return isCliDbOrSchemaWriteLine(unwrapped)
  const tokens = stripWrappers(rawTokens)
  if (!tokens.length) return false
  const head = baseName(tokens[0])
  if (head === 'psql') {
    return flagValues(tokens, '-c', '--command').some(sql => SQL_WRITE_RE.test(stripSqlComments(sql)))
  }
  if (head === 'mysql' || head === 'mariadb') {
    return flagValues(tokens, '-e', '--execute').some(sql => SQL_WRITE_RE.test(stripSqlComments(sql)))
  }
  if (head === 'sqlite3') {
    const positional = tokens.slice(1).filter(tok => !tok.startsWith('-'))
    return positional.slice(1).some(sql => SQL_WRITE_RE.test(stripSqlComments(sql)))
  }
  if (head === 'mongosh' || head === 'mongo') {
    return flagValues(tokens, '--eval', '--eval').some(js => MONGO_WRITE_RE.test(js))
  }
  if (head === 'prisma') {
    if (tokens[1] === 'db' && (tokens[2] === 'push' || tokens[2] === 'execute' || tokens[2] === 'seed')) return true
    if (tokens[1] === 'migrate' && (tokens[2] === 'dev' || tokens[2] === 'deploy' || tokens[2] === 'reset' || tokens[2] === 'resolve')) return true
  }
  if (head === 'drizzle-kit' && (tokens[1] === 'push' || tokens[1] === 'migrate' || tokens[1] === 'up' || tokens[1] === 'drop')) {
    return true
  }
  return false
}

function isCliDbOrSchemaWriteLine(line: string): boolean {
  const subs = splitShellCommand(line) ?? [line]
  return subs.some(sub => isCliDbOrSchemaWriteTokens(tokenize(sub)))
}

function isInsideAnyRoot(roots: readonly string[], candidate: string): boolean {
  if (!candidate || /^~(?:[\\/]|$|[A-Za-z0-9._-]+[\\/])/.test(candidate)) return false
  return roots.some(root => checkWorkspacePath(root, candidate).safe)
}

export function threadTimeline(input: ThreadTimelineInput): ThreadTimeline {
  const { db, snapshot } = input
  const { thread, events } = snapshot

  const promptByTurnId = new Map<string, string>()
  for (const event of events) {
    if (event.type === 'message' && event.role === 'user' && !promptByTurnId.has(event.id)) {
      const text = event.text.trim().replace(/\s+/g, ' ').slice(0, 80)
      if (text) promptByTurnId.set(event.id, text)
    }
  }

  const checkpointRows = db.prepare(
    'SELECT id, turn_id, root_path, label, state, created_at FROM conversation_checkpoints WHERE thread_id = ? ORDER BY created_at ASC, rowid ASC'
  ).all(thread.id) as TimelineCheckpointRow[]

  const filesStmt = db.prepare(
    "SELECT path FROM conversation_checkpoint_files WHERE checkpoint_id = ? AND (pre_exists != post_exists OR COALESCE(pre_hash, '') != COALESCE(post_hash, '')) ORDER BY path ASC"
  )

  const checkpoints: ThreadTimelineCheckpoint[] = checkpointRows.map((row, index) => {
    const failed = row.state === 'failed'
    const files = failed ? [] : (filesStmt.all(row.id) as Array<{ path: string }>).map(item => item.path)
    const label = (row.turn_id ? promptByTurnId.get(row.turn_id) : undefined) || row.label || 'Checkpoint'
    return {
      id: row.id,
      n: index + 1,
      turnId: row.turn_id ?? '',
      at: row.created_at,
      label,
      files,
      checkout: row.root_path,
      ...(failed ? { failed: true } : {})
    }
  })

  const canBranch = thread.provider === 'claude'
  const actor = `thread:${thread.id}`

  const dbWrites = (db.prepare(
    "SELECT COUNT(*) AS n FROM oxequery_audit WHERE actor = ? AND tool IN ('oxespace_db_execute', 'oxespace_mongo_write') AND outcome = 'ok'"
  ).get(actor) as { n: number } | undefined)?.n ?? 0

  const httpRows = db.prepare('SELECT method, host FROM agent_http_audit WHERE actor = ?').all(actor) as Array<{ method: string; host: string | null }>
  let httpWrites = 0
  for (const row of httpRows) {
    if (!READ_HTTP_METHODS.has(row.method.trim().toUpperCase()) && !isLoopbackHost(row.host)) {
      httpWrites += 1
    }
  }

  const placeRoots = [
    thread.rootPath,
    ...(db.prepare("SELECT path FROM thread_places WHERE thread_id = ? AND kind != 'outside'").all(thread.id) as Array<{ path: string }>).map(row => row.path)
  ]

  let pushes = 0
  let containers = 0
  let commands = 0
  const seenToolIds = new Set<string>()

  for (const event of events) {
    if (event.type !== 'tool' || seenToolIds.has(event.id)) continue
    seenToolIds.add(event.id)

    const bare = bareToolName(event.name)
    const parsed = parseToolInput(event.detail)
    const completed = event.state === 'completed'
    const ranOrNonZeroFailed = completed || (event.state === 'failed' && typeof event.exitCode === 'number' && event.exitCode !== 0)

    if (bare === 'oxespace_db_execute' || bare === 'oxespace_mongo_write' || bare === 'oxespace_db_query' || bare === 'oxespace_mongo_read') {
      continue
    }
    if (bare === 'oxespace_container_action' || bare.startsWith('oxespace_container_')) {
      continue
    }
    if (bare === 'oxespace_git_change') {
      if (parsed?.action === 'push' && ranOrNonZeroFailed) pushes += 1
      continue
    }
    if (bare === 'oxespace_github_change') {
      const action = typeof parsed?.action === 'string' ? parsed.action : ''
      if (completed && (GITHUB_PUSH_ACTIONS.has(action) || (action === 'set_auto_merge' && parsed?.enable !== false))) {
        pushes += 1
      }
      continue
    }
    if (FILE_TOOLS.has(bare)) {
      if (!completed) continue
      const paths = event.files?.map(file => file.path)
        ?? (typeof parsed?.file_path === 'string' ? [parsed.file_path] : typeof parsed?.path === 'string' ? [parsed.path] : [])
      if (paths.length > 0 && paths.some(path => !isInsideAnyRoot(placeRoots, path))) {
        commands += 1
      }
      continue
    }

    const command = typeof parsed?.command === 'string'
      ? parsed.command
      : typeof parsed?.cmd === 'string'
        ? parsed.cmd
        : (!parsed && SHELL_TOOLS.has(bare) ? event.detail : '')
    if (!command.trim()) continue

    const impact = requestImpact(
      {
        id: event.id,
        nativeId: event.id,
        nativeMethod: 'tool',
        kind: 'approval',
        title: bare,
        toolName: bare,
        command,
        ...(typeof parsed?.cwd === 'string' ? { cwd: parsed.cwd } : {}),
        generation: 1,
        createdAt: 0,
        state: 'pending'
      },
      { root: thread.rootPath }
    )

    if (impact.kind === 'push') {
      if (ranOrNonZeroFailed) pushes += 1
      continue
    }
    if (!completed) continue
    if (isIrreversibleContainerLine(command)) {
      containers += 1
      continue
    }
    if (!impact.reversible || isCliDbOrSchemaWriteLine(command)) {
      commands += 1
    }
  }

  return {
    checkpoints,
    canBranch,
    ...(canBranch ? {} : { branchRefusal: { code: 'thread.branch.unsupported', params: {} } }),
    cantGoBack: {
      dbWrites,
      pushes,
      containers,
      commands,
      httpWrites,
      scope: 'conversation'
    }
  }
}
