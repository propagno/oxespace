/**
 * Readable forms of a shell command for the approval card. They only change what is shown;
 * the exact command is always available next to them.
 *
 * Adapted from VS Code's command line presenters (microsoft/vscode, MIT licence,
 * Copyright (c) Microsoft Corporation): `terminalContrib/chatAgentTools/browser/tools/commandLinePresenter/`
 * and `extractCdPrefix` in `runInTerminalHelpers.ts`.
 */

export interface InlineScript {
  language: 'JavaScript' | 'Python' | 'Ruby'
  script: string
}

const INTERPRETERS: Record<string, { language: InlineScript['language']; flags: string }> = {
  node: { language: 'JavaScript', flags: '-e|--eval|-p|--print' },
  nodejs: { language: 'JavaScript', flags: '-e|--eval|-p|--print' },
  python: { language: 'Python', flags: '-c' },
  python3: { language: 'Python', flags: '-c' },
  py: { language: 'Python', flags: '-c' },
  ruby: { language: 'Ruby', flags: '-e' }
}

/** The text between matching quotes starting at `start`, with `\"` and `\\` undone inside double quotes. */
function readQuoted(text: string, start: number): string | null {
  const quote = text[start]
  let out = ''
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i]
    if (quote === '"' && ch === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) { out += text[i + 1]; i += 1; continue }
    if (ch === quote) return out
    out += ch
  }
  return null
}

/** The script of `node -e "…"`, `python -c '…'` or `ruby -e "…"`, so it is read as code rather than as a quoted one-liner. */
export function presentInlineScript(command: string): InlineScript | null {
  const head = command.match(/^\s*(?:"([^"]+)"|'([^']+)'|(\S+))\s+/)
  if (!head) return null
  const executable = (head[1] ?? head[2] ?? head[3]).replace(/\\/g, '/').split('/').pop()!.toLowerCase().replace(/\.exe$/, '')
  const interpreter = INTERPRETERS[executable]
  if (!interpreter) return null
  const rest = command.slice(head[0].length)
  const flag = rest.match(new RegExp(`(?:^|\\s)(?:${interpreter.flags})\\s+(["'])`))
  if (!flag || flag.index === undefined) return null
  const script = readQuoted(rest, flag.index + flag[0].length - 1)
  if (!script || !script.trim()) return null
  return { language: interpreter.language, script: script.replace(/\\n/g, '\n') }
}

/** `cd <dir> && rest`: the directory and what runs there. The prefix repeats what the card already says about where. */
export function extractCdPrefix(command: string): { directory: string; rest: string } | null {
  const match = command.match(/^\s*cd\s+(?:\/d\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*(?:&&|;)\s*([\s\S]+)$/i)
  if (!match) return null
  const rest = match[4].trim()
  return rest ? { directory: match[1] ?? match[2] ?? match[3], rest } : null
}
