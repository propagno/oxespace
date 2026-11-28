/**
 * Safe read-only discovery of custom agent Markdown files with YAML frontmatter:
 *   1. `<root>/.oxe/agents/*.md`
 *   2. `<root>/.github/agents/*.agent.md`
 *   3. `<root>/.claude/agents/*.md`
 *   4. `<home>/.oxe/agents/*.md` (optional user fallback)
 *
 * Security invariants:
 *   - Read-only; never writes or creates directories.
 *   - Enforces canonical containment via `checkWorkspacePath` + `realpathSync` so
 *     symlinks/junctions escaping the workspace (or `~/.oxe/agents`) are rejected.
 *   - Bounded per file (<= 64 KiB) via open/read cap and bounded total count (<= 50).
 *   - Safe YAML parsing via `js-yaml` (`load`, no eval); malformed files are ignored.
 *   - Never escalates `access`: only `'read-only'` is honored from agent definitions.
 */
import { closeSync, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import {
  isReadOnlyModeOrAgent,
  MAX_CUSTOM_AGENT_BYTES,
  MAX_CUSTOM_AGENT_HANDOFFS,
  MAX_CUSTOM_AGENT_INSTRUCTIONS_CHARS,
  MAX_CUSTOM_AGENTS,
  type CustomAgentDefinition,
  type CustomAgentHandoff,
  type CustomAgentMode,
  type CustomAgentSource
} from '../../../../shared/types/custom-agents'
import type { ConversationThread, ThreadConfiguration } from '../../../../shared/types/thread'
import { checkWorkspacePath } from './path-safety'

const MODEL_PATTERN = /^[a-z0-9][a-z0-9._:/[\]-]{0,199}$/i
const ASK_READ_ONLY_GUIDANCE = 'Read-only Ask mode: inspect the codebase and answer questions without modifying files, applying patches, or running mutating commands.'

interface DiscoveryTier {
  source: CustomAgentSource
  dir: string
  boundary: string
  suffix: '.md' | '.agent.md'
  labelPrefix: string
}

function safeRealpath(path: string): string {
  try { return realpathSync.native(path) } catch {
    try { return realpathSync(path) } catch { return path }
  }
}

function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function normalizeMode(value: unknown): CustomAgentMode {
  if (typeof value !== 'string') return 'agent'
  const lower = value.trim().toLowerCase()
  if (lower === 'plan') return 'plan'
  if (lower === 'ask') return 'ask'
  return 'agent'
}

function parseHandoffs(value: unknown): CustomAgentHandoff[] {
  if (!Array.isArray(value)) return []
  const result: CustomAgentHandoff[] = []
  for (const item of value) {
    if (result.length >= MAX_CUSTOM_AGENT_HANDOFFS) break
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const label = typeof record.label === 'string' ? record.label.trim().slice(0, 80) : ''
    if (!label) continue
    const agent = typeof record.agent === 'string' && record.agent.trim() ? record.agent.trim().slice(0, 80) : undefined
    const mode = typeof record.mode === 'string' && ['agent', 'plan', 'ask'].includes(record.mode.trim().toLowerCase())
      ? normalizeMode(record.mode)
      : undefined
    const prompt = typeof record.prompt === 'string' && record.prompt.trim() ? record.prompt.trim().slice(0, 4000) : undefined
    const send = record.send === true ? true : undefined
    result.push({
      label,
      ...(agent ? { agent } : {}),
      ...(mode ? { mode } : {}),
      ...(prompt ? { prompt } : {}),
      ...(send ? { send } : {})
    })
  }
  return result
}

/** Parses one bounded custom-agent Markdown file with YAML frontmatter. Returns null if malformed. */
export function parseCustomAgentMarkdown(
  raw: string,
  meta: { stem: string; source: CustomAgentSource; sourcePath: string }
): CustomAgentDefinition | null {
  const id = normalizeSlug(meta.stem)
  if (!id) return null
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/)
  if (!match) return null

  let parsed: unknown
  try {
    parsed = loadYaml(match[1])
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const data = parsed as Record<string, unknown>
  const nameRaw = typeof data.name === 'string' ? data.name.trim().slice(0, 80) : ''
  const name = nameRaw || id
  const description = typeof data.description === 'string' ? data.description.trim().slice(0, 240) : ''
  const modelRaw = typeof data.model === 'string' ? data.model.trim() : ''
  const model = modelRaw && MODEL_PATTERN.test(modelRaw) ? modelRaw : undefined
  const mode = normalizeMode(data.mode)
  // Security: never escalate access from a repository/user agent file; honor read-only exclusively.
  const accessRaw = typeof data.access === 'string' ? data.access.trim().toLowerCase() : ''
  const access = accessRaw === 'read-only' ? 'read-only' as const : undefined
  const hintRaw = typeof data.argumentHint === 'string'
    ? data.argumentHint
    : typeof data['argument-hint'] === 'string'
      ? data['argument-hint']
      : typeof data.argument_hint === 'string'
        ? data.argument_hint
        : ''
  const argumentHint = hintRaw.trim() ? hintRaw.trim().slice(0, 160) : undefined
  const handoffs = parseHandoffs(data.handoffs)
  const instructions = (match[2] ?? '').trim().slice(0, MAX_CUSTOM_AGENT_INSTRUCTIONS_CHARS)

  return {
    id,
    name,
    description,
    ...(model ? { model } : {}),
    mode,
    ...(access ? { access } : {}),
    ...(argumentHint ? { argumentHint } : {}),
    handoffs,
    instructions,
    source: meta.source,
    sourcePath: meta.sourcePath
  }
}

/** Reads a regular file safely within `boundary`, rejecting symlink escapes and files > 64 KiB. */
function readBoundedAgentFile(boundary: string, candidatePath: string): string | null {
  const canonicalBoundary = safeRealpath(resolve(boundary))
  const relCandidate = relative(resolve(boundary), resolve(candidatePath))
  const candidateForCheck = relCandidate && !relCandidate.startsWith('..') && !isAbsolute(relCandidate)
    ? relCandidate
    : safeRealpath(candidatePath)
  const verdict = checkWorkspacePath(canonicalBoundary, candidateForCheck, { realpath: safeRealpath })
  if (!verdict.safe) return null

  let fd: number | null = null
  try {
    const stats = statSync(verdict.resolved)
    if (!stats.isFile() || stats.size > MAX_CUSTOM_AGENT_BYTES) return null
    fd = openSync(verdict.resolved, 'r')
    const buffer = Buffer.alloc(MAX_CUSTOM_AGENT_BYTES + 1)
    let total = 0
    while (total < buffer.length) {
      const read = readSync(fd, buffer, total, buffer.length - total, total)
      if (read <= 0) break
      total += read
    }
    if (total > MAX_CUSTOM_AGENT_BYTES) return null
    return buffer.subarray(0, total).toString('utf8')
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try { closeSync(fd) } catch { /* ignore */ }
    }
  }
}

export interface DiscoverCustomAgentsOptions {
  homeDir?: string
  includeUser?: boolean
}

/** Discovers custom agents for `rootPath` with `.oxe` > `.github` > `.claude` > `~/.oxe` precedence. */
export function discoverCustomAgents(rootPath: string, options: DiscoverCustomAgentsOptions = {}): CustomAgentDefinition[] {
  const tiers: DiscoveryTier[] = []
  if (rootPath && isAbsolute(rootPath)) {
    const resolvedRoot = resolve(rootPath)
    tiers.push(
      { source: 'oxe', dir: join(resolvedRoot, '.oxe', 'agents'), boundary: resolvedRoot, suffix: '.md', labelPrefix: '.oxe/agents' },
      { source: 'github', dir: join(resolvedRoot, '.github', 'agents'), boundary: resolvedRoot, suffix: '.agent.md', labelPrefix: '.github/agents' },
      { source: 'claude', dir: join(resolvedRoot, '.claude', 'agents'), boundary: resolvedRoot, suffix: '.md', labelPrefix: '.claude/agents' }
    )
  }
  if (options.includeUser !== false) {
    const userAgentsDir = join(resolve(options.homeDir ?? homedir()), '.oxe', 'agents')
    tiers.push({
      source: 'user',
      dir: userAgentsDir,
      boundary: userAgentsDir,
      suffix: '.md',
      labelPrefix: '~/.oxe/agents'
    })
  }

  const byId = new Map<string, CustomAgentDefinition>()
  for (const tier of tiers) {
    if (byId.size >= MAX_CUSTOM_AGENTS) break
    let entries: string[]
    try {
      entries = readdirSync(tier.dir).sort((a, b) => a.localeCompare(b))
    } catch {
      continue
    }
    for (const filename of entries) {
      if (byId.size >= MAX_CUSTOM_AGENTS) break
      if (!filename.toLowerCase().endsWith(tier.suffix)) continue
      const stem = filename.slice(0, -tier.suffix.length)
      const id = normalizeSlug(stem)
      if (!id || byId.has(id)) continue
      const fullPath = join(tier.dir, filename)
      const raw = readBoundedAgentFile(tier.boundary, fullPath)
      if (!raw) continue
      const parsed = parseCustomAgentMarkdown(raw, {
        stem,
        source: tier.source,
        sourcePath: `${tier.labelPrefix}/${filename}`
      })
      if (!parsed || byId.has(parsed.id)) continue
      byId.set(parsed.id, parsed)
    }
  }
  return [...byId.values()]
}

export function findCustomAgent(rootPath: string, agentId: string | undefined, options?: DiscoverCustomAgentsOptions): CustomAgentDefinition | null {
  if (!agentId) return null
  const normalized = normalizeSlug(agentId)
  if (!normalized) return null
  return discoverCustomAgents(rootPath, options).find(agent => agent.id === normalized) ?? null
}

function workingRootOf(thread: Pick<ConversationThread, 'rootPath' | 'observedLocation'>): string {
  return thread.observedLocation?.sameRepository && thread.observedLocation.checkoutRoot
    ? thread.observedLocation.checkoutRoot
    : thread.rootPath
}

/**
 * Produces the adapter-safe configuration for a turn:
 * - Provider adapters only understand `default | plan | acceptEdits` (never `'ask'`).
 * - When in Ask mode or a read-only custom agent, clamps effective access to `'read-only'`
 *   and disables hooks without ever mutating or escalating the conversation's stored access.
 */
export function effectiveAdapterConfiguration(
  thread: Pick<ConversationThread, 'rootPath' | 'observedLocation' | 'mode' | 'customAgentId'>,
  config: ThreadConfiguration,
  options?: DiscoverCustomAgentsOptions
): ThreadConfiguration {
  const mode = config.mode ?? thread.mode ?? 'default'
  const agentId = config.customAgentId !== undefined ? (config.customAgentId || undefined) : thread.customAgentId
  const agent = findCustomAgent(workingRootOf(thread), agentId, options)
  const readOnly = isReadOnlyModeOrAgent(mode, agent)
  const adapterMode: ThreadConfiguration['mode'] = mode === 'ask' ? 'default' : mode
  if (!readOnly) return { ...config, mode: adapterMode }
  return {
    ...config,
    mode: adapterMode === 'plan' ? 'plan' : 'default',
    access: 'read-only',
    hooksEnabled: false
  }
}

/**
 * Builds the bounded delimited prompt addendum injected when sending a turn in Ask mode
 * or with an active custom agent. Stored user messages keep only what the person typed.
 */
export function buildModeAndAgentPromptBlock(
  thread: Pick<ConversationThread, 'rootPath' | 'observedLocation' | 'mode' | 'customAgentId'>,
  options?: DiscoverCustomAgentsOptions
): { block: string; readOnly: boolean; agent: CustomAgentDefinition | null } {
  const agent = findCustomAgent(workingRootOf(thread), thread.customAgentId, options)
  const readOnly = isReadOnlyModeOrAgent(thread.mode, agent)
  const parts: string[] = []
  if (thread.mode === 'ask' || agent?.mode === 'ask') {
    parts.push(`<oxe-mode mode="ask">\n${ASK_READ_ONLY_GUIDANCE}\n</oxe-mode>`)
  }
  if (agent?.instructions) {
    const safeName = agent.name.replace(/"/g, "'")
    const safeSource = agent.sourcePath.replace(/"/g, "'")
    parts.push(`<oxe-custom-agent id="${agent.id}" name="${safeName}" source="${safeSource}">\n${agent.instructions}\n</oxe-custom-agent>`)
  }
  return {
    block: parts.length ? `\n\n${parts.join('\n\n')}` : '',
    readOnly,
    agent
  }
}
