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
import { checkWorkspacePath, type PathSafetyOptions } from '../path-safety'

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
  const suggestions: ThreadPermissionSuggestion[] = []
  let decision: Decision = 'allow'
  for (const candidate of paths) {
    const verdict = checkWorkspacePath(rootPath, candidate, options)
    if (!verdict.safe) {
      reasons.push(`"${candidate}" ${REASON_FOR[verdict.reason] ?? 'cannot be verified'}.`)
      decision = 'ask'
      continue
    }
    const local = path.relative(root, verdict.resolved).split(/[\\/]/).join('/') || '.'
    const denied = deny.find(rule => pathMatcher(rule.pattern, windows)(local))
    if (denied) return { decision: 'deny' as const, reasons: [`"${local}" is blocked by the rule ${denied.pattern}.`], suggestions: [] }
    if (allow.some(rule => pathMatcher(rule.pattern, windows)(local))) continue
    reasons.push(`"${local}" is not covered by an edit rule.`)
    if (decision === 'allow') decision = 'ask'
    const dir = local.includes('/') ? local.slice(0, local.indexOf('/')) : ''
    const pattern = dir ? `${dir}/**` : local
    if (!suggestions.some(item => item.pattern === pattern)) suggestions.push({ kind: 'path', pattern, label: dir ? `edits in ${dir}/` : `edits to ${local}` })
  }
  return { decision, reasons, suggestions }
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
  options: PathSafetyOptions = {}
): ThreadRequestPolicy | undefined {
  if (request.kind !== 'approval') return undefined
  const command = request.command?.trim()
  const paths = (request.paths ?? []).filter(Boolean)
  const mcp = mcpToolName(request.toolName)
  if (mcp && !command && !paths.length) return evaluateTool(mcp.server, mcp.tool, rules)
  // Nothing OXESpace can reason about (a web fetch, a native tool): the provider's prompt stands.
  if (!command && !paths.length) return undefined

  const parts: { decision: Decision; reasons: string[]; suggestions: ThreadPermissionSuggestion[]; risk?: 'high' }[] = []
  if (command) {
    const commandRules = rules.filter(rule => rule.kind === 'command')
    const shell = evaluateShellCommand(command, {
      allow: commandRules.filter(rule => rule.decision === 'allow').map(rule => rule.pattern),
      deny: commandRules.filter(rule => rule.decision === 'deny').map(rule => rule.pattern)
    })
    if (shell.decision === 'deny' && shell.byDefault) parts.push({ decision: 'ask', reasons: shell.reasons, suggestions: [], risk: 'high' })
    else parts.push({
      decision: shell.decision,
      reasons: shell.reasons,
      suggestions: shell.decision === 'ask' ? suggestRules(command).map(item => ({ kind: 'command' as const, pattern: item.rule, label: item.label })) : []
    })
  }
  if (paths.length) parts.push(evaluatePaths(paths, rootPath, rules, options))

  const denied = parts.find(part => part.decision === 'deny')
  if (denied) return { decision: 'deny', reasons: denied.reasons }
  if (parts.every(part => part.decision === 'allow')) return { decision: 'allow', reasons: ['Covered by the project permission rules.'] }
  const suggestions = parts.flatMap(part => part.suggestions)
  return {
    decision: 'ask',
    reasons: parts.flatMap(part => part.reasons),
    ...(parts.some(part => part.risk) ? { risk: 'high' as const } : {}),
    // Remembering is only offered when every part has a safe rule to suggest.
    ...(suggestions.length && parts.every(part => part.decision === 'allow' || part.suggestions.length) ? { suggestions } : {})
  }
}
