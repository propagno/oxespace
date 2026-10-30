/**
 * Looks for instructions hidden in what an MCP server says about its tools.
 *
 * A model reads a tool's name, description and parameter descriptions as part of its context, so a
 * server can steer it from there ("tool poisoning"). This is a heuristic, not a verdict: it finds the
 * patterns that have no place in an honest description, and the person decides. Pure, so the panel
 * (renderer) and the guard that quarantines a changed server (main) share it.
 */
export type McpScanKind = 'hidden-characters' | 'override-instructions' | 'concealment' | 'secret-access' | 'exfiltration'

export interface McpScanFinding {
  tool: string
  kind: McpScanKind
  /** The text that matched, shortened, with invisible characters made visible. */
  excerpt: string
}

export interface McpScanTool { name: string; description?: string; inputSchema?: unknown }

export const MCP_SCAN_KIND_LABEL: Record<McpScanKind, string> = {
  'hidden-characters': 'Invisible characters',
  'override-instructions': 'Tries to override the agent\'s instructions',
  concealment: 'Asks the agent to hide something from you',
  'secret-access': 'Asks the agent to read secrets',
  exfiltration: 'Asks the agent to send private data elsewhere'
}

/** Zero-width, bidirectional control, soft hyphen, BOM and Unicode "tag" characters: all invisible to a reader. */
const HIDDEN = /[​-‏‪-‮⁠-⁤⁦-⁩­﻿᠎]|[\u{E0000}-\u{E007F}]/gu

const RULES: Array<{ kind: McpScanKind; pattern: RegExp }> = [
  { kind: 'override-instructions', pattern: /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,20}\b(?:all |any |the |your |every )*(?:previous|prior|above|earlier|preceding|system|original)\b[^.\n]{0,20}\b(?:instructions?|prompts?|messages?|rules|guidelines|context)\b/i },
  { kind: 'override-instructions', pattern: /\b(?:new|updated|real|actual) (?:system )?instructions?\s*:/i },
  { kind: 'override-instructions', pattern: /<\/?(?:important|system|instructions?|assistant|admin)>/i },
  { kind: 'concealment', pattern: /\b(?:do not|don't|never|without)\b[^.\n]{0,25}\b(?:tell|inform|notify|mention|show|reveal|alert|warn|let)\b[^.\n]{0,20}\b(?:the )?user\b/i },
  { kind: 'concealment', pattern: /\b(?:hide|conceal|keep)\b[^.\n]{0,25}\b(?:this|it|that)\b[^.\n]{0,25}\b(?:from|secret from)\b[^.\n]{0,12}\b(?:the )?user\b/i },
  { kind: 'secret-access', pattern: /\b(?:read|cat|open|access|include|load|fetch|get|extract|copy|list)\b[^.\n]{0,50}(?:~\/\.ssh|\.ssh\/|\bid_(?:rsa|ed25519|ecdsa)\b|\.aws\/|\.env\b|\.npmrc|\.netrc|\.git-credentials|\/etc\/(?:passwd|shadow)|\bssh keys?\b|\bprivate keys?\b|\bapi keys?\b|\bpasswords?\b|\bcredentials\b|\bcookies\b|\bbrowser (?:profile|data)\b|\benvironment variables\b)/i },
  { kind: 'exfiltration', pattern: /\b(?:send|post|upload|forward|transmit|leak|exfiltrate|email|copy|submit)\b[^.\n]{0,60}\b(?:system prompt|conversation|chat history|environment variables|credentials|secrets|api keys?|private keys?|ssh keys?|passwords?|cookies|source code)\b[^.\n]{0,60}\b(?:to|at|via)\b[^.\n]{0,50}(?:https?:\/\/|\bwebhook\b|\bserver\b|\bendpoint\b|\be-?mail\b)/i },
  { kind: 'exfiltration', pattern: /\bexfiltrat\w*/i }
]

const MAX_EXCERPT = 90
const MAX_FINDINGS = 30
const MAX_TEXT = 20_000

function visible(text: string): string {
  return text.replace(HIDDEN, char => `<U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}>`)
}

function excerpt(text: string, index: number, length: number): string {
  // From the start of the word before the match, so the excerpt does not begin in the middle of one.
  const from = Math.max(0, text.lastIndexOf(' ', Math.max(0, index - 12)) + 1)
  const piece = visible(text.slice(from, index + Math.min(length, MAX_EXCERPT))).replace(/\s+/g, ' ').trim()
  return piece.length > MAX_EXCERPT ? `${piece.slice(0, MAX_EXCERPT)}…` : piece
}

/** The descriptions and titles inside a JSON schema, which a model reads as part of the tool. */
function schemaTexts(schema: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8 || out.length > 200 || !schema || typeof schema !== 'object') return out
  if (Array.isArray(schema)) { for (const item of schema) schemaTexts(item, out, depth + 1); return out }
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if ((key === 'description' || key === 'title') && typeof value === 'string') out.push(value)
    else if (value && typeof value === 'object') schemaTexts(value, out, depth + 1)
  }
  return out
}

/** Findings for each tool, at most one per tool and kind. Names are scanned too: they are read like text. */
export function scanToolDescriptions(tools: readonly McpScanTool[]): McpScanFinding[] {
  const findings: McpScanFinding[] = []
  for (const tool of tools) {
    const name = typeof tool.name === 'string' ? tool.name.slice(0, 200) : '?'
    const text = [name, typeof tool.description === 'string' ? tool.description : '', ...schemaTexts(tool.inputSchema)].join('\n').slice(0, MAX_TEXT)
    const seen = new Set<McpScanKind>()
    const hidden = [...text.matchAll(HIDDEN)]
    if (hidden.length > 0) {
      seen.add('hidden-characters')
      findings.push({ tool: name, kind: 'hidden-characters', excerpt: `${hidden.length} invisible character${hidden.length === 1 ? '' : 's'}: ${excerpt(text, hidden[0].index ?? 0, 40)}` })
    }
    // Without the invisible characters, so ignoring them is not a way around a phrase.
    const plain = text.replace(HIDDEN, '')
    for (const { kind, pattern } of RULES) {
      if (seen.has(kind)) continue
      const match = pattern.exec(plain)
      if (!match) continue
      seen.add(kind)
      findings.push({ tool: name, kind, excerpt: excerpt(plain, match.index, match[0].length) })
    }
    if (findings.length >= MAX_FINDINGS) return findings.slice(0, MAX_FINDINGS)
  }
  return findings
}
