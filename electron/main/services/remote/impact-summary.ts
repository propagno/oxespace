import type { ThreadRequest } from '../../../../shared/types/thread'
import { remoteImpact as enImpact } from '../../../../shared/locales/en/main.json'
import { remoteImpact as ptImpact } from '../../../../shared/locales/pt-BR/main.json'
import { baseName, splitShellCommand, tokenize, unwrapPowerShell } from '../conversation/shell-command-rules'

export type DesktopImpactLanguage = 'en' | 'pt-BR'

type ImpactActionCode =
  | 'removeVolume'
  | 'removeContainer'
  | 'manageContainer'
  | 'writeProdDb'
  | 'writeDb'
  | 'forcePush'
  | 'publish'
  | 'mergePr'
  | 'push'
  | 'editOutsideProject'
  | 'editFiles'
  | 'deleteFiles'
  | 'discardGit'
  | 'modifyInfra'
  | 'changePermissions'
  | 'formatDisk'
  | 'stopSystemOrProcess'
  | 'runRemoteCode'
  | 'runIrreversibleCommand'
  | 'runReadOnlyCommand'
  | 'runCommand'

/** The action's words, from the main catalogs (shared/locales/*/main.json › remoteImpact). */
const LABELS: Record<DesktopImpactLanguage, Record<ImpactActionCode, string>> = { en: enImpact, 'pt-BR': ptImpact }

const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/
const FETCHERS = new Set(['curl', 'wget', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm'])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'cmd', 'powershell', 'pwsh', 'python', 'python3', 'node', 'ruby', 'perl', 'iex', 'invoke-expression'])
const DELETE_COMMANDS = new Set(['rm', 'rmdir', 'del', 'erase', 'rd', 'remove-item', 'ri'])
const PERMISSION_COMMANDS = new Set(['sudo', 'su', 'chmod', 'chown', 'set-acl', 'set-executionpolicy'])
const DISK_COMMANDS = new Set(['dd', 'mkfs', 'format', 'format-volume', 'clear-disk'])
const PROCESS_COMMANDS = new Set(['shutdown', 'reboot', 'kill', 'killall', 'taskkill', 'stop-process', 'spps'])
const DYNAMIC_EXEC_COMMANDS = new Set(['iex', 'invoke-expression', 'eval'])
const CONTAINER_VOLUME = /\bvolume\b/i

function stripWrappers(tokens: readonly string[]): string[] {
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
        index += (tokens[index] === '-k' || tokens[index] === '-s') ? 2 : 1
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

function pipesDownloadIntoShell(line: string): boolean {
  const parts = line.split(/(?<!\|)\|(?!\|)/).map(part => baseName(tokenize(part.trim())[0] ?? ''))
  return parts.some((head, index) => index > 0 && SHELLS.has(head)) && parts.some(head => FETCHERS.has(head))
}

function classifyPushCommand(line: string): ImpactActionCode {
  const subs = splitShellCommand(line) ?? [line]
  for (const sub of subs) {
    const raw = tokenize(sub)
    const unwrapped = unwrapPowerShell([...raw])
    if (unwrapped) return classifyPushCommand(unwrapped)
    const tokens = stripWrappers(raw)
    if (!tokens.length) continue
    const head = baseName(tokens[0])
    const git = gitSubcommand(tokens)
    if (git && git.verb === 'push') {
      if (git.rest.some(arg => /^(--force\b|--force-with-lease\b|-f\b|--delete\b|--mirror\b)/.test(arg))) return 'forcePush'
      return 'push'
    }
    if ((head === 'npm' || head === 'pnpm' || head === 'yarn' || head === 'bun' || head === 'cargo') && tokens[1] === 'publish') return 'publish'
    if (head === 'twine' && tokens[1] === 'upload') return 'publish'
    if (head === 'gh' && tokens[1] === 'release') return 'publish'
    if (head === 'gh' && tokens[1] === 'pr' && tokens[2] === 'merge') return 'mergePr'
  }
  return 'push'
}

function classifyCommandTokens(rawTokens: readonly string[]): ImpactActionCode | undefined {
  const unwrapped = unwrapPowerShell([...rawTokens])
  if (unwrapped) return classifyCommandLine(unwrapped)
  const tokens = stripWrappers(rawTokens)
  if (!tokens.length) return undefined
  const head = baseName(tokens[0])
  if (head === 'docker' || head === 'podman') {
    if (tokens[1] === 'volume' && (tokens[2] === 'rm' || tokens[2] === 'prune')) return 'removeVolume'
    if (tokens[1] === 'compose' && tokens.includes('down') && tokens.some(arg => arg === '-v' || arg === '--volumes')) return 'removeVolume'
    if (tokens[1] === 'rm' || tokens[1] === 'rmi' || ((tokens[1] === 'system' || tokens[1] === 'container' || tokens[1] === 'image') && tokens[2] === 'prune')) return 'removeContainer'
  }
  if (head === 'docker-compose' && tokens[1] === 'down' && tokens.some(arg => arg === '-v' || arg === '--volumes')) return 'removeVolume'
  if (DELETE_COMMANDS.has(head)) return 'deleteFiles'
  if (head === 'find' && tokens.slice(1).includes('-delete')) return 'deleteFiles'
  const git = gitSubcommand(tokens)
  if (git) {
    if (git.verb === 'clean' && git.rest.some(arg => /^-[a-zA-Z]*f/.test(arg) || arg === '--force')) return 'deleteFiles'
    if (
      (git.verb === 'reset' && git.rest.includes('--hard')) ||
      (git.verb === 'checkout' && (git.rest.includes('--') || git.rest.includes('.'))) ||
      git.verb === 'restore' ||
      (git.verb === 'branch' && git.rest.includes('-D')) ||
      (git.verb === 'stash' && (git.rest[0] === 'drop' || git.rest[0] === 'clear')) ||
      git.verb === 'rebase'
    ) {
      return 'discardGit'
    }
  }
  if ((head === 'kubectl' && tokens[1] === 'delete') || (head === 'terraform' && (tokens[1] === 'apply' || tokens[1] === 'destroy'))) return 'modifyInfra'
  if (DISK_COMMANDS.has(head)) return 'formatDisk'
  if (PERMISSION_COMMANDS.has(head)) return 'changePermissions'
  if (PROCESS_COMMANDS.has(head)) return 'stopSystemOrProcess'
  if (DYNAMIC_EXEC_COMMANDS.has(head)) return 'runRemoteCode'
  return undefined
}

function classifyCommandLine(line: string): ImpactActionCode | undefined {
  if (pipesDownloadIntoShell(line)) return 'runRemoteCode'
  const subs = splitShellCommand(line) ?? [line]
  for (const sub of subs) {
    const match = classifyCommandTokens(tokenize(sub))
    if (match) return match
  }
  return undefined
}

/**
 * OXE-164 (RN-1 / Risco 2): builds a short action/impact label authored exclusively by the desktop's local classifier
 * from `request.impact` and deterministic inspection of `request.command`. Never reads agent-written text
 * (`request.title`, `request.detail`, `request.reason`, or `request.impact.text`).
 */
export function desktopImpactSummaryOf(
  request: ThreadRequest,
  language: DesktopImpactLanguage = 'en'
): string | undefined {
  if (request.kind !== 'approval' || !request.impact) return undefined
  const impact = request.impact
  const command = request.command?.trim() ?? ''
  const catalog = LABELS[language] ?? LABELS.en

  switch (impact.kind) {
    case 'db':
      return impact.risk === 'critical' ? catalog.writeProdDb : catalog.writeDb
    case 'container':
      if (!impact.reversible) {
        return CONTAINER_VOLUME.test(command) ? catalog.removeVolume : catalog.removeContainer
      }
      return catalog.manageContainer
    case 'push':
      return catalog[command ? classifyPushCommand(command) : 'push']
    case 'file':
      return impact.reversible ? catalog.editFiles : catalog.editOutsideProject
    case 'command': {
      const specific = command ? classifyCommandLine(command) : undefined
      if (specific) return catalog[specific]
      if (!impact.reversible) return catalog.runIrreversibleCommand
      return impact.risk === 'low' ? catalog.runReadOnlyCommand : catalog.runCommand
    }
  }
}
