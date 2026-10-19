import { basename } from 'node:path'

/** Executable names (lower case, without extension) and the detection manifest they use. */
const EXECUTABLES: Record<string, string> = {
  claude: 'claude', codex: 'codex', copilot: 'copilot', 'cursor-agent': 'cursor', gemini: 'gemini', grok: 'grok',
  opencode: 'opencode', qwen: 'qwen', kimi: 'kimi', amp: 'amp', droid: 'droid'
}

/** The agent an executable or command line starts, if it is one we can read. */
export function agentFromCommand(command: string | undefined | null): string | null {
  if (!command) return null
  const first = command.trim().match(/^"([^"]+)"|^(\S+)/)
  const token = (first?.[1] ?? first?.[2] ?? '').replace(/\\/g, '/')
  const name = basename(token).toLowerCase().replace(/\.(exe|cmd|bat|ps1|js|mjs)$/, '')
  return EXECUTABLES[name] ?? null
}
