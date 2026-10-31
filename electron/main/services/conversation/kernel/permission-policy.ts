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
import picomatch from 'picomatch'
import { posix, win32 } from 'node:path'
import type { ThreadPermissionRule, ThreadPermissionSuggestion, ThreadRequest, ThreadRequestPolicy } from '../../../../../shared/types/thread'
import { evaluateShellCommand, suggestRules } from '../shell-command-rules'
import { classifyShellRisk, type ShellRisk } from '../shell-risk'
import { readsOutsideProject } from '../shell-reads'
import { checkWorkspacePath, type PathSafetyOptions } from '../path-safety'
import { commandMentionsProtected, commandRewritesTracked, commandWritesProtected, isPlainSafeRead, protectedConfigKind, protectedConfigNote, protectedConfigReason, PROTECTED_CONFIG_WARNING, PROTECTED_CONFIG_WARNING_NOTE, rewritesTrackedNote, rewritesTrackedReason } from './protected-config'
import type { MainMessage } from '../../../../../shared/messages'

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

function pathMatcher(pattern: string, windows: boolean): (path: string) => boolean {
  try { return picomatch(pattern, { dot: true, nocase: windows }) } catch { return () => false }
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

/** Allow or deny rules for an MCP tool call; anything unruled asks, offering the tool or its server. */
function evaluateTool(server: string, tool: string, rules: ThreadPermissionRule[]): ThreadRequestPolicy {
  const toolRules = rules.filter(rule => rule.kind === 'tool')
  const denied = toolRules.find(rule => rule.decision === 'deny' && toolRuleMatches(rule.pattern, server, tool))
  if (denied) return { decision: 'deny', reasons: [`The tool ${server}/${tool} is blocked by the rule ${denied.pattern}.`] }
  if (toolRules.some(rule => rule.decision === 'allow' && toolRuleMatches(rule.pattern, server, tool))) return { decision: 'allow', reasons: ['Covered by the project permission rules.'] }
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
  if (mcp && !command && !paths.length) return evaluateTool(mcp.server, mcp.tool, rules)
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
    const rewriter = commandRewritesTracked(command)
    const plainRead = part.decision === 'allow' && outside.length === 0 && isPlainSafeRead(command)
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
