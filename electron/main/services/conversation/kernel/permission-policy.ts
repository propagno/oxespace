/**
 * Decides whether OXESpace may answer an approval prompt on its own.
 *
 * Combines the shell analysis (`shell-command-rules.ts`), the workspace path
 * check (`path-safety.ts`) and the rules a person saved. It only ever answers
 * prompts the provider raised, so it can narrow what runs but never widen it.
 *
 * - An explicit deny rule declines the request.
 * - Every command and every path must be covered by allow rules to approve it.
 * - Anything else asks, with the reasons and the narrowest rules to remember.
 *
 * Built-in risky commands (rm, curl, ssh…) are never declined silently: they
 * ask and are marked high-risk, since a person may legitimately want them.
 *
 * Pure: the caller supplies `realpath`, the file system is never touched here.
 */
import { posix, win32 } from 'node:path'
import type { ThreadPermissionRule, ThreadPermissionSuggestion, ThreadRequest, ThreadRequestPolicy } from '../../../../../shared/types/thread'
import { evaluateShellCommand, suggestRules } from '../shell-command-rules'
import { classifyShellRisk, type ShellRisk } from '../shell-risk'
import { readsOutsideProject } from '../shell-reads'
import { checkWorkspacePath, type PathSafetyOptions } from '../path-safety'
import { commandMentionsProtected, commandRewritesTracked, commandWritesProtected, isPlainSafeRead, protectedConfigKind, protectedConfigNote, protectedConfigReason, PROTECTED_CONFIG_WARNING, PROTECTED_CONFIG_WARNING_NOTE, rewritesTrackedNote, rewritesTrackedReason } from './protected-config'
import type { MainMessage } from '../../../../../shared/messages'
import { isOxespaceReadOnlyTool } from '../read-only-mcp-tools'

type Decision = ThreadRequestPolicy['decision']

const REASON_FOR: Record<string, string> = {
  'outside-workspace': 'is outside the project',
  'device-name': 'uses a reserved Windows device name',
  'alternate-stream': 'uses an alternate data stream',
  'short-name': 'uses a short 8.3 name that can hide the target',
  'device-prefix': 'uses a Windows device prefix',
  'trailing-dot-or-space': 'ends in a dot or space, which Windows removes',
  invalid: 'is not a valid path'
}

const MAX_BRACE_EXPANSIONS = 64

type GlobToken =
  | { kind: 'star' }
  | { kind: 'any' }
  | { kind: 'char'; value: string }
  | { kind: 'class'; negated: boolean; ranges: Array<[string, string]>; chars: string }

function foldCase(ch: string, nocase: boolean): string {
  return nocase ? ch.toLowerCase() : ch
}

function tokenizeSegment(pattern: string, nocase: boolean): GlobToken[] {
  const tokens: GlobToken[] = []
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch === '\\' && i + 1 < pattern.length) {
      tokens.push({ kind: 'char', value: foldCase(pattern[i + 1], nocase) })
      i += 2
      continue
    }
    if (ch === '*') {
      // Collapse consecutive '*' within a segment so matching stays linear.
      while (i < pattern.length && pattern[i] === '*') i += 1
      tokens.push({ kind: 'star' })
      continue
    }
    if (ch === '?') {
      tokens.push({ kind: 'any' })
      i += 1
      continue
    }
    if (ch === '[') {
      const parsed = parseCharClass(pattern, i, nocase)
      if (parsed) {
        tokens.push(parsed.token)
        i = parsed.nextIndex
        continue
      }
    }
    tokens.push({ kind: 'char', value: foldCase(ch, nocase) })
    i += 1
  }
  return tokens
}

function parseCharClass(
  pattern: string,
  start: number,
  nocase: boolean
): { token: GlobToken; nextIndex: number } | null {
  let i = start + 1
  if (i >= pattern.length) return null
  let negated = false
  if (pattern[i] === '!' || pattern[i] === '^') {
    negated = true
    i += 1
  }
  let chars = ''
  const ranges: Array<[string, string]> = []
  const bodyStart = i
  while (i < pattern.length) {
    if (pattern[i] === ']' && i > bodyStart) {
      return { token: { kind: 'class', negated, ranges, chars }, nextIndex: i + 1 }
    }
    let ch = pattern[i]
    if (ch === '\\' && i + 1 < pattern.length) {
      ch = pattern[i + 1]
      i += 2
    } else {
      i += 1
    }
    if (i + 1 < pattern.length && pattern[i] === '-' && pattern[i + 1] !== ']') {
      let end = pattern[i + 1]
      if (end === '\\' && i + 2 < pattern.length) {
        end = pattern[i + 2]
        i += 3
      } else {
        i += 2
      }
      const lo = foldCase(ch, nocase)
      const hi = foldCase(end, nocase)
      ranges.push(lo <= hi ? [lo, hi] : [hi, lo])
    } else {
      chars += foldCase(ch, nocase)
    }
  }
  return null
}

function matchClass(token: Extract<GlobToken, { kind: 'class' }>, ch: string, nocase: boolean): boolean {
  const c = foldCase(ch, nocase)
  let matched = token.chars.includes(c)
  if (!matched) {
    for (const [lo, hi] of token.ranges) {
      if (c >= lo && c <= hi) {
        matched = true
        break
      }
    }
  }
  return token.negated ? !matched : matched
}

/** Two-pointer linear/polynomial segment matcher (no regex, no exponential backtracking). */
function matchSegment(tokens: GlobToken[], segment: string, nocase: boolean): boolean {
  let ti = 0
  let si = 0
  let starTi = -1
  let starSi = -1

  while (si < segment.length) {
    const token = ti < tokens.length ? tokens[ti] : undefined
    if (token?.kind === 'star') {
      starTi = ti
      starSi = si
      ti += 1
      continue
    }
    const ch = segment[si]
    const matched =
      token !== undefined &&
      (token.kind === 'any' ||
        (token.kind === 'char' && foldCase(ch, nocase) === token.value) ||
        (token.kind === 'class' && matchClass(token, ch, nocase)))
    if (matched) {
      ti += 1
      si += 1
      continue
    }
    if (starTi !== -1) {
      starSi += 1
      si = starSi
      ti = starTi + 1
      continue
    }
    return false
  }

  while (ti < tokens.length && tokens[ti].kind === 'star') ti += 1
  return ti === tokens.length
}

function expandBraces(pattern: string): string[] {
  const open = findUnescapedBrace(pattern)
  if (open === -1) return [pattern]
  const parsed = splitBraceAlternatives(pattern, open)
  if (!parsed) return [pattern]
  const prefix = pattern.slice(0, open)
  const suffix = pattern.slice(parsed.close + 1)
  const results: string[] = []
  for (const alt of parsed.alternatives) {
    for (const expandedAlt of expandBraces(alt)) {
      for (const expandedSuffix of expandBraces(suffix)) {
        results.push(prefix + expandedAlt + expandedSuffix)
        if (results.length >= MAX_BRACE_EXPANSIONS) return results
      }
    }
  }
  return results
}

function findUnescapedBrace(pattern: string): number {
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] === '\\') {
      i += 1
      continue
    }
    if (pattern[i] === '{') return i
  }
  return -1
}

function splitBraceAlternatives(pattern: string, open: number): { alternatives: string[]; close: number } | null {
  const alternatives: string[] = []
  let depth = 0
  let current = ''
  for (let i = open + 1; i < pattern.length; i += 1) {
    const ch = pattern[i]
    if (ch === '\\' && i + 1 < pattern.length) {
      current += ch + pattern[i + 1]
      i += 1
      continue
    }
    if (ch === '{') {
      depth += 1
      current += ch
      continue
    }
    if (ch === '}') {
      if (depth === 0) {
        alternatives.push(current)
        if (alternatives.length <= 1) return null
        return { alternatives, close: i }
      }
      depth -= 1
      current += ch
      continue
    }
    if (ch === ',' && depth === 0) {
      alternatives.push(current)
      current = ''
      continue
    }
    current += ch
  }
  return null
}

type CompiledSegment = { globstar: true } | { globstar: false; tokens: GlobToken[] }

function compileSingleGlob(pattern: string, nocase: boolean): (candidate: string) => boolean {
  const rawSegments = pattern.split('/')
  const compiled: CompiledSegment[] = []
  for (const seg of rawSegments) {
    if (seg === '**') {
      if (compiled.length === 0 || !compiled[compiled.length - 1].globstar) {
        compiled.push({ globstar: true })
      }
    } else {
      compiled.push({ globstar: false, tokens: tokenizeSegment(seg, nocase) })
    }
  }

  return (candidate: string) => {
    const segs = candidate.split('/')
    let pi = 0
    let si = 0
    let starPi = -1
    let starSi = -1

    while (si < segs.length) {
      const pSeg = pi < compiled.length ? compiled[pi] : undefined
      if (pSeg?.globstar) {
        starPi = pi
        starSi = si
        pi += 1
        continue
      }
      if (pSeg && !pSeg.globstar && matchSegment(pSeg.tokens, segs[si], nocase)) {
        pi += 1
        si += 1
        continue
      }
      if (starPi !== -1) {
        starSi += 1
        si = starSi
        pi = starPi + 1
        continue
      }
      return false
    }

    // Trailing `**` after `/` (e.g. `src/**`) requires at least one child segment, matching picomatch.
    if (pi === compiled.length - 1 && compiled[pi].globstar && compiled.length > 1) {
      return false
    }
    while (pi < compiled.length && compiled[pi].globstar) pi += 1
    return pi === compiled.length
  }
}

function pathMatcher(pattern: string, windows: boolean): (path: string) => boolean {
  if (!pattern) return () => false
  const variants = expandBraces(pattern)
  const matchers = variants.map(variant => compileSingleGlob(variant, windows))
  return (candidate: string) => matchers.some(match => match(candidate))
}

function evaluatePaths(paths: string[], rootPath: string, rules: ThreadPermissionRule[], options: PathSafetyOptions) {
  const windows = options.windows ?? process.platform === 'win32'
  const path = windows ? win32 : posix
  const root = options.realpath ? options.realpath(path.resolve(rootPath)) : path.resolve(rootPath)
  const deny = rules.filter(rule => rule.kind === 'path' && rule.decision === 'deny')
  const allow = rules.filter(rule => rule.kind === 'path' && rule.decision === 'allow')
  const reasons: string[] = []
  const reasonCodes: MainMessage[] = []
  const suggestions: ThreadPermissionSuggestion[] = []
  let decision: Decision = 'allow'
  let guarded = false
  for (const candidate of paths) {
    const verdict = checkWorkspacePath(rootPath, candidate, options)
    const config = protectedConfigKind(candidate)
    if (!verdict.safe) {
      reasons.push(`"${candidate}" ${REASON_FOR[verdict.reason] ?? 'cannot be verified'}.`)
      if (config) { guarded = true; reasons.push(protectedConfigReason(candidate, config)); reasonCodes.push(protectedConfigNote(candidate, config)) }
      decision = 'ask'
      continue
    }
    const local = path.relative(root, verdict.resolved).split(/[\\/]/).join('/') || '.'
    const denied = deny.find(rule => pathMatcher(rule.pattern, windows)(local))
    if (denied) return { decision: 'deny' as const, reasons: [`"${local}" is blocked by the rule ${denied.pattern}.`], suggestions: [] }
    // Instructions, MCP settings and hooks are never approved by a rule: a person looks at each change.
    const guard = config ?? protectedConfigKind(local)
    if (guard) {
      guarded = true
      reasons.push(protectedConfigReason(local, guard))
      reasonCodes.push(protectedConfigNote(local, guard))
      decision = 'ask'
      continue
    }
    if (allow.some(rule => pathMatcher(rule.pattern, windows)(local))) continue
    reasons.push(`"${local}" is not covered by an edit rule.`)
    if (decision === 'allow') decision = 'ask'
    const dir = local.includes('/') ? local.slice(0, local.indexOf('/')) : ''
    const pattern = dir ? `${dir}/**` : local
    if (!suggestions.some(item => item.pattern === pattern)) suggestions.push({ kind: 'path', pattern, label: dir ? `edits in ${dir}/` : `edits to ${local}` })
  }
  return { decision, reasons, suggestions, ...(guarded ? { guarded: true as const, reasonCodes } : {}) }
}

/**
 * A guarded request is approved once or declined: "for the session" and any remembering answer are not offered,
 * whatever the provider listed (Codex lists its own decisions; Claude's presenter already leaves them out).
 */
export function guardedDecisions<T extends string>(available: T[], policy: Pick<ThreadRequestPolicy, 'guarded'> | undefined): T[] {
  return policy?.guarded ? available.filter(decision => decision !== 'acceptForSession') : available
}

/** `mcp__server__tool` (Claude's name for an MCP tool) as server and tool. */
export function mcpToolName(toolName: string | undefined): { server: string; tool: string } | undefined {
  const match = toolName?.match(/^mcp__(.+?)__(.+)$/)
  return match ? { server: match[1], tool: match[2] } : undefined
}

function toolRuleMatches(pattern: string, server: string, tool: string): boolean {
  const [ruleServer, ruleTool] = pattern.split('/')
  return ruleServer === server && (ruleTool === '*' || ruleTool === tool)
}

/**
 * Allow or deny rules for an MCP tool call. With no rule, one of OXESpace's own read-only lookups (its server and
 * name together) is approved while "Auto-approve reads" is on (T53); anything else asks, offering the tool or its
 * server. Organization policy is checked before this (thread-policy.ts), so a tool it blocks never gets here.
 */
function evaluateTool(server: string, tool: string, rules: ThreadPermissionRule[], readOnlyList: boolean): ThreadRequestPolicy {
  const toolRules = rules.filter(rule => rule.kind === 'tool')
  const denied = toolRules.find(rule => rule.decision === 'deny' && toolRuleMatches(rule.pattern, server, tool))
  if (denied) return { decision: 'deny', reasons: [`The tool ${server}/${tool} is blocked by the rule ${denied.pattern}.`] }
  if (toolRules.some(rule => rule.decision === 'allow' && toolRuleMatches(rule.pattern, server, tool))) return { decision: 'allow', reasons: ['Covered by the project permission rules.'] }
  if (readOnlyList && isOxespaceReadOnlyTool(server, tool)) return { decision: 'allow', reasons: ['Read-only OXESpace lookup, approved by "Auto-approve reads".'], safeList: true }
  return { decision: 'ask', reasons: [`The tool ${server}/${tool} is not covered by a rule.`], suggestions: [
    { kind: 'tool', pattern: `${server}/${tool}`, label: `the tool ${tool} of ${server}` },
    { kind: 'tool', pattern: `${server}/*`, label: `every tool of ${server}` }
  ] }
}

export function evaluatePermission(
  request: Pick<ThreadRequest, 'kind' | 'command' | 'paths' | 'toolName'>,
  rootPath: string,
  rules: ThreadPermissionRule[],
  options: PathSafetyOptions = {},
  settings: { readOnlyList?: boolean } = {}
): ThreadRequestPolicy | undefined {
  if (request.kind !== 'approval') return undefined
  const command = request.command?.trim()
  const paths = (request.paths ?? []).filter(Boolean)
  const mcp = mcpToolName(request.toolName)
  if (mcp && !command && !paths.length) return evaluateTool(mcp.server, mcp.tool, rules, settings.readOnlyList !== false)
  // Nothing OXESpace can reason about (a web fetch, a native tool): the provider's prompt stands.
  if (!command && !paths.length) return undefined

  const parts: { decision: Decision; reasons: string[]; suggestions: ThreadPermissionSuggestion[]; risk?: 'high'; guarded?: true; reasonCodes?: MainMessage[] }[] = []
  let viaDefaults = false
  let shellRisk: ShellRisk | undefined
  if (command) {
    shellRisk = classifyShellRisk(command)
    const commandRules = rules.filter(rule => rule.kind === 'command')
    const shell = evaluateShellCommand(command, {
      allow: commandRules.filter(rule => rule.decision === 'allow').map(rule => rule.pattern),
      deny: commandRules.filter(rule => rule.decision === 'deny').map(rule => rule.pattern),
      useDefaults: settings.readOnlyList !== false
    })
    // A command the safe list approved must not read outside the project; a rule the person wrote is their call.
    const outside = shell.decision === 'allow' && shell.defaultSubcommands?.length ? readsOutsideProject(shell.defaultSubcommands, rootPath, options) : []
    if (shell.viaDefaults && outside.length === 0) viaDefaults = true
    if (outside.length && shellRisk.level === 'green') shellRisk = { ...shellRisk, level: 'orange' }
    if (outside.length) parts.push({ decision: 'ask', reasons: outside.slice(0, 5).map(item => `${item.command} reads "${item.path}", which ${item.why}.`), suggestions: [] })
    else if (shell.decision === 'deny' && shell.byDefault) parts.push({ decision: 'ask', reasons: shell.reasons, suggestions: [], risk: 'high' })
    else if (shell.decision === 'allow' && commandWritesProtected(command)) {
      const target = commandWritesProtected(command)!
      parts.push({ decision: 'ask', reasons: [protectedConfigReason(target.path, target.kind)], suggestions: [], guarded: true, reasonCodes: [protectedConfigNote(target.path, target.kind)] })
    } else parts.push({
      decision: shell.decision,
      reasons: shell.reasons,
      suggestions: shell.decision === 'ask' ? suggestRules(command).map(item => ({ kind: 'command' as const, pattern: item.rule, label: item.label })) : []
    })
    // P1-17 and B16: a command that names a protected file anywhere (an argument, a redirect, code inside -c or -e, a
    // nested shell, after a cd, a Windows alias), or that rewrites tracked files without naming them (git checkout,
    // tar x…), is guarded whatever a saved rule says, so no provider offers "for the session"; a deny stays a deny.
    // Only a plain read from the built-in safe list (cat AGENTS.md) that names one is still answered.
    const part = parts[parts.length - 1]
    const target = commandWritesProtected(command) ?? commandMentionsProtected(command)
    // The root reads an absolute copy destination (`rsync -a tmp/ C:\repo`) as the project's own folder; the caller's
    // folder check tells a moved folder (`mv dist .`) from a moved file.
    const copy = { root: rootPath, isDirectory: options.isDirectory }
    const rewriter = commandRewritesTracked(command, copy)
    const plainRead = part.decision === 'allow' && outside.length === 0 && isPlainSafeRead(command, copy)
    if (part.decision !== 'deny' && !part.guarded && ((target && !plainRead) || rewriter)) {
      const reasons = [...(target && !plainRead ? [protectedConfigReason(target.path, target.kind)] : []), ...(rewriter ? [rewritesTrackedReason(rewriter)] : [])]
      const reasonCodes = [...(target && !plainRead ? [protectedConfigNote(target.path, target.kind)] : []), ...(rewriter ? [rewritesTrackedNote(rewriter)] : [])]
      Object.assign(part, { decision: 'ask' as const, suggestions: [], guarded: true as const, reasons: [...part.reasons, ...reasons], reasonCodes })
      if (viaDefaults) viaDefaults = false
    }
  }
  if (paths.length) parts.push(evaluatePaths(paths, rootPath, rules, options))

  const denied = parts.find(part => part.decision === 'deny')
  if (denied) return { decision: 'deny', reasons: denied.reasons }
  if (parts.every(part => part.decision === 'allow')) {
    return { decision: 'allow', reasons: [viaDefaults ? 'Read-only command from the built-in safe list.' : 'Covered by the project permission rules.'], ...(viaDefaults ? { safeList: true as const } : {}) }
  }
  const suggestions = parts.flatMap(part => part.suggestions)
  return {
    decision: 'ask',
    reasons: parts.flatMap(part => part.reasons),
    ...(parts.some(part => part.risk) ? { risk: 'high' as const } : {}),
    ...(shellRisk ? { level: shellRisk.level, ...(shellRisk.warnings.length ? { warnings: shellRisk.warnings } : {}) } : {}),
    ...(parts.some(part => part.guarded) ? {
      guarded: true as const, level: shellRisk && shellRisk.level !== 'green' ? shellRisk.level : 'orange' as const,
      warnings: [...(shellRisk?.warnings ?? []), PROTECTED_CONFIG_WARNING], warningCodes: [PROTECTED_CONFIG_WARNING_NOTE],
      reasonCodes: parts.flatMap(part => part.reasonCodes ?? [])
    } : {}),
    // Remembering is only offered when every part has a safe rule to suggest.
    ...(suggestions.length && parts.every(part => part.decision === 'allow' || part.suggestions.length) ? { suggestions } : {})
  }
}

/**
 * With Full access the person chose to let the agent run commands and tools without asking. Claude Code
 * still raises a prompt for commands it cannot analyse (substitution, escaped parentheses, quoting) even in
 * bypassPermissions mode, and every one of them stopped the turn. Those approvals are answered here; a deny
 * rule the person saved still wins, and plan approvals, questions and forms keep reaching the person.
 */
export function fullAccessPolicy(request: Pick<ThreadRequest, 'kind' | 'toolName'>, policy: ThreadRequestPolicy | undefined, access: string | undefined): ThreadRequestPolicy | undefined {
  if (access !== 'full-access' || request.kind !== 'approval' || request.toolName === 'ExitPlanMode') return policy
  if (policy?.decision === 'deny' || policy?.guarded) return policy
  return { ...(policy ?? { reasons: [] }), decision: 'allow', reasons: ['Full access: run without asking.', ...(policy?.reasons ?? [])] }
}
