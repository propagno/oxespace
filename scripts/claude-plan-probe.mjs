#!/usr/bin/env node
// Shows WHERE Claude's live plan is, without showing anything private.
// Run it yourself (it reads your own Claude Code credentials):   node scripts/claude-plan-probe.mjs
//
// It calls the two Anthropic endpoints Claude Code uses with your sign-in, then prints only:
//   - each response's HTTP status;
//   - the tree of field names and their types;
//   - the VALUES of plan-like fields only (names matching plan|tier|type|subscription|has_claude), and only when the
//     value is a boolean or a short word (letters, digits, _ . -). Never a token, email, name, id or any other value.
// The token is read from the local file and sent only to api.anthropic.com; it is never printed or written anywhere.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const file = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), '.credentials.json')
let oauth
try { oauth = JSON.parse(readFileSync(file, 'utf8')).claudeAiOauth } catch { console.log(`Could not read ${file} (on macOS Claude Code keeps it in the keychain).`); process.exit(1) }
if (!oauth?.accessToken) { console.log('No Claude sign-in found.'); process.exit(1) }

const PLAN_KEY = /plan|tier|type|subscription|has_claude/i
const WORD = /^[A-Za-z0-9_.-]{1,40}$/
const ID_KEY = /uuid|id$|email|name|token|secret|key/i

function shape(value, path, out) {
  if (Array.isArray(value)) { out.push(`${path}: array(${value.length})`); if (value.length) shape(value[0], `${path}[0]`, out); return }
  if (value && typeof value === 'object') { for (const [key, inner] of Object.entries(value)) shape(inner, path ? `${path}.${key}` : key, out); return }
  const leaf = path.split('.').pop() ?? ''
  const show = PLAN_KEY.test(leaf) && !ID_KEY.test(leaf) && (typeof value === 'boolean' || (typeof value === 'string' && WORD.test(value)))
  out.push(`${path}: ${value === null ? 'null' : typeof value}${show ? ` = ${JSON.stringify(value)}` : ''}`)
}

console.log(`credentials file: subscriptionType = ${WORD.test(String(oauth.subscriptionType)) ? JSON.stringify(oauth.subscriptionType) : typeof oauth.subscriptionType}, subscriptionTypeSource = ${WORD.test(String(oauth.subscriptionTypeSource)) ? JSON.stringify(oauth.subscriptionTypeSource) : typeof oauth.subscriptionTypeSource}`)
for (const url of ['https://api.anthropic.com/api/oauth/usage', 'https://api.anthropic.com/api/oauth/profile']) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${oauth.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'claude-code/2.0.0' }, signal: AbortSignal.timeout(15_000) })
    console.log(`\n${url} → HTTP ${res.status}`)
    if (!res.ok) continue
    const out = []
    shape(await res.json(), '', out)
    for (const line of out) console.log(`  ${line}`)
  } catch (error) {
    console.log(`\n${url} → failed (${error?.name ?? 'error'})`)
  }
}
