// Frozen acceptance test for 1.5.2 OxeChat F3 "visual da marca" (OXE program oxespace-152-chat, phase F3, Jira OXE-64,
// BRD-04, VIS-01/02). Written by the planner; the executor must not edit it. Spec: .oxe/alm/specs/OXE-64.md (spec-v1),
// with the BRD-03 button rule (OXE-63) and the primitives of OXE-48 (src/ui/Button.tsx, src/ui/Display.tsx Tabs).
// Today (main 3e25c98fa): the conversation tab bar is a hand-made role=tablist of 36px; src/components/Threads/** holds
// 140 raw <button> tags; buttons are sized by legacy CSS (22, 26, 28, 30 px; 11 to 13 px text).
// Contract (compact, comfortable in brackets; both themes by token):
// - CA-1: every tab bar inside the conversation view (the region "Conversation", i.e. `.thread-view [role=tablist]`) is
//   the src/ui Tabs list ([data-ui=tabs]); each tab is the primitive's trigger: height --bar-md 32 [36] (today 36),
//   label --text-xs 12 [13] at weight 500, the selected one aria-selected="true" with the 2px --accent underline. No
//   stylesheet outside src/ui resizes or restyles a tab.
// - CA-2 (F3 scope, coordination 14/11): the conversation header's buttons are src/ui primitives on the scale: a Button
//   ([data-ui=button]) when it shows text, an IconButton ([data-ui=icon-button], square) when it shows only an icon, or a
//   src/ui control. A Button is 24, 28 or 32 [28, 32, 36] high by its size (sm, md, lg) with text 12 (sm, md) or 13 (lg)
//   [13, 14]; no stylesheet outside src/ui (nor an inline style) changes a primitive's height, width, padding, type,
//   radius or --button-h at a specificity that can win. The other OxeChat surfaces are OXE-152 (1.5.3).
//   The src/ui controls carry data-ui too (brand 14/11, RT-1): Switch "switch", each SegmentedControl option
//   "segmented-option", and ErrorState's retry is a src/ui Button ("button"), no longer a raw <button>.
// - CA-3: src/components/Threads/** has fewer than 140 raw `<button` (the card's criterion; zero is OXE-152), and the
//   raw-button cap of tests/design-lint.test.ts is lowered to the count the code has, in the same change (RT-2). Read as
//   source text: the code is what this criterion counts (marked).
// - BRD-04 targets (OXE-149, src/design/targets/brd-04.json, PR #817): the button and icon-button measures are enforced
//   and in enforced.lock.json; the button font-size target is split in two (brand 14/11): [data-ui=button]:not([data-size=lg])
//   -> --text-xs and [data-ui=button][data-size=lg] -> --text-sm, the same in brd-03.json; the raw-button count is scoped
//   to the OxeChat surface (not the frame's title and status bars, BRD-09) and stays pending until OXE-152.
// - CA-4 (24x24 in both densities) follows: every control is a primitive, and tests/design-lint-target-size.test.ts
//   holds the primitives to 24x24. CA-5 (OXE-105) is the CI perf-gate's.
// How it is read: the real ThreadView over the real thread store; the rules that reach each button are read from
// src/**/*.css as text and matched with Element.matches() (SOURCE-TEXT check, marked: jsdom computes no CSS), CSS-module
// classes mapped to vitest's names, the src/styles.css layers honoured; tokens come from tokensCss(). Queries use
// data-ui, ARIA roles or text (RT-3). Packaged pixels are the CI visual goldens' (re-recorded there).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { ErrorState, SegmentedControl, Switch } from '../../../src/ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadView } from '../../../src/components/Threads/ThreadView'
import { useAccountStore } from '../../../src/store/account.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { tokensCss } from '../../../src/design/tokens/css'
import type { Workspace } from '../../../shared/types/workspace'
import type { ThreadApi, ThreadEvent, ThreadSnapshot } from '../../../shared/types/thread'

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
const TOKEN_RULES = parseCss(tokensCss(), 'tokensCss()')
const tokenBlock = (selector: string): Record<string, string> => Object.assign({}, ...TOKEN_RULES.filter(rule => rule.selector === selector).map(rule => rule.decl))
const DENSITY = { compact: tokenBlock(':root'), comfortable: { ...tokenBlock(':root'), ...tokenBlock(":root[data-density='comfortable']") } } as const
const MODES = { light: tokenBlock("[data-mode='light']"), dark: tokenBlock("[data-mode='dark']") } as const
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

/** Whether a class comes from a src/ui CSS module (the primitives' own). */
const UI_SUFFIXES = [...moduleStyles].filter(([file]) => file.startsWith('src/ui/')).map(([, styles]) => styles.x.slice('_x'.length))
const isUiClass = (name: string): boolean => UI_SUFFIXES.some(suffix => name.startsWith('_') && name.endsWith(suffix))
const BOX = ['height', 'min-height', 'max-height', 'block-size', 'padding', 'padding-top', 'padding-bottom', 'padding-block', 'padding-left', 'padding-right', 'padding-inline',
  'background', 'background-color', 'border', 'border-top', 'border-bottom', 'border-width', 'border-top-width', 'box-shadow', 'border-radius', 'font', 'font-size', 'font-weight', 'line-height', 'color']
/** Rules outside src/ui, unlayered, at a specificity that can win over a primitive's class, that restyle `el`; and inline styles. */
function outsideOverrides(el: Element, props: readonly string[] = BOX): string[] {
  const rules = RULES.filter(rule => !rule.layered && !rule.file.startsWith('src/ui/') && compare(specificity(rule.selector), [0, 1, 0]) >= 0
    && props.some(prop => prop in rule.decl) && matches(el, rule))
  const inline = (el.getAttribute('style') ?? '').split(';').map(part => part.split(':')[0]?.trim()).filter(prop => prop && props.includes(prop))
  return [...rules.map(rule => `${rule.file} ${rule.selector} { ${props.filter(prop => prop in rule.decl).map(prop => `${prop}: ${rule.decl[prop]}`).join('; ')} }`), ...inline.map(prop => `inline style ${prop}`)]
}
const length = (el: Element, prop: string, density: keyof typeof DENSITY): number | undefined => px(cascaded(el, prop)?.value, DENSITY[density])
const bothModes = (token: string): void => { for (const [mode, block] of Object.entries(MODES)) expect(block[token], `${token} is defined in ${mode} mode`).toBeTruthy() }

const DISPLAY = moduleStyles.get('src/ui/Display.module.css')!
const BUTTON_PROPS = ['height', 'min-height', 'max-height', 'block-size', 'width', 'min-width', 'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'padding-block', 'padding-inline',
  'font', 'font-size', 'font-weight', 'line-height', 'border-radius', '--button-h']
/** A length on `el`: its cascaded value, with custom properties the element itself sets resolved through the cascade too. */
function resolved(el: Element, prop: string, density: keyof typeof DENSITY): number | undefined {
  const scope = DENSITY[density]
  const own = (value: string | undefined, depth = 0): string | undefined => depth > 6 || value === undefined ? value
    : value.replace(/var\((--[\w-]+)\)/g, (match, name: string) => name in scope ? match : own(cascaded(el, name)?.value, depth + 1) ?? match)
  return px(own(cascaded(el, prop)?.value), scope)
}
const nameOf = (el: Element): string => el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? ''
const SIZES = { compact: { sm: 24, md: 28, lg: 32 }, comfortable: { sm: 28, md: 32, lg: 36 } } as const
const TEXT = { compact: { sm: 12, md: 12, lg: 13 }, comfortable: { sm: 13, md: 13, lg: 14 } } as const
/** Every button in `root` that is not a primitive, or a primitive off the scale or restyled from outside src/ui. */
function buttonReport(root: Element): string[] {
  return [...root.querySelectorAll('button, [role="button"]')].flatMap(el => {
    const ui = el.getAttribute('data-ui') ?? ''
    const name = nameOf(el)
    if (ui !== 'button' && ui !== 'icon-button') {
      if (![...el.classList].some(isUiClass) && !['sidebar-row', 'sidebar-group'].includes(ui)) return [`raw ${el.tagName.toLowerCase()} "${name}"`]
      return outsideOverrides(el, BUTTON_PROPS).map(line => `"${name}" restyled: ${line}`)
    }
    const out = outsideOverrides(el, BUTTON_PROPS).map(line => `"${name}" restyled: ${line}`)
    const text = el.textContent?.trim() ?? ''
    if (ui === 'button' && !text) out.push(`"${name}" shows no text: an icon-only button is an IconButton`)
    const size = (el.getAttribute('data-size') ?? '') as keyof typeof SIZES.compact
    if (!(size in SIZES.compact)) { out.push(`"${name}" has no size`); return out }
    for (const density of ['compact', 'comfortable'] as const) {
      const height = resolved(el, 'height', density)
      if (height !== SIZES[density][size]) out.push(`"${name}" ${density}: height ${height}, expected ${SIZES[density][size]} (${size})`)
      if (ui === 'icon-button' && resolved(el, 'width', density) !== height) out.push(`"${name}" ${density}: an IconButton is square`)
      if (ui === 'button' && resolved(el, 'font-size', density) !== TEXT[density][size]) out.push(`"${name}" ${density}: text ${resolved(el, 'font-size', density)}, expected ${TEXT[density][size]}`)
    }
    return out
  })
}

function fixture(events: ThreadEvent[] = [], status: ThreadSnapshot['thread']['status'] = 'idle') {
  const snapshot: ThreadSnapshot = { thread: { id: 'thread', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Auth investigation', pinned: false, status, nativeSessionId: null, createdAt: 1, updatedAt: 1 }, events, page: { before: 0, hasMore: true, total: 0 } }
  const api = {
    commands: vi.fn(async () => ({ commands: [{ name: 'compact', description: 'Compact history', source: 'claude' as const }] })), projects: vi.fn(async () => ({ projects: [], unavailable: [] })), list: vi.fn(async () => [snapshot.thread]),
    read: vi.fn(async () => snapshot), history: vi.fn(async () => ({ events: [], before: 0, hasMore: false, total: 0 })),
    models: vi.fn(async () => ({ defaultModel: 'native-model', models: [{ id: 'native-model', label: 'Native model', description: 'A native catalog entry', efforts: ['low', 'high'], defaultEffort: 'low' }] })),
    configure: vi.fn(async () => snapshot), send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), respond: vi.fn(async () => {}), pin: vi.fn(async () => {}), onChanged: vi.fn(() => () => {}),
    toolTabs: vi.fn(async () => [{ tab: 'conversation', count: null }, { tab: 'changes', count: 3 }]), onToolTabsChanged: vi.fn(() => () => {})
  } as unknown as ThreadApi
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api, clipboard: { writeText: vi.fn(async () => true) }, agentAccount: { read: vi.fn(async () => ({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 1 })) } } })
  const workspace = { id: 'ws', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace
  useAccountStore.setState({ scopes: {}, snapshots: {} })
  useWorkspaceStore.setState({ workspaces: [workspace] })
  useThreadStore.setState({ threads: [snapshot.thread], projects: [{ projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }],
    snapshot, selectedId: 'thread', secondaryId: null, snapshotCache: {}, snapshotCacheOrder: [], drafts: {}, errors: {}, hiddenProjects: [] } as never)
  render(<ThreadView workspace={workspace} />)
}

/** Raw `<button` tags in the named OxeChat files (SOURCE-TEXT, marked: the code is what CA-3 counts). */
const THREADS = join(ROOT, 'src/components/Threads')
const rawButtons = (files: readonly string[]): string[] => files.flatMap(file => {
  const text = readFileSync(join(THREADS, file), 'utf8')
  return (text.match(/<button\b/g) ?? []).map(() => file)
})


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

describe('OXE-64 · BRD-04 · tabbar', () => {
  it('CA-1 · abas da conversa em 32', async () => {
    fixture()
    const view = screen.getByRole('region', { name: 'Conversation' })
    const list = await within(view).findByRole('tablist', { name: 'Conversation tabs' })
    await waitFor(() => expect(within(list).getAllByRole('tab')).toHaveLength(2))
    for (const tablist of within(view).getAllByRole('tablist')) expect(tablist, `${tablist.getAttribute('aria-label')} is the src/ui Tabs list`).toHaveAttribute('data-ui', 'tabs')
    const tabs = within(list).getAllByRole('tab')
    expect(tabs.map(tab => tab.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Conversation', 'Changes 3'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    for (const tab of tabs) {
      expect(tab.classList.contains(DISPLAY.tab), `${tab.textContent}: the Tabs trigger`).toBe(true)
      for (const density of ['compact', 'comfortable'] as const) {
        expect(length(tab, 'height', density), `${tab.textContent} ${density} height`).toBe(density === 'compact' ? 32 : 36)
        expect(length(tab, 'font-size', density), `${tab.textContent} ${density} label`).toBe(density === 'compact' ? 12 : 13)
      }
      expect(cascaded(tab, 'font-weight')?.value).toBe('var(--weight-medium)')
      expect(outsideOverrides(tab, [...BUTTON_PROPS, 'color', 'background', 'border', 'border-bottom']), `${tab.textContent}: not restyled outside src/ui`).toEqual([])
    }
    // The selected underline, drawn by a pseudo-element (SOURCE-TEXT, marked): 2px in the accent, a token of both modes.
    const underline = RULES.find(rule => rule.file === 'src/ui/Display.module.css' && rule.selector === `.${DISPLAY.tab}[data-state='active']::after`)
    expect(underline?.decl.height).toBe('2px')
    expect(underline?.decl.background).toBe('var(--accent)')
    bothModes('--accent')
  })

  it('CA-1 · medidas das abas do BRD-04 em enforced', () => {
    expect(notEnforced(id => /^BRD-04\.tabs?\./.test(id))).toEqual([])
  })
})

describe('OXE-64 · BRD-04 · header', () => {
  it('CA-2 · botões na escala: cabeçalho da conversa', async () => {
    fixture([
      { type: 'message', id: 'prompt', role: 'user', text: 'Explain the flow' },
      { type: 'message', id: 'answer', role: 'assistant', text: 'The flow has two steps.' },
      { type: 'completed', status: 'completed' }
    ] as unknown as ThreadEvent[])
    const header = screen.getByRole('heading', { level: 1, name: 'Auth investigation' }).closest('header')!
    expect(within(header).queryAllByRole('button').length).toBeGreaterThan(1)
    expect(buttonReport(header)).toEqual([])
  })

  it('CA-2 · controles de src/ui com data-ui: Switch, SegmentedControl e ErrorState', () => {
    render(<>
      <Switch checked={false} onChange={() => {}} ariaLabel="Auto-accept edits" />
      <SegmentedControl label="Mode" value="plan" onChange={() => {}} options={[{ value: 'plan', label: 'Plan' }, { value: 'agent', label: 'Agent' }]} />
      <ErrorState title="Could not load" onRetry={() => {}} retryLabel="Try again" />
    </>)
    expect(screen.getByRole('switch', { name: 'Auto-accept edits' })).toHaveAttribute('data-ui', 'switch')
    for (const name of ['Plan', 'Agent']) expect(screen.getByRole('radio', { name })).toHaveAttribute('data-ui', 'segmented-option')
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute('data-ui', 'button')
  })

  it('CA-3 · contagem de botões crus abaixo de 140', () => {
    const files = (function list(path: string): string[] {
      return readdirSync(path).flatMap(name => {
        const full = join(path, name)
        return statSync(full).isDirectory() ? list(full) : name.endsWith('.tsx') ? [relative(THREADS, full).split('\\').join('/')] : []
      })
    })(THREADS)
    expect(files.length).toBeGreaterThan(50)
    expect(rawButtons(files).length, 'raw <button> in src/components/Threads/** (140 on main)').toBeLessThan(140)
    // The design-lint ratchet comes down with it (RT-2): its cap is not above what the code has.
    const outside = (function list(path: string): string[] {
      return readdirSync(path).flatMap(name => {
        const full = join(path, name)
        return statSync(full).isDirectory() ? list(full) : name.endsWith('.tsx') ? [full] : []
      })
    })(join(ROOT, 'src')).filter(path => !path.includes(join('src', 'ui')))
    const total = outside.reduce((sum, path) => sum + (readFileSync(path, 'utf8').match(/<button\b/g)?.length ?? 0), 0)
    const cap = Number(/count\(tsx, \/<button\\b\/g\)\)\.toBeLessThanOrEqual\((\d+)\)/.exec(readFileSync(join(ROOT, 'tests/design-lint.test.ts'), 'utf8'))?.[1])
    expect(cap, 'the design-lint raw-button cap').toBeLessThanOrEqual(total)
  })

  it('CA-2 · medidas dos botões do BRD-04 em enforced', () => {
    expect(notEnforced(id => /^BRD-04\.(button|button-lg|icon-button)\./.test(id))).toEqual([])
    type Measure = { id: string; select: unknown; prop: string; expect: { token?: string }; state: string }
    const read = (name: string): Measure[] => (JSON.parse(readFileSync(join(ROOT, 'src/design/targets', name), 'utf8')) as { measures: Measure[] }).measures
    for (const [file, mustEnforce] of [['brd-04.json', true], ['brd-03.json', false]] as const) {
      const fonts = read(file).filter(measure => measure.prop === 'font-size' && typeof measure.select === 'string' && /\[data-ui=button\]/.test(measure.select as string))
      const plain = fonts.find(measure => measure.select === '[data-ui=button]:not([data-size=lg])')
      const large = fonts.find(measure => measure.select === '[data-ui=button][data-size=lg]')
      expect(plain?.expect.token, `${file}: sm and md text`).toBe('--text-xs')
      expect(large?.expect.token, `${file}: lg text`).toBe('--text-sm')
      expect(fonts.filter(measure => measure !== plain && measure !== large).map(measure => measure.id), `${file}: no other button font target`).toEqual([])
      if (mustEnforce) expect([plain?.state, large?.state]).toEqual(['enforced', 'enforced'])
    }
    const raw = read('brd-04.json').find(measure => measure.id === 'BRD-04.raw-button.count')
    expect(typeof raw?.select === 'string' && !/^button\b/.test(raw.select) && /button:not\(\[data-ui\]\)/.test(raw.select), `the raw-button count is scoped to the OxeChat surface: ${JSON.stringify(raw?.select)}`).toBe(true)
  })
})
