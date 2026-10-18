/**
 * A three-level reading of how much a shell command could change, for the approval card.
 *
 * - green:  reads only (the built-in safe list).
 * - orange: changes files, history or the network, or is something this analysis does not know.
 * - red:    deletes, escalates, runs downloaded code, publishes, or overwrites history.
 *
 * Deterministic and text-only, after the rubric VS Code gives its risk model
 * (microsoft/vscode, MIT licence, Copyright (c) Microsoft Corporation:
 * `chatToolRiskAssessmentService.ts`) but without asking a model, which would cost a call per
 * approval and add a prompt-injection surface. It informs the person; it never decides for them.
 */
import { baseName, splitShellCommand, tokenize, unwrapPowerShell, writesFile } from './shell-command-rules'
import { matchesDefaultAllow } from './default-shell-rules'

export type ShellRiskLevel = 'green' | 'orange' | 'red'

export interface ShellRisk {
  level: ShellRiskLevel
  /** Facts worth a second look, in plain words. */
  warnings: string[]
}

const FETCHERS = new Set(['curl', 'wget', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm'])
const INJECTION = 'Web content can contain instructions meant to steer the agent (prompt injection). Read what comes back before acting on it.'

const RED_COMMANDS = new Set([
  'rm', 'rmdir', 'del', 'erase', 'rd', 'remove-item', 'ri', 'dd', 'mkfs', 'format', 'format-volume', 'clear-disk', 'shutdown', 'reboot',
  'sudo', 'su', 'chown', 'set-acl', 'set-executionpolicy', 'kill', 'killall', 'taskkill', 'stop-process', 'spps', 'invoke-expression', 'iex', 'eval'
])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'cmd', 'powershell', 'pwsh', 'python', 'python3', 'node', 'ruby', 'perl', 'iex', 'invoke-expression'])
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'pip', 'pip3', 'cargo', 'gem', 'brew', 'apt', 'apt-get', 'choco', 'winget', 'scoop'])

const GIT_RED = /^git(\s+(-C\s+\S+|--no-pager))*\s+(push\s.*(--force\b|--force-with-lease\b|-f\b|--delete\b|--mirror\b)|reset\s.*--hard\b|clean\s.*-[a-z]*f|checkout\s.*(--\s|\.$)|restore\s|branch\s.*-D\b|rebase\b|filter-branch\b|reflog\s+(expire|delete)\b|gc\s.*--prune)/
const PUBLISH = /^(npm|pnpm|yarn)\s+(publish|unpublish|deprecate|dist-tag|owner|access|login|adduser|token)\b|^cargo\s+(publish|yank|login|owner)\b|^gh\s+(release\s+(create|delete)|repo\s+(delete|create)|secret\s)/
const GLOBAL_INSTALL = /^(npm|pnpm|yarn)\s+(i|install|add|remove|uninstall|rm|link)\b.*(\s-g\b|--global\b)/
const RECURSIVE_PERMS = /^(chmod|chown)\s+(-[a-zA-Z]*R|--recursive)\b/

function subcommandLevel(sub: string): { level: ShellRiskLevel; warnings: string[] } {
  const tokens = tokenize(sub)
  if (!tokens.length) return { level: 'green', warnings: [] }
  const head = baseName(tokens[0])
  const normalised = [head, ...tokens.slice(1)].join(' ')
  const warnings: string[] = []
  if (FETCHERS.has(head)) warnings.push(INJECTION)
  if (RED_COMMANDS.has(head)) return { level: 'red', warnings }
  if (GIT_RED.test(normalised)) return { level: 'red', warnings: [...warnings, 'This git command can overwrite or discard work that is hard to recover.'] }
  if (PUBLISH.test(normalised)) return { level: 'red', warnings: [...warnings, 'This publishes or changes access outside this machine.'] }
  if (GLOBAL_INSTALL.test(normalised)) return { level: 'red', warnings: [...warnings, 'A global install changes the whole machine, not only this project.'] }
  if (RECURSIVE_PERMS.test(normalised)) return { level: 'red', warnings }
  if (matchesDefaultAllow(normalised)) return { level: 'green', warnings }
  return { level: 'orange', warnings }
}

/** True when the output of a fetcher is piped into an interpreter: downloaded code runs unseen. */
function pipesDownloadIntoShell(line: string): boolean {
  const parts = line.split(/(?<!\|)\|(?!\|)/).map((part) => baseName(tokenize(part.trim())[0] ?? ''))
  return parts.some((head, index) => index > 0 && SHELLS.has(head)) && parts.some((head) => FETCHERS.has(head))
}

const ORDER: ShellRiskLevel[] = ['green', 'orange', 'red']
const worst = (a: ShellRiskLevel, b: ShellRiskLevel): ShellRiskLevel => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b)

export function classifyShellRisk(line: string): ShellRisk {
  const subcommands = splitShellCommand(line)
  // What cannot be split cannot be judged: say so rather than guess it is harmless.
  if (!subcommands || !subcommands.length) return { level: 'orange', warnings: ['This command uses substitution or quoting that cannot be analysed.'] }

  let level: ShellRiskLevel = 'green'
  const warnings = new Set<string>()
  if (pipesDownloadIntoShell(line)) {
    level = 'red'
    warnings.add('Downloaded content is piped straight into an interpreter, so it runs before anyone can read it.')
  }
  for (const sub of subcommands) {
    const script = unwrapPowerShell(tokenize(sub))
    const inner = script ? classifyShellRisk(script) : subcommandLevel(sub)
    level = worst(level, inner.level)
    for (const warning of inner.warnings) warnings.add(warning)
    // A redirect writes a file even when the command that feeds it only reads.
    if (inner.level === 'green' && writesFile(sub)) level = worst(level, 'orange')
  }
  return { level, warnings: [...warnings] }
}
