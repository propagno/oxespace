// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * B7.4 (ARCHITECT change 12): every security reader of the gated files goes through the one accessor that applies only
 * the accepted version, so a new reader cannot bring back "the file as it is on disk".
 * - `.oxespace/policy.json`: `PolicyStore.load` (services/policy/). Nothing else parses a policy or reads the file, but
 *   the marked writer (mcp-tool-rules.ts), which checks what it is about to write.
 * - `oxe.yaml` tool modes: `effectiveToolConfig` (services/policy/tool-config.ts). Nothing else reads `thread.tools` or
 *   `thread.toolModes`, or calls `projectToolModes`, but the parser, the interpretation and the writer that edits the text.
 * - Each app writer of a gated file refuses while a change is pending and records what it wrote before the rename.
 */
const MAIN = join('electron', 'main')
const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? (name === 'vendor' ? [] : files(path)) : path.endsWith('.ts') ? [path] : []
})
const sources = files(MAIN).map(path => ({ path: relative(MAIN, path).replace(/\\/g, '/'), text: readFileSync(path, 'utf8') }))
const outside = (allowed: string[], test: (text: string) => boolean) => sources.filter(({ path, text }) => !allowed.some(prefix => path.startsWith(prefix)) && test(text)).map(({ path }) => path)

describe('B7.4 · the gated files have one reader each', () => {
  it('finds the main sources', () => {
    expect(sources.length).toBeGreaterThan(100)
    expect(sources.some(({ path }) => path === 'services/policy/policy-store.ts')).toBe(true)
  })

  it('parses a policy only in services/policy/ and in the marked writer', () => {
    expect(outside(['services/policy/', 'services/mcp-tool-rules.ts'], text => /\bparsePolicy\(/.test(text))).toEqual([])
  })

  it('reads .oxespace/policy.json only through PolicyStore (and the marked writer)', () => {
    const readsPolicyFile = (text: string) => /policy\.json/.test(text) && /\b(readFile|readFileSync|createReadStream|openSync)\b/.test(text)
    // The file service is the generic, root-checked reader (it names the file in a comment only); nothing it returns is applied.
    expect(outside(['services/policy/', 'services/mcp-tool-rules.ts', 'ipc/policy.ipc.ts', 'services/file-system.service.ts', 'e2e/'], readsPolicyFile)).toEqual([])
  })

  it('reads the oxe.yaml tool modes only through effectiveToolConfig', () => {
    const allowed = ['services/policy/tool-config.ts', 'services/conversation/tool-groups.ts', 'services/repo-config/parser.ts', 'services/repo-config/tool-modes-writer.ts']
    expect(outside(allowed, text => /\bprojectToolModes\(/.test(text))).toEqual([])
    expect(outside(allowed, text => /\.thread\??\.(tools|toolModes)\b/.test(text))).toEqual([])
    expect(outside(allowed, text => /\['?thread'?\]\??\.?\[?'?(tools|toolModes)/.test(text))).toEqual([])
  })

  it('makes every app writer of a gated file refuse while a change is pending and mark its write', () => {
    for (const writer of ['services/mcp-tool-rules.ts', 'services/mcp-tool-groups.ts']) {
      const text = sources.find(({ path }) => path === writer)?.text ?? ''
      expect(text, writer).toMatch(/assertAccepted\(/)
      expect(text, writer).toMatch(/markIntent\(/)
      expect(text, writer).toMatch(/commitIntent\(/)
      expect(text, writer).toMatch(/replaceFile\(/)
      expect(text.indexOf('markIntent('), writer).toBeLessThan(text.indexOf('replaceFile('))
    }
  })

  it('has no other writer of the gated files', () => {
    const writes = (text: string) => /\b(writeFile|writeFileSync|replaceFile|createFile|rename|renameSync)\(/.test(text)
    const namesGated = (text: string) => /\.oxespace\/policy\.json|'\.oxespace', 'policy\.json'|OXE_YAML_FILE/.test(text)
    const allowed = ['services/mcp-tool-rules.ts', 'services/mcp-tool-groups.ts', 'services/policy/', 'services/file-system.service.ts', 'e2e/']
    expect(outside(allowed, text => writes(text) && namesGated(text))).toEqual([])
  })

  it('makes any remote consumer of the approval center filter requests with remoteMayAnswer (review L4)', () => {
    // The phone has no path to center requests today; one that is added must not offer a policyChange (policy.edit).
    const remote = sources.filter(({ path, text }) => /remote/i.test(path) && /approvalCenter|ApprovalCenter|approvals\.(list|onRequested|respond)/.test(text))
    expect(remote.filter(({ text }) => !/remoteMayAnswer\(/.test(text)).map(({ path }) => path)).toEqual([])
    const protocol = readFileSync(join('shared', 'remote', 'protocol.ts'), 'utf8')
    expect(protocol).not.toMatch(/approvals\./)
  })

  it('never offers accepting a change as an MCP tool or a phone command', async () => {
    const { FORBIDDEN_CAPABILITIES, MCP_COVERAGE } = await import('../../shared/mcp-coverage')
    expect(FORBIDDEN_CAPABILITIES).toContain('policy.accept_change')
    expect(MCP_COVERAGE['policy.accept_change']).toMatchObject({ ipc: ['policy.acceptChange', 'policy.reviewChange'] })
    expect('forbidden' in MCP_COVERAGE['policy.accept_change']).toBe(true)
  })
})
