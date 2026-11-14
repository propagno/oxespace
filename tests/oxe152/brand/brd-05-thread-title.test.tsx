// Frozen acceptance test for 1.5.2 OxeChat F3 "visual da marca" (OXE program oxespace-152-chat, phase F3, Jira OXE-66,
// BRD-05, VIS-04). Written by the planner; the executor must not edit it. Spec: .oxe/alm/specs/OXE-66.md (spec-v1).
// Today (main 3e25c98fa): the conversation title is 22px, weight 700, in the display face (ThreadHeaderChrome.css), 17px
// in a split and in a narrow container; ThreadMarkdown.css and ThreadView.css still use --fs-2xl (22px).
// Contract (docs/design/brand.md "Scale (1.5.2)": 16 is the view and dialog title, the conversation title included):
// - CA-1: the h1 of the conversation header, in a single view and in both cells of a split (the real ThreadGrid), has
//   font-size var(--text-lg) (16px compact, 17px comfortable), font-weight 600 (var(--weight-semibold)) and a
//   font-family that is var(--font-ui), never var(--font-display), in both densities. No rule that reaches the h1
//   (a split, a narrow container) may set another size. Both themes: these are size and face tokens, the same in light
//   and dark (the test checks they are not mode tokens).
// - Brand answers of 14/11 (where T10 touches): a markdown h1 in a reply is 16 (--text-lg), h2 14 (--text-md), h3 13
//   (--text-sm), all 600 in the interface face (never the display face); the welcome title ("Start your first
//   conversation") is 20 (--text-xl, not +1 in comfortable) in --font-display with the title stretch (--stretch-title, 80%),
//   weight 600, like the Settings page title (BRD-06).
// - CA-2: OxeChat's code (src/components/Threads/**) uses neither a 22px font size nor the --fs-2xl variable, in CSS or
//   in TSX. Out of scope: the rest of the header (BRD-17, OXE-87) and other screens' titles.
// How it is read: jsdom loads no stylesheet, so the rules that reach the h1 are read from src/**/*.css as text and
// matched against the real render with Element.matches() (SOURCE-TEXT check, marked: this is how CSS that jsdom cannot
// compute is read here). CSS-module classes are mapped to the names vitest gives them, the layers of src/styles.css are
// honoured (a layered rule never beats an unlayered one), and token values come from the generator (tokensCss()).
// The h1 is found by role and text (RT-2). The packaged look is the CI visual goldens' (e2e/visual, re-recorded there).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadGrid } from '../../../src/components/Threads/ThreadGrid'
import { ThreadMarkdown } from '../../../src/components/Threads/ThreadMarkdown'
import { ThreadView } from '../../../src/components/Threads/ThreadView'
import { useAccountStore } from '../../../src/store/account.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { tokensCss } from '../../../src/design/tokens/css'
import type { Workspace } from '../../../shared/types/workspace'
import type { ThreadApi, ThreadSnapshot } from '../../../shared/types/thread'

vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'feat/thread', detached: false, shortSha: null, error: null }) }))

// ── Stylesheets as text (SOURCE-TEXT, marked) ───────────────────────────────────────────────────────────────────────
const ROOT = process.cwd()
const MODULES = import.meta.glob('../../../src/**/*.module.css', { eager: true }) as Record<string, { default: Record<string, string> }>
const moduleStyles = new Map(Object.entries(MODULES).map(([key, mod]) => [relative(ROOT, fileURLToPath(new URL(key, import.meta.url))).split('\\').join('/'), mod.default]))
const LAYERED = new Set([...readFileSync(join(ROOT, 'src/styles.css'), 'utf8').matchAll(/@import\s+'\.\/([^']+)'\s+layer\(/g)].map(found => `src/${found[1]}`))
interface Rule { file: string; selector: string; decl: Record<string, string>; layered: boolean; order: number }
let ruleOrder = 0
function parseCss(text: string, file: string): Rule[] {
  const styles = moduleStyles.get(file)
  const rename = (selector: string): string => styles ? selector.split(/(:global\([^)]*\))/).map(part => part.startsWith(':global(') ? part.slice(8, -1)
    : part.replace(/\.(-?[_a-zA-Z][\w-]*)/g, (_, name: string) => `.${styles[name]}`)).join('') : selector
  const out: Rule[] = []
  const stack: string[] = []
  let buffer = ''
  for (const char of text.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (char === '{') { stack.push(buffer.trim()); buffer = '' }
    else if (char === '}') {
      const prelude = stack.pop() ?? ''
      const at = stack.filter(item => item.startsWith('@'))
      if (!prelude.startsWith('@') && !at.some(item => /^@keyframes|forced-colors|prefers-contrast|^@media\s+print/.test(item))) {
        const decl: Record<string, string> = {}
        for (const part of buffer.split(';')) { const colon = part.indexOf(':'); if (colon > 0) decl[part.slice(0, colon).trim()] = part.slice(colon + 1).trim() }
        const layered = LAYERED.has(file) || at.some(item => item.startsWith('@layer'))
        for (const selector of prelude.split(/,(?![^(]*\))/)) out.push({ file, selector: rename(selector.trim()), decl, layered, order: ruleOrder++ })
      }
      buffer = ''
    } else if (char === ';' && (!stack.length || stack[stack.length - 1].startsWith('@'))) buffer = ''
    else buffer += char
  }
  return out
}
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : name.endsWith('.css') ? [relative(ROOT, path).split('\\').join('/')] : []
})
const CSS_FILES = walk(join(ROOT, 'src')).filter(path => !path.endsWith('tokens.generated.css')).sort()
const RULES = CSS_FILES.flatMap(file => parseCss(readFileSync(join(ROOT, file), 'utf8'), file))
type Spec = [number, number, number]
function specificity(selector: string): Spec {
  let [a, b, c] = [0, 0, 0]
  let rest = selector.replace(/::[\w-]+(\([^)]*\))?/g, ' ').replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '')
  rest = rest.replace(/:(?:is|not|has|matches)\(((?:[^()]|\([^()]*\))*)\)/g, (_, inner: string) => {
    const best = inner.split(',').map(specificity).sort(compare).pop() ?? [0, 0, 0]
    a += best[0]; b += best[1]; c += best[2]
    return ' '
  })
  a += (rest.match(/#[\w-]+/g) ?? []).length
  b += (rest.match(/\.[\w-]+/g) ?? []).length + (rest.match(/\[[^\]]*\]/g) ?? []).length + (rest.replace(/\[[^\]]*\]/g, '').match(/:[\w-]+(\([^)]*\))?/g) ?? []).length
  c += (rest.replace(/\[[^\]]*\]/g, ' ').replace(/[.#:][\w-]+(\([^)]*\))?/g, ' ').match(/[a-z][\w-]*/gi) ?? []).length
  return [a, b, c]
}
function compare(x: Spec, y: Spec): number { return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] }
function quickSubject(el: Element, selector: string): boolean {
  const subject = selector.split(/[\s>+~]+/).filter(Boolean).pop() ?? ''
  const classes = (subject.replace(/\([^)]*\)/g, '').match(/\.[\w-]+/g) ?? []).map(name => name.slice(1))
  return classes.every(name => el.classList.contains(name))
}
const matches = (el: Element, rule: Rule): boolean => {
  if (/::/.test(rule.selector) || !quickSubject(el, rule.selector)) return false
  try { return el.matches(rule.selector) } catch { return false }
}
/** The value the cascade gives `prop` on `el` (unlayered over layered, then specificity, then order); undefined when no rule sets it. */
function cascaded(el: Element, prop: string): { value: string; rule: Rule } | undefined {
  const found = RULES.filter(rule => prop in rule.decl && matches(el, rule))
    .sort((x, y) => Number(!x.layered) - Number(!y.layered) || compare(specificity(x.selector), specificity(y.selector)) || x.order - y.order).pop()
  return found ? { value: found.decl[prop].replace(/\s*!important$/, ''), rule: found } : undefined
}
/** An inherited property: the element's own value, else its parent's. */
function inherited(el: Element | null, prop: string): { value: string; rule: Rule } | undefined {
  for (let node = el; node; node = node.parentElement) {
    const own = cascaded(node, prop)
    if (own && own.value !== 'inherit') return own
  }
  return undefined
}
const TOKEN_RULES = parseCss(tokensCss(), 'tokensCss()')
const tokenBlock = (selector: string): Record<string, string> => Object.assign({}, ...TOKEN_RULES.filter(rule => rule.selector === selector).map(rule => rule.decl))
const DENSITY = { compact: tokenBlock(':root'), comfortable: { ...tokenBlock(':root'), ...tokenBlock(":root[data-density='comfortable']") } } as const
const MODE_TOKENS = new Set([...Object.keys(tokenBlock("[data-mode='light']")), ...Object.keys(tokenBlock("[data-mode='dark']"))])
function px(value: string | undefined, scope: Record<string, string>, depth = 0): number | undefined {
  if (value === undefined || depth > 8) return undefined
  const substituted = value.replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, (_, name: string, fallback?: string) => {
    const length = px(scope[name] ?? fallback, scope, depth + 1)
    return length === undefined ? 'NaN' : `${length}px`
  })
  const expression = substituted.replace(/calc\(/g, '(').replace(/(\d*\.?\d+)px/g, '$1').trim()
  if (!/^[\d.\s+\-*/()]+$/.test(expression)) return undefined
  const result = Number(new Function(`return (${expression})`)())
  return Number.isFinite(result) ? result : undefined
}
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function fixture(split: boolean) {
  const thread = (id: string, title: string) => ({ id, workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title, pinned: false, status: 'idle', nativeSessionId: null, createdAt: 1, updatedAt: 1 }) as ThreadSnapshot['thread']
  const primary: ThreadSnapshot = { thread: thread('thread', 'Auth investigation'), events: [] }
  const secondary: ThreadSnapshot = { thread: thread('other', 'Pix refunds'), events: [] }
  const api = {
    commands: vi.fn(async () => ({ commands: [] })), projects: vi.fn(async () => ({ projects: [], unavailable: [] })), list: vi.fn(async () => [primary.thread, secondary.thread]),
    read: vi.fn(async (id: string) => id === 'other' ? secondary : primary), models: vi.fn(async () => ({ defaultModel: 'native-model', models: [] })),
    send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), pin: vi.fn(async () => {}), onChanged: vi.fn(() => () => {})
  } as unknown as ThreadApi
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api, clipboard: { writeText: vi.fn(async () => true) }, agentAccount: { read: vi.fn(async () => ({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 1 })) } } })
  useAccountStore.setState({ scopes: {}, snapshots: {} })
  useWorkspaceStore.setState({ workspaces: [{ id: 'ws', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace] })
  useThreadStore.setState({ threads: [primary.thread, secondary.thread], projects: [{ projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }],
    snapshot: primary, selectedId: 'thread', secondaryId: split ? 'other' : null, activeCell: 'primary', snapshotCache: split ? { other: secondary } : {}, snapshotCacheOrder: split ? ['other'] : [], drafts: {}, errors: {}, hiddenProjects: [] } as never)
}


/**
 * The brand targets of OXE-149 (src/design/targets/*.json, from PR #817, a dependency of this phase): the measures this
 * task delivers are switched to `enforced` and listed in enforced.lock.json, so e2e/brand/brand-conformance.spec.ts
 * (the marca/conformidade status, CI) blocks from then on. Read as data (the files are the product here).
 */
function notEnforced(owns: (id: string) => boolean): string[] {
  const dir = join(ROOT, 'src/design/targets')
  const lock = (JSON.parse(readFileSync(join(dir, 'enforced.lock.json'), 'utf8')) as { enforced: string[] }).enforced
  const measures = readdirSync(dir).filter(name => /^brd-\d+\.json$/.test(name))
    .flatMap(name => (JSON.parse(readFileSync(join(dir, name), 'utf8')) as { measures: Array<{ id: string; state: string }> }).measures)
  const mine = measures.filter(measure => owns(measure.id))
  expect(mine.length, 'the BRD has measures in src/design/targets').toBeGreaterThan(0)
  return mine.flatMap(measure => [...(measure.state === 'enforced' ? [] : [`${measure.id} is ${measure.state}`]), ...(lock.includes(measure.id) ? [] : [`${measure.id} is not in enforced.lock.json`])])
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('OXE-66 · BRD-05 · the conversation title is 16/600 in the interface face', () => {
  it('CA-1 · título 16/600 na fonte de interface', () => {
    for (const split of [false, true]) {
      fixture(split)
      render(<ThreadGrid />)
      const titles = split ? ['Auth investigation', 'Pix refunds'] : ['Auth investigation']
      for (const title of titles) {
        const h1 = screen.getByRole('heading', { level: 1, name: title })
        const where = `${title}${split ? ' (split)' : ''}`
        const size = inherited(h1, 'font-size')
        expect(size?.value, `${where}: font-size is the --text-lg token (from ${size?.rule.file})`).toBe('var(--text-lg)')
        for (const [density, scope] of Object.entries(DENSITY)) {
          expect(px(size?.value, scope), `${where}: ${density} font-size`).toBe(density === 'compact' ? 16 : 17)
        }
        const weight = inherited(h1, 'font-weight')
        expect(weight?.value, `${where}: weight (from ${weight?.rule.file})`).toMatch(/^(600|var\(--weight-semibold\))$/)
        expect(px(weight?.value.replace('var(--weight-semibold)', '600'), DENSITY.compact)).toBe(600)
        const family = inherited(h1, 'font-family') ?? inherited(h1, 'font')
        expect(family?.value, `${where}: the interface face (from ${family?.rule.file})`).toMatch(/^var\(--font-ui\)/)
        expect(family?.value).not.toMatch(/--font-display/)
        // The same in light and dark: size, weight and face are not mode tokens.
        for (const token of ['--text-lg', '--weight-semibold', '--font-ui']) expect(MODE_TOKENS.has(token), `${token} is not a per-mode token`).toBe(false)
      }
      cleanup()
    }
  })

  it('CA-1 · medidas do BRD-05 em enforced', () => {
    expect(notEnforced(id => id.startsWith('BRD-05.'))).toEqual([])
  })

  it('CA-1 · títulos do markdown na escala, na fonte de interface', () => {
    render(<ThreadMarkdown text={'# Plan\n\n## Steps\n\n### Detail\n\nBody.'} />)
    const expected = { 1: ['--text-lg', 16, 17], 2: ['--text-md', 14, 15], 3: ['--text-sm', 13, 14] } as const
    for (const level of [1, 2, 3] as const) {
      const heading = screen.getByRole('heading', { level })
      const [token, compact, comfortable] = expected[level]
      const size = inherited(heading, 'font-size')
      expect(size?.value, `h${level} size (from ${size?.rule.file})`).toBe(`var(${token})`)
      expect(px(size?.value, DENSITY.compact), `h${level} compact`).toBe(compact)
      expect(px(size?.value, DENSITY.comfortable), `h${level} comfortable`).toBe(comfortable)
      expect(inherited(heading, 'font-weight')?.value, `h${level} weight`).toMatch(/^(600|var\(--weight-semibold\))$/)
      const family = inherited(heading, 'font-family') ?? inherited(heading, 'font')
      expect(family?.value, `h${level} face (from ${family?.rule.file})`).toMatch(/^var\(--font-ui\)/)
    }
  })

  it('CA-1 · título de boas-vindas 20/600 na fonte display', () => {
    fixture(false)
    useThreadStore.setState({ snapshot: null, selectedId: null } as never)
    render(<ThreadView workspace={{ id: 'ws', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace} />)
    const title = screen.getByRole('heading', { level: 2, name: 'Start your first conversation' })
    const size = inherited(title, 'font-size')
    expect(size?.value, `welcome size (from ${size?.rule.file})`).toBe('var(--text-xl)')
    for (const scope of Object.values(DENSITY)) expect(px(size?.value, scope)).toBe(20)
    expect(inherited(title, 'font-weight')?.value).toMatch(/^(600|var\(--weight-semibold\))$/)
    expect((inherited(title, 'font-family') ?? inherited(title, 'font'))?.value).toMatch(/^var\(--font-display\)/)
    expect(inherited(title, 'font-stretch')?.value, 'the title stretch').toBe('var(--stretch-title)')
  })

  it('CA-2 · sem 22 px nem --fs-2xl no OxeChat', () => {
    const dir = join(ROOT, 'src/components/Threads')
    const files = (function list(path: string): string[] {
      return readdirSync(path).flatMap(name => {
        const full = join(path, name)
        return statSync(full).isDirectory() ? list(full) : /\.(css|tsx?)$/.test(name) ? [full] : []
      })
    })(dir)
    expect(files.length).toBeGreaterThan(50)
    const found = files.flatMap(file => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).flatMap((text, index) =>
      /font-size\s*:\s*22px|--fs-2xl|fontSize\s*:\s*['"`]?22(px)?\b/.test(text) ? [`${relative(ROOT, file).split('\\').join('/')}:${index + 1} ${text.trim()}`] : []))
    expect(found).toEqual([])
  })
})
