import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * OXE-405 (the user, 23/11): the repository keeps no notes or names of the Orca project (github.com/stablyai/orca),
 * which OXESpace took ideas from. What stays is what is not about that project's notes:
 * - the attribution its MIT License requires for code adapted from it (THIRD_PARTY_NOTICES.md, the notice check and
 *   the headers of the adapted files);
 * - Orca, the GNOME screen reader, in the accessibility scripts and reports.
 * Words that only contain the letters (connectorCatalog, editorCandidates) are not mentions.
 */
const LICENSE_ATTRIBUTION = [
  'THIRD_PARTY_NOTICES.md',
  'scripts/bundled-dependencies.mjs',
  'electron/main/services/remote/windows-firewall.ts',
  'scripts/remote-subscribe.mts',
  'electron/main/services/agent-hooks/events.ts',
]
const SCREEN_READER = [
  'docs/validation/screen-reader-1.4.md',
  'docs/validation/wcag-2.2.md',
  'docs/validation/ux-agentic-1.4.md',
  'docs/validation/maturity-frontend-1.4.md',
  'docs/roadmap-1.4/frontend.md',
  'docs/roadmap-1.4/integration.md',
  'docs/perf/terminal-renderer.md',
  'e2e/screen-reader-script.spec.ts',
]
const SELF = 'tests/unit/no-orca-references.test.ts'
const NOT_MENTIONS = /connectorCatalog|editorCandidates/g
const BINARY = /\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|zip|jar|apk|aab|keystore|jks|sqlite3?|wasm|node|exe|dll)$/i

function filesMentioningOrca(): string[] {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean)
  return tracked.filter(file => {
    if (BINARY.test(file)) return false
    let text: string
    try { text = readFileSync(file, 'latin1') } catch { return false }
    return /orca/i.test(text.replace(NOT_MENTIONS, ''))
  })
}

describe('OXE-405 · Orca project notes and names', () => {
  it('only license attribution and the screen reader mention Orca', () => {
    const allowed = new Set([...LICENSE_ATTRIBUTION, ...SCREEN_READER, SELF])
    expect(filesMentioningOrca().filter(file => !allowed.has(file))).toEqual([])
    // The MIT attribution itself stays.
    expect(readFileSync('THIRD_PARTY_NOTICES.md', 'utf8')).toMatch(/^## Orca$/m)
  })
})
