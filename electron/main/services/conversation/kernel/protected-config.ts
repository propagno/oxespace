/**
 * Files that steer an agent: its instructions, its MCP servers and its hooks.
 *
 * Text an agent reads (a web page, an issue, a file in a cloned repository) can try to make it rewrite
 * these, so that the next session, or another agent, starts under someone else's orders: an injection
 * that outlives the conversation it arrived in. A change to one of them is never approved by a saved
 * rule, by the built-in lists or by "allow for this session"; a person looks at it each time.
 *
 * Pure: it reasons about path and command text only.
 */
import { baseName, splitShellCommand, tokenize } from '../shell-command-rules'
import { mainMessage, type MainMessage } from '../../../../../shared/messages'

export type ProtectedConfigKind = 'instructions' | 'mcp' | 'hooks'

export const PROTECTED_CONFIG_LABEL: Record<ProtectedConfigKind, string> = {
  instructions: 'agent instructions',
  mcp: 'MCP server settings',
  hooks: 'agent hooks'
}

const NAMES: Record<string, ProtectedConfigKind> = {
  'agents.md': 'instructions',
  'claude.md': 'instructions',
  'claude.local.md': 'instructions',
  'gemini.md': 'instructions',
  '.cursorrules': 'instructions',
  '.windsurfrules': 'instructions',
  'copilot-instructions.md': 'instructions',
  '.mcp.json': 'mcp'
}

/** Matched against the whole path, lower-cased, with forward slashes. */
const PLACES: Array<{ kind: ProtectedConfigKind; pattern: RegExp }> = [
  { kind: 'hooks', pattern: /(^|\/)\.claude\/settings(\.local)?\.json$/ },
  { kind: 'hooks', pattern: /(^|\/)\.claude\/hooks\// },
  { kind: 'hooks', pattern: /(^|\/)\.codex\/hooks(\.json|\/)/ },
  { kind: 'hooks', pattern: /(^|\/)\.git\/hooks\// },
  { kind: 'hooks', pattern: /(^|\/)\.husky\// },
  { kind: 'mcp', pattern: /(^|\/)\.(cursor|vscode)\/mcp\.json$/ },
  { kind: 'mcp', pattern: /(^|\/)\.(codex\/config\.toml|gemini\/settings\.json)$/ },
  { kind: 'instructions', pattern: /(^|\/)\.cursor\/rules\// },
  { kind: 'instructions', pattern: /(^|\/)\.github\/copilot-instructions\.md$/ }
]

/** What a path configures for agents, or null for an ordinary file. */
export function protectedConfigKind(path: string): ProtectedConfigKind | null {
  const normal = path.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase().trim()
  if (!normal) return null
  const name = normal.slice(normal.lastIndexOf('/') + 1)
  if (Object.hasOwn(NAMES, name)) return NAMES[name]
  return PLACES.find(place => place.pattern.test(normal))?.kind ?? null
}

/** Commands that write or remove the files named in their arguments. */
const WRITERS = new Set([
  'tee', 'cp', 'mv', 'rm', 'ln', 'install', 'truncate', 'touch', 'dd', 'sed', 'perl', 'ex', 'ed',
  'set-content', 'add-content', 'out-file', 'new-item', 'copy-item', 'move-item', 'remove-item', 'rename-item', 'clear-content', 'sc', 'ac'
])

/** The first protected file that a writing command in this line names (the shell's own redirections already ask). */
export function commandWritesProtected(command: string): { path: string; kind: ProtectedConfigKind } | null {
  for (const sub of splitShellCommand(command) ?? [command]) {
    const tokens = tokenize(sub)
    if (!tokens.length || !WRITERS.has(baseName(tokens[0]))) continue
    // sed and perl only write with an in-place flag; without it they print.
    if (/^(sed|perl)$/.test(baseName(tokens[0])) && !tokens.slice(1).some(token => /^(-[a-zA-Z]*i|--in-place)/.test(token))) continue
    for (const token of tokens.slice(1)) {
      // `of=AGENTS.md` and `--output=AGENTS.md` carry the path after the equals sign.
      const value = token.includes('=') ? token.slice(token.indexOf('=') + 1) : token
      const kind = protectedConfigKind(value)
      if (kind) return { path: value, kind }
    }
  }
  return null
}

/** English, for the audit trail and logs; the person sees `protectedConfigNote` in their language. */
export function protectedConfigReason(path: string, kind: ProtectedConfigKind): string {
  return `"${path}" holds ${PROTECTED_CONFIG_LABEL[kind]}. A change there steers every later session, so it needs your confirmation each time.`
}

/** The same reason as a C3 code (`thread.protectedConfig.<kind>`), for the approval card. */
export function protectedConfigNote(path: string, kind: ProtectedConfigKind): MainMessage {
  return mainMessage(`thread.protectedConfig.${kind}`, { path })
}

export const PROTECTED_CONFIG_WARNING = 'Text the agent read (a web page, an issue, a file) may be steering this change. Check that you asked for it.'
export const PROTECTED_CONFIG_WARNING_NOTE: MainMessage = mainMessage('thread.protectedConfig.warning', {})
