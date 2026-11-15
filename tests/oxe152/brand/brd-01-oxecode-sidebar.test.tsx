// Frozen acceptance test for 1.5.2 OxeCode F5 "fidelidade da marca na base" (OXE program oxespace-152-code, phase F5,
// Jira OXE-60, BRD-01). Written by the planner; the executor must not edit it. Spec: .oxe/alm/specs/OXE-60.md
// (spec-v1), M1 §2-3 (oxespace-152-brand/.brand-audit/M1-api-e-criterios.md) and the primitives of OXE-48 (src/ui/Sidebar.tsx).
// Today (main 24507378b; #817 baseline run 43619045850): the OxeCode sidebar has no [data-ui=sidebar-*] at all: a
// 42px title bar, a bordered search, a card per workspace (border, fill, colored strip) and two-line terminal rows.
// Contract (compact, comfortable in brackets; both themes by token; measures in px and weight, never a token's name
// for type or text color, because OXE-137 T18 renames --text-*/--border-* to --fs/--tx/--bd):
// - chrome (T22): the aside holds exactly one src/ui SidebarHeader ([data-ui=sidebar-header], 36 [40]) whose title is
//   "Workspaces" and whose actions keep New workspace (data-testid btn-new-workspace), Delegated work and Search
//   ("Files & commands") as src/ui IconButtons, collapse last; one SidebarFilter ([data-ui=sidebar-filter], 28 [32],
//   no border, on --fill-hover) holding the "Filter workspaces" searchbox, which still filters; the section label
//   "Workspaces" is a SidebarSection ([data-ui=sidebar-section], 24 in both densities, the brand's --bar-sm of 14/11);
//   one SidebarFooter ([data-ui=sidebar-footer], 36 [40]) whose buttons are IconButtons, the Panels menu trigger keeping
//   data-testid btn-open-tools and its name (the conformance scene opens its panels through it, #817 962c30ba2). No title in the sidebar
//   names the version ("OXESpace v", VIS-05). Every control of the header, the filter, the sections and the footer is
//   a src/ui primitive, and the raw-button cap of tests/design-lint.test.ts follows the code down (RT-2 of BRD-03).
// - tree (T23): each workspace is a SidebarGroup ([data-ui=sidebar-group], min-height 28 [32], no border, no
//   box-shadow, no fill unless selected) with its name in the title slot and its color mark (data-ws) in the row; no
//   wrapper between a group and the list draws a card (border, fill, shadow) or fixes a height. Each terminal is a
//   SidebarRow ([data-ui=sidebar-row], 28 [32], one line) that leads with a status signal and keeps its state words
//   in its accessible name; one that needs a decision has the row's detail (--attn-fg) and is two lines, 44 [48]; the
//   selected one is aria-current="true" on --fill-selected; SidebarRow says its line count (data-lines="1"|"2"). One
//   selection at a time (brand 14/11): the group of the selected terminal stays neutral (no aria-current, no fill); with
//   no terminal focused, the active workspace's group is the selection (aria-current="true" on --fill-selected). The 1.4 structure stays: every row comes after its own
//   workspace's group and before the next group. Every control of the tree is a primitive. The BRD-01 measures of
//   src/design/targets/brd-01.json are enforced and in enforced.lock.json (OXE-149), the row height split by line count:
//   [data-ui=sidebar-row][data-lines="1"] at --row-1 and [data-lines="2"] at --row-2 (brand 14/11).
// - CA-7 (24x24 in both densities) follows from the primitives (tests/design-lint-target-size.test.ts); CA-8 (OXE-105)
//   is the CI perf-gate's.
// How it is read: the real Sidebar over the real stores; the rules that reach each element are read from src/**/*.css
// as text and matched with Element.matches() (SOURCE-TEXT check, marked: jsdom computes no CSS), CSS-module classes
// mapped to vitest's names, the src/styles.css layers honoured; tokens come from tokensCss(). Queries use data-ui,
// ARIA roles or the active catalog's strings (RT-3). Packaged pixels are the CI conformance test's (marca/conformidade).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../../../src/components/Sidebar/Sidebar'
import { __resetGitBranchCacheForTests } from '../../../src/hooks/useGitBranch'
import { useTerminalStore } from '../../../src/store/terminal.store'
import { useUIStore } from '../../../src/store/ui.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { useNavigationPrefs } from '../../../src/store/navigation-prefs.store'
import { i18n } from '../../../src/i18n'
import { tokensCss } from '../../../src/design/tokens/css'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'

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
/** A length or a unitless number (a weight) through the generated tokens; whatever the tokens are called (OXE-137 renames). */
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
const BUTTON_PROPS = ['height', 'min-height', 'max-height', 'block-size', 'width', 'min-width', 'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'padding-block', 'padding-inline',
  'font', 'font-size', 'font-weight', 'line-height', 'border-radius', '--button-h']
/** Rules outside src/ui, unlayered, at a specificity that can win over a primitive's class, that restyle `el`; and inline styles. */
function outsideOverrides(el: Element, props: readonly string[] = BOX): string[] {
  const rules = RULES.filter(rule => !rule.layered && !rule.file.startsWith('src/ui/') && compare(specificity(rule.selector), [0, 1, 0]) >= 0
    && props.some(prop => prop in rule.decl) && matches(el, rule))
  const inline = (el.getAttribute('style') ?? '').split(';').map(part => part.split(':')[0]?.trim()).filter(prop => prop && props.includes(prop))
  return [...rules.map(rule => `${rule.file} ${rule.selector} { ${props.filter(prop => prop in rule.decl).map(prop => `${prop}: ${rule.decl[prop]}`).join('; ')} }`), ...inline.map(prop => `inline style ${prop}`)]
}
const length = (el: Element, prop: string, density: keyof typeof DENSITY): number | undefined => px(cascaded(el, prop)?.value, DENSITY[density])
/** A length on `el`: its cascaded value, with custom properties the element itself sets resolved through the cascade too. */
function resolved(el: Element, prop: string, density: keyof typeof DENSITY): number | undefined {
  const scope = DENSITY[density]
  const own = (value: string | undefined, depth = 0): string | undefined => depth > 6 || value === undefined ? value
    : value.replace(/var\((--[\w-]+)\)/g, (match, name: string) => name in scope ? match : own(cascaded(el, name)?.value, depth + 1) ?? match)
  return px(own(cascaded(el, prop)?.value), scope)
}
const zero = (value: string | undefined): boolean => value === undefined || /^(0|0px|none|transparent)(\s|$)/.test(value)
const bothModes = (token: string): void => { for (const [mode, block] of Object.entries(MODES)) expect(block[token], `${token} is defined in ${mode} mode`).toBeTruthy() }
const tokenOf = (value: string | undefined): string | undefined => /^var\((--[\w-]+)\)$/.exec(value ?? '')?.[1]
const nameOf = (el: Element): string => el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? ''
const SIZES = { compact: { sm: 24, md: 28, lg: 32 }, comfortable: { sm: 28, md: 32, lg: 36 } } as const
const TEXT = { compact: { sm: 12, md: 12, lg: 13 }, comfortable: { sm: 13, md: 13, lg: 14 } } as const
/** Every button in `root` that is not a primitive, or a primitive off the scale or restyled from outside src/ui. */
function buttonReport(root: Element, allowed: readonly string[] = []): string[] {
  return [...root.querySelectorAll('button, [role="button"]')].flatMap(el => {
    const ui = el.getAttribute('data-ui') ?? ''
    const name = nameOf(el)
    if (ui !== 'button' && ui !== 'icon-button') {
      if (![...el.classList].some(isUiClass) && !['sidebar-row', 'sidebar-group', ...allowed].includes(ui)) return [`raw ${el.tagName.toLowerCase()} "${name}"`]
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

/** Raw `<button` tags outside src/ui, and the cap of tests/design-lint.test.ts (SOURCE-TEXT, marked: the code is what the ratchet counts). */
function rawButtonCap(): { total: number; cap: number } {
  const list = (path: string): string[] => readdirSync(path).flatMap(name => {
    const full = join(path, name)
    return statSync(full).isDirectory() ? list(full) : name.endsWith('.tsx') ? [full] : []
  })
  const total = list(join(ROOT, 'src')).filter(path => !path.includes(join('src', 'ui'))).reduce((sum, path) => sum + (readFileSync(path, 'utf8').match(/<button\b/g)?.length ?? 0), 0)
  const cap = Number(/count\(tsx, \/<button\\b\/g\)\)\.toBeLessThanOrEqual\((\d+)\)/.exec(readFileSync(join(ROOT, 'tests/design-lint.test.ts'), 'utf8'))?.[1])
  return { total, cap }
}

const tc = (key: string, options: Record<string, unknown> = {}): string => i18n.t(key, { ns: 'code', ...options }) as string
const tg = (key: string): string => i18n.t(key, { ns: 'common' }) as string
const SIDEBAR = moduleStyles.get('src/ui/Sidebar.module.css')!

const pane = (id: string, workspaceId: string, columnIndex: number, displayName: string): WorkspacePane => ({
  id, workspaceId, type: 'terminal', rowIndex: 0, columnIndex, shellProfileId: 'builtin-claude', status: 'idle', agentProfileId: null, agentName: null, displayName, createdAt: null, rootPath: null
} as WorkspacePane)
const workspace = (id: string, name: string, panes: WorkspacePane[], color: number | null): Workspace => ({
  id, name, rootPath: `C:/repos/${id}`, layout: '2x2', layoutPreset: 4, themeId: 'dracula', uiDensity: 'compact', defaultShellProfileId: 'builtin-claude', autoStart: false, isActive: id === 'atlas', color, panes
} as unknown as Workspace)
// Atlas is active with two terminals: API server (selected) and Migration (blocked on a decision). Borealis has one.
const WORKSPACES = [workspace('atlas', 'Atlas', [pane('p1', 'atlas', 0, 'API server'), pane('p2', 'atlas', 1, 'Migration')], 3), workspace('borealis', 'Borealis', [pane('p3', 'borealis', 0, 'Test runner')], null)]
const actions = { onNewWorkspace: vi.fn(), onDelegations: vi.fn(), onOpenSearch: vi.fn(), onSelectWorkspace: vi.fn(), onCloseWorkspace: vi.fn(), onToggleCollapse: vi.fn() }

beforeEach(() => {
  __resetGitBranchCacheForTests()
  useNavigationPrefs.setState({ width: 280, expanded: { atlas: true, borealis: true } })
  const base = useTerminalStore.getState().getStatus('none')
  useTerminalStore.setState({ panes: {
    p1: { ...base, status: 'running', lastActivityAt: Date.now() - 60_000 },
    p2: { ...base, status: 'running', agentState: 'blocked', agentSource: 'hook', lastActivityAt: Date.now() - 30_000 },
    p3: { ...base, status: 'running', lastActivityAt: Date.now() - 90_000 }
  }, pendingCommands: {}, activePaneId: 'p1' } as never)
  useUIStore.setState({ activePaneId: 'p1', collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, code: false } })
  Object.defineProperty(window, 'oxe', { configurable: true, value: {
    app: { platform: 'win32' }, terminal: { start: vi.fn(), stop: vi.fn(async () => undefined) }, workspace: { closePane: vi.fn(async () => undefined) },
    git: { getBranch: vi.fn(async () => ({ branch: 'main', detached: false, shortSha: null })) }
  } })
  for (const action of Object.values(actions)) action.mockClear()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function renderSidebar(): void {
  render(<Sidebar workspaces={WORKSPACES} activeWorkspaceId="atlas" appVersion="OXESpace v1.5.2" isCollapsed={false}
    panelMenu={[{ label: 'Changes', onSelect: () => undefined }] as never} {...actions} />)
}
const aside = (): HTMLElement => document.querySelector('aside')!
const all = (selector: string, root: ParentNode = aside()): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(selector)]
const one = (ui: string): HTMLElement => {
  const found = all(`[data-ui="${ui}"]`)
  expect(found, `exactly one [data-ui=${ui}] in the sidebar`).toHaveLength(1)
  return found[0]
}
const rowOf = (title: string): HTMLElement => {
  const found = all('[data-ui="sidebar-row"]').filter(row => row.textContent?.includes(title))
  expect(found, `one sidebar-row for "${title}"`).toHaveLength(1)
  return found[0]
}
const groupOf = (name: string): HTMLElement => {
  const found = all('[data-ui="sidebar-group"]').filter(group => group.textContent?.includes(name))
  expect(found, `one sidebar-group for "${name}"`).toHaveLength(1)
  return found[0]
}
const sectionLabel = (text: string): HTMLElement | undefined => all('[data-ui="sidebar-section"]').find(section => section.textContent?.trim().startsWith(text))
const before = (a: Node, b: Node): boolean => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
const workspaceList = (): HTMLElement => within(aside()).getByRole('navigation', { name: tc('sidebar.workspaces') })
/** What a wrapper between `el` and the list paints or fixes: a card (border, fill, shadow), a guide line, a height. */
function wrapperReport(el: HTMLElement, stop: HTMLElement): string[] {
  const out: string[] = []
  for (let node = el.parentElement; node && node !== stop && node !== aside(); node = node.parentElement) {
    for (const prop of ['border', 'border-width', 'border-top', 'border-bottom', 'border-left', 'border-right', 'background', 'background-color', 'box-shadow']) {
      const value = cascaded(node, prop)
      if (value && !zero(value.value)) out.push(`wrapper of "${el.textContent?.trim().slice(0, 24)}": ${value.rule.file} ${value.rule.selector} { ${prop}: ${value.value} }`)
    }
    for (const prop of ['height', 'min-height']) {
      const value = cascaded(node, prop)
      if (value && !/^(0|0px|auto|none|100%|inherit|initial|fit-content|min-content|max-content)$/.test(value.value)) out.push(`wrapper of "${el.textContent?.trim().slice(0, 24)}": ${value.rule.file} ${value.rule.selector} { ${prop}: ${value.value} }`)
    }
  }
  return out
}

describe('OXE-60 · BRD-01 · chrome: header, filter, sections and footer', () => {
  it('CA-1 · cabeçalho e rodapé da lateral', () => {
    renderSidebar()
    const header = one('sidebar-header'), footer = one('sidebar-footer')
    expect(header.textContent?.trim().startsWith(tc('sidebar.workspaces')), `the header's title is "${tc('sidebar.workspaces')}"`).toBe(true)
    for (const density of ['compact', 'comfortable'] as const) {
      expect(length(header, 'height', density), `header ${density}`).toBe(density === 'compact' ? 36 : 40)
      expect(length(footer, 'height', density), `footer ${density}`).toBe(density === 'compact' ? 36 : 40)
    }
    expect([...outsideOverrides(header), ...outsideOverrides(footer)], 'nothing outside src/ui restyles the header or the footer').toEqual([])
    const buttons = within(footer).getAllByRole('button')
    expect(buttons.length, 'the footer keeps its actions').toBeGreaterThan(0)
    expect(buttons.filter(button => button.getAttribute('data-ui') !== 'icon-button').map(nameOf), 'the footer holds IconButtons only').toEqual([])
    // The conformance scene opens Changes and Browser through btn-open-tools › Panels (#817, 962c30ba2): the hook and its name stay.
    expect(within(footer).getByTestId('btn-open-tools'), 'the Panels menu trigger keeps its e2e hook and name').toHaveAttribute('aria-label', tc('sidebar.openPanels'))
    expect(buttonReport(footer)).toEqual([])
  })

  it('CA-2 · filtro na escala', async () => {
    renderSidebar()
    const filter = one('sidebar-filter')
    const box = within(filter).getByRole('searchbox', { name: tc('sidebar.filter') })
    for (const density of ['compact', 'comfortable'] as const) expect(length(filter, 'height', density), `filter ${density}`).toBe(density === 'compact' ? 28 : 32)
    expect(tokenOf(cascaded(filter, 'background')?.value), 'the filter is filled with --fill-hover').toBe('--fill-hover')
    for (const prop of ['border', 'border-top', 'border-top-width', 'border-width']) expect(zero(cascaded(filter, prop)?.value), `filter ${prop}`).toBe(true)
    bothModes('--fill-hover')
    expect([...outsideOverrides(filter), ...outsideOverrides(box, ['height', 'padding', 'border', 'background', 'font-size'])], 'nothing outside src/ui restyles the filter').toEqual([])
    fireEvent.change(box, { target: { value: 'Borealis' } })
    await waitFor(() => expect(workspaceList().textContent, 'the filter still filters').not.toContain('Atlas'))
    expect(workspaceList().textContent).toContain('Borealis')
  })

  it('CA-1 · rótulo de seção em 24', () => {
    renderSidebar()
    const section = sectionLabel(tc('sidebar.workspaces'))
    expect(section, `"${tc('sidebar.workspaces')}" is a SidebarSection`).toBeTruthy()
    for (const density of ['compact', 'comfortable'] as const) expect(length(section!, 'height', density), `section ${density}`).toBe(24)
    const label = section!.querySelector(`.${SIDEBAR.sectionLabel}`)
    expect(label, 'the SidebarSection label').not.toBeNull()
    for (const density of ['compact', 'comfortable'] as const) expect(resolved(label!, 'font-size', density), `section label ${density}`).toBe(density === 'compact' ? 11 : 12)
    expect(px(cascaded(label!, 'font-weight')?.value, DENSITY.compact), 'section label weight').toBe(500)
    expect(outsideOverrides(section!), 'nothing outside src/ui restyles the section').toEqual([])
    const toggle = within(section!).getByRole('button', { name: tc('sidebar.toggleAll') })
    expect(toggle, 'the section action is an IconButton').toHaveAttribute('data-ui', 'icon-button')
  })

  it('CA-5 · New workspace, Delegated work e Search no cabeçalho', () => {
    renderSidebar()
    const header = one('sidebar-header')
    const named = (name: string): HTMLElement => {
      const button = within(header).getByRole('button', { name })
      expect(button, `"${name}" is an IconButton`).toHaveAttribute('data-ui', 'icon-button')
      return button
    }
    const create = named(tc('sidebar.newWorkspace')), delegated = named(tc('background.delegated')), search = named(tc('sidebar.searchLabel'))
    expect(within(header).getByTestId('btn-new-workspace'), 'the e2e hook stays on New workspace').toBe(create)
    fireEvent.click(create); fireEvent.click(delegated); fireEvent.click(search)
    expect(actions.onNewWorkspace).toHaveBeenCalledTimes(1)
    expect(actions.onDelegations).toHaveBeenCalledTimes(1)
    expect(actions.onOpenSearch).toHaveBeenCalledTimes(1)
    const buttons = within(header).getAllByRole('button')
    const collapse = named(tg('nav.collapseSidebarShortcut'))
    expect(buttons[buttons.length - 1], 'collapse comes last').toBe(collapse)
    expect(buttonReport(header)).toEqual([])
  })

  it('CA-6 · sem versão em title', () => {
    // A guard (green on main): the version left the sidebar's titles in 1.4 and must not come back with the anatomy.
    renderSidebar()
    const titles = [aside(), ...all('[title]')].map(el => el.getAttribute('title') ?? '')
    expect(titles.filter(title => /OXESpace v/i.test(title))).toEqual([])
  })

  it('RT-1 · cabeçalho, filtro, seções e rodapé só com primitivos', () => {
    renderSidebar()
    const parts = ['sidebar-header', 'sidebar-filter', 'sidebar-section', 'sidebar-footer'].flatMap(ui => all(`[data-ui="${ui}"]`))
    expect(parts.length, 'header, filter, a section and footer').toBeGreaterThanOrEqual(4)
    expect(parts.flatMap(part => buttonReport(part))).toEqual([])
    const { total, cap } = rawButtonCap()
    expect(cap, `the design-lint raw-button cap follows the code down (code has ${total})`).toBeLessThanOrEqual(total)
  })
})

describe('OXE-60 · BRD-01 · tree: workspaces and terminals', () => {
  it('CA-3 · workspace como sidebar-group', () => {
    renderSidebar()
    const list = workspaceList()
    for (const name of ['Atlas', 'Borealis']) {
      const group = groupOf(name)
      for (const density of ['compact', 'comfortable'] as const) expect(length(group, 'min-height', density), `group ${name} ${density}`).toBe(density === 'compact' ? 28 : 32)
      for (const prop of ['border', 'border-top', 'border-bottom', 'border-width', 'box-shadow']) expect(zero(cascaded(group, prop)?.value), `group ${name} ${prop}`).toBe(true)
      expect(group.querySelector(`.${SIDEBAR.rowTitle}`)?.textContent, `${name} is in the group's title`).toContain(name)
      expect(group.matches('[data-ws]') || group.querySelector('[data-ws]') !== null, `${name}: the workspace color mark is in the row`).toBe(true)
      expect([...outsideOverrides(group), ...wrapperReport(group, list)], `${name}: no card, nothing outside src/ui restyles the group`).toEqual([])
    }
    const idle = groupOf('Borealis')
    expect(idle).not.toHaveAttribute('aria-current')
    for (const prop of ['background', 'background-color']) expect(zero(cascaded(idle, prop)?.value), `a group that is not selected has no fill (${prop})`).toBe(true)
    // One selection at a time (brand 14/11): while one of its terminals is selected, the workspace's group stays neutral.
    const parent = groupOf('Atlas')
    expect(parent, 'Atlas holds the selected terminal: its group is not selected too').not.toHaveAttribute('aria-current')
    for (const prop of ['background', 'background-color']) expect(zero(cascaded(parent, prop)?.value), `the group of the selected terminal has no fill (${prop})`).toBe(true)
    // With no terminal focused, the active workspace's group is the selection.
    cleanup()
    useUIStore.setState({ activePaneId: null })
    renderSidebar()
    const selected = groupOf('Atlas')
    expect(selected, 'no terminal focused: the active workspace group is selected').toHaveAttribute('aria-current', 'true')
    expect(tokenOf(cascaded(selected, 'background')?.value), 'the selected group fill').toBe('--fill-selected')
    expect(all('[data-ui="sidebar-row"][aria-current]'), 'no terminal row is selected then').toEqual([])
  })

  it('CA-4 · terminal como sidebar-row', async () => {
    const activate = vi.spyOn(useWorkspaceStore.getState(), 'setActiveWorkspace').mockResolvedValue(undefined)
    renderSidebar()
    const list = workspaceList()
    const selected = rowOf('API server'), blocked = rowOf('Migration'), other = rowOf('Test runner')
    expect(selected).toHaveAttribute('aria-current', 'true')
    for (const row of [blocked, other]) expect(row).not.toHaveAttribute('aria-current')
    expect(tokenOf(cascaded(selected, 'background')?.value), 'selected fill').toBe('--fill-selected')
    bothModes('--fill-selected')
    for (const [title, row] of [['API server', selected], ['Test runner', other]] as const) {
      expect(row, `${title}: SidebarRow says it is one line`).toHaveAttribute('data-lines', '1')
      expect(row.querySelector(`.${SIDEBAR.detail}`), `${title}: one line, no detail`).toBeNull()
      expect(row.classList.contains(SIDEBAR.twoLine), `${title}: not a two-line row`).toBe(false)
      for (const density of ['compact', 'comfortable'] as const) expect(length(row, 'min-height', density), `${title} ${density}`).toBe(density === 'compact' ? 28 : 32)
    }
    const detail = blocked.querySelector(`.${SIDEBAR.detail}`)
    expect(detail, 'the terminal that needs a decision has the SidebarRow detail').not.toBeNull()
    expect(detail!.textContent?.trim().length, 'the detail says what is asked').toBeGreaterThan(0)
    expect(blocked.classList.contains(SIDEBAR.twoLine)).toBe(true)
    expect(blocked, 'SidebarRow says it is two lines').toHaveAttribute('data-lines', '2')
    for (const density of ['compact', 'comfortable'] as const) expect(length(blocked, 'min-height', density), `two-line row ${density}`).toBe(density === 'compact' ? 44 : 48)
    expect(tokenOf(cascaded(detail!, 'color')?.value), 'detail color').toBe('--attn-fg')
    bothModes('--attn-fg')
    const SIGNAL = `.${SIDEBAR.lead} [data-ui="status-signal"], .${SIDEBAR.lead} [data-status-dot], .${SIDEBAR.lead} [data-status]`
    for (const [title, row] of [['API server', selected], ['Migration', blocked], ['Test runner', other]] as const) expect(row.querySelector(SIGNAL), `${title}: a status signal leads the row`).not.toBeNull()
    expect(blocked.querySelector(`.${SIDEBAR.lead} [data-state="needs-you"], .${SIDEBAR.lead} [data-status-dot="attention"], .${SIDEBAR.lead} [data-status="attention"]`), 'the needs-you signal').not.toBeNull()
    const tone = tc('sidebar.session.tone.needs-decision')
    expect(within(list).getAllByRole('button', { name: name => name.includes('Migration') && name.includes(tone) }), `the row's accessible name says "${tone}"`).toContain(blocked)
    for (const row of [selected, blocked, other]) expect([...outsideOverrides(row), ...wrapperReport(row, list)], `${row.textContent?.slice(0, 20)}: nothing outside src/ui restyles the row, no guide line`).toEqual([])
    fireEvent.click(other)
    await waitFor(() => expect(useUIStore.getState().activePaneId, 'choosing a row still opens its terminal').toBe('p3'))
    expect(activate).toHaveBeenCalledWith('borealis')
  })

  it('CA-5 · estrutura da 1.4 mantida', () => {
    renderSidebar()
    const section = sectionLabel(tc('sidebar.workspaces'))
    expect(section, 'the Workspaces section').toBeTruthy()
    const order = [one('sidebar-header'), one('sidebar-filter'), section!, groupOf('Atlas'), rowOf('API server'), rowOf('Migration'), groupOf('Borealis'), rowOf('Test runner'), one('sidebar-footer')]
    for (let index = 1; index < order.length; index++) expect(before(order[index - 1], order[index]), `item ${index - 1} comes before item ${index}`).toBe(true)
  })

  it('RT-1 · cada controle da árvore é um primitivo', () => {
    renderSidebar()
    const list = workspaceList()
    expect(all('[data-ui="sidebar-group"]', list)).toHaveLength(2)
    expect(all('[data-ui="sidebar-row"]', list)).toHaveLength(3)
    expect(buttonReport(list), 'groups and rows are primitives, their actions IconButtons').toEqual([])
    const { total, cap } = rawButtonCap()
    expect(cap, `the design-lint raw-button cap follows the code down (code has ${total})`).toBeLessThanOrEqual(total)
  })

  it('CA-1 · medidas do BRD-01 em enforced', () => {
    expect(notEnforced(id => id.startsWith('BRD-01.'))).toEqual([])
    // Row height by line count (brand 14/11): [data-lines=1] at --row-1, [data-lines=2] at --row-2, no other row target.
    type Measure = { id: string; select: unknown; prop: string; expect: { token?: string } }
    const measures = (JSON.parse(readFileSync(join(ROOT, 'src/design/targets/brd-01.json'), 'utf8')) as { measures: Measure[] }).measures
    const rows = measures.filter(measure => measure.prop === 'height' && typeof measure.select === 'string' && measure.select.includes('[data-ui=sidebar-row]'))
    const bare = (select: unknown): string => String(select).replace(/["']/g, '')
    const one = rows.find(measure => bare(measure.select) === '[data-ui=sidebar-row][data-lines=1]')
    const two = rows.find(measure => bare(measure.select) === '[data-ui=sidebar-row][data-lines=2]')
    for (const density of ['compact', 'comfortable'] as const) {
      expect(px(one?.expect.token && `var(${one.expect.token})`, DENSITY[density]), `one-line rows ${density}`).toBe(density === 'compact' ? 28 : 32)
      expect(px(two?.expect.token && `var(${two.expect.token})`, DENSITY[density]), `two-line rows ${density}`).toBe(density === 'compact' ? 44 : 48)
    }
    expect(rows.filter(measure => measure !== one && measure !== two).map(measure => measure.id), 'no other row height target').toEqual([])
  })
})
