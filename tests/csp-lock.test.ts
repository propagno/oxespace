import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The renderer's Content-Security-Policy, locked. It is injected into index.html at build time by the
 * `inject-prod-csp` plugin in electron.vite.config.ts; loosening it (an inline or eval script, a wider connect-src,
 * forms, plugins) must fail here first and be a reviewed change of this list.
 */
const ROOT = join(__dirname, '..')
const EXPECTED = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  'frame-src http: https: blob:',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'"
]

function injectedDirectives(): string[] {
  const config = readFileSync(join(ROOT, 'electron.vite.config.ts'), 'utf8')
  const plugin = /name: 'inject-prod-csp'[\s\S]*?const csp = \[([\s\S]*?)\]\.join\('; '\)/.exec(config)
  expect(plugin, 'the inject-prod-csp plugin and its directive list').not.toBeNull()
  return [...plugin![1].replace(/^\s*\/\/.*$/gm, '').matchAll(/"([^"]*)"|'([^']*)'/g)].map(match => match[1] ?? match[2])
}

const directive = (list: string[], name: string): string[] => (list.find(entry => entry.split(/\s+/)[0] === name) ?? '').split(/\s+/).slice(1)

describe('renderer CSP', () => {
  it('has exactly the reviewed directives', () => {
    expect(injectedDirectives()).toEqual(EXPECTED)
  })

  it('never allows inline or eval scripts, remote scripts, plugins, forms or a foreign base', () => {
    const list = injectedDirectives()
    expect(directive(list, 'script-src')).toEqual(["'self'"])
    for (const name of ['default-src', 'script-src', 'connect-src', 'worker-src']) {
      for (const loose of ["'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", "'strict-dynamic'", '*', 'http:', 'https:', 'data:']) {
        expect(directive(list, name), `${name} ${loose}`).not.toContain(loose)
      }
    }
    expect(directive(list, 'object-src')).toEqual(["'none'"])
    expect(directive(list, 'form-action')).toEqual(["'none'"])
    expect(directive(list, 'base-uri')).toEqual(["'self'"])
    expect(directive(list, 'frame-src')).not.toContain('file:')
    expect(directive(list, 'frame-src')).not.toContain('data:')
  })

  it('is injected once, into the charset line, and the source page has no policy or inline script of its own', () => {
    const config = readFileSync(join(ROOT, 'electron.vite.config.ts'), 'utf8')
    expect(config).toMatch(/apply: 'build',\s*transformIndexHtml\(html\)/)
    expect(config).toContain(`'<meta charset="UTF-8" />',`)
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
    expect(html).toContain('<meta charset="UTF-8" />')
    expect(html).not.toMatch(/Content-Security-Policy/i)
    expect([...html.matchAll(/<script\b([^>]*)>/g)].map(match => match[1].trim())).toEqual(['type="module" src="/src/main.tsx"'])
    expect(html).not.toMatch(/\son[a-z]+=/i)
  })

  it('the built page carries the same policy, when a build is present', () => {
    const built = join(ROOT, 'out', 'renderer', 'index.html')
    if (!existsSync(built)) return
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(readFileSync(built, 'utf8'))
    expect(meta?.[1].split('; ')).toEqual(EXPECTED)
  })

  it('the main process only edits frame headers of loopback sub-frames, and only frame-ancestors', () => {
    const main = readFileSync(join(ROOT, 'electron', 'main', 'index.ts'), 'utf8')
    const handlers = main.match(/onHeadersReceived\(/g) ?? []
    expect(handlers).toHaveLength(1)
    const body = main.slice(main.indexOf('onHeadersReceived('), main.indexOf('callback({ responseHeaders: next })'))
    expect(body).toContain("details.resourceType !== 'subFrame'")
    expect(body).toContain('!isLoopbackHttpUrl(details.url)')
    expect(body).toContain("startsWith('frame-ancestors')")
  })
})
