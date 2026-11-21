// Frozen acceptance test for 1.5.2 OxeCode F5 "fidelidade da marca na base" (OXE program oxespace-152-code, phase F5,
// Jira OXE-63, BRD-03, VIS-01/02). Written by the planner; the executor must not edit it. Spec: .oxe/alm/specs/OXE-63.md
// (spec-v1), M1 §2-3 and the primitives of OXE-48 (src/ui/Button.tsx, src/ui/Display.tsx Tabs).
// Today (main 24507378b; #817 baseline run 43619045850): no OxeCode tab bar is the Tabs (the panel stack is a
// hand-made role=tablist of raw buttons, 28 to 38 px); 42-43 raw <button> in the code-workspace scene; Buttons
// restyled to 11px/400 and 24/26 px by CodeChrome.css; src/components/{Workspace,Grid,Panes,Sidebar} hold 83 raw <button.
// Contract (compact, comfortable in brackets; both themes by token; measures in px and weight, never a token's name
// for type, because OXE-137 T18 renames --text-* to --fs-*):
// - tabbar (T24), CA-1: the workspace panel stack ("Open workspace panels": Changes, Browser...) is the src/ui Tabs list
//   ([data-ui=tabs]); each tab is the primitive's trigger: 32 [36] high (--bar-md), label 12 [13] at weight 500, the
//   selected one aria-selected="true" with the 2px --accent underline; choosing a tab still shows its panel. No
//   stylesheet outside src/ui restyles a tab. No hand-made role="tablist" is left in
//   src/components/{Workspace,Grid,Panes,Sidebar} (SOURCE-TEXT, marked). The BRD-03 tab measures are enforced.
// - buttons (T25), CA-2: the workspace bar ("Workspace status") and the collapsed sidebar rail hold only src/ui
//   primitives on the scale: a Button ([data-ui=button]) when it shows text, 24, 28 or 32 [28, 32, 36] by its size
//   (sm, md, lg) with text 12 (sm, md) or 13 (lg) [13, 14]; an IconButton ([data-ui=icon-button], square) when it
//   shows only an icon; nothing outside src/ui (nor an inline style) changes a primitive's height, width, padding,
//   type, radius or --button-h at a specificity that can win. Names, test ids and behaviour stay.
//   CA-3/CA-4 (SOURCE-TEXT, marked: the code is what they count): the raw `<button` in
//   src/components/{Workspace,Grid,Panes,Sidebar}/**/*.tsx fall below main's 83, the rail, the collapse button, the
//   workspace surface and the panel toggle hold none, and the raw-button cap of tests/design-lint.test.ts is lowered
//   to the count the code has, in the same change. The BRD-03 button measures are enforced; the button font target is
//   split by size (brand 14/11, the BRD-04 decision): [data-ui=button]:not([data-size=lg]) at 12 px and
//   [data-ui=button][data-size=lg] at 13 px (compact); the raw-button count is scoped to the OxeCode surface.
// - CA-5 (24x24) follows from the primitives (tests/design-lint-target-size.test.ts); CA-6 (OXE-105) is the CI
//   perf-gate's. The pane header (BRD-14), the panels' own chrome (BRD-15) and the menus (BRD-16) are 1.5.3.
// How it is read: the real WorkspaceSurface (grid and panel bodies mocked) and the real Sidebar over the real stores;
// rules matched as text with Element.matches() (SOURCE-TEXT check, marked: jsdom computes no CSS), CSS-module classes
// mapped, the src/styles.css layers honoured; tokens from tokensCss(). Queries use data-ui, ARIA roles or the active
// catalog's strings (RT-3). Packaged pixels are the CI conformance test's (marca/conformidade).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSurface } from '../../../src/components/Workspace/WorkspaceSurface'
import { Sidebar } from '../../../src/components/Sidebar/Sidebar'
import { __resetGitBranchCacheForTests } from '../../../src/hooks/useGitBranch'
import { useTerminalStore } from '../../../src/store/terminal.store'
import { useUIStore } from '../../../src/store/ui.store'
import { useNavigationPrefs } from '../../../src/store/navigation-prefs.store'
import { i18n } from '../../../src/i18n'
import { tokensCss } from '../../../src/design/tokens/css'
import type { Workspace } from '../../../shared/types/workspace'

// The grid and the panels' bodies are not this card's: mocked as in tests/integration/WorkspaceSurface.test.tsx.
vi.mock('../../../src/components/Grid/WorkspaceGrid', () => ({ WorkspaceGrid: () => <div data-testid="workspace-grid">Grid</div> }))
vi.mock('../../../src/components/Grid/WorkspaceSplitGrid', () => ({ WorkspaceSplitGrid: () => <div data-testid="workspace-grid">SplitGrid</div> }))
vi.mock('../../../src/components/Workspace/WorkspaceReviewPanel', () => ({ WorkspaceReviewPanel: () => <section data-testid="workspace-review-panel">Review body</section> }))
vi.mock('../../../src/components/Workspace/WorkspaceWebPreviewPanel', () => ({ WorkspaceWebPreviewPanel: () => <section data-testid="workspace-web-preview-panel">Browser body</section> }))

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
const DISPLAY = moduleStyles.get('src/ui/Display.module.css')!

function createWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'workspace-1', name: 'repo', rootPath: 'C:/repo', layout: '1x1', layoutPreset: 1, themeId: 'midnight', uiDensity: 'compact', defaultShellProfileId: 'builtin-claude', autoStart: false, isActive: true, color: 3,
    editorVisible: false, editorExpanded: false, editorWidthPercent: 40, reviewPanelVisible: true, reviewPanelExpanded: false, reviewPanelWidthPercent: 36,
    githubPanelVisible: false, githubPanelExpanded: false, githubPanelWidthPercent: 40, githubActiveTab: 'status', backgroundPanelVisible: false, backgroundPanelExpanded: false, backgroundPanelWidthPercent: 28,
    panes: [{ id: 'pane-1', workspaceId: 'workspace-1', type: 'terminal', rowIndex: 0, columnIndex: 0, shellProfileId: 'builtin-claude', status: 'idle', agentProfileId: null, agentName: null, displayName: null, createdAt: null, modelOverride: null, rootPath: null }],
    ...overrides
  } as unknown as Workspace
}
/** The workspace with Changes and Browser open (two side panels, so the panel stack shows its tabs). */
function renderSurface(): void {
  const workspace = createWorkspace()
  render(<WorkspaceSurface workspace={workspace} isActive maximizedPaneId={null} onToggleMaximize={() => undefined} webPreviewVisible integrationVisible={false} searchVisible={false}
    onCloseWebPreview={() => undefined} onCloseIntegration={() => undefined} onCloseSearch={() => undefined} onRunCommand={() => undefined}
    onUpdateEditorState={() => undefined} onUpdateReviewState={() => undefined} onUpdateGitHubState={() => undefined} onUpdateBackgroundState={() => undefined} onUpdateWorktreeState={() => undefined}
    onSelectWorkspace={() => undefined} onSplitPane={() => undefined} workspaces={[workspace]} activePaneId="pane-1"
    agentProfiles={[{ agentProfileId: 'claude', name: 'Claude Code', provider: 'claude' }] as never}
    panels={[{ id: 'changes', active: true, onToggle: () => undefined }, { id: 'browser', active: true, onToggle: () => undefined }, { id: 'git', active: false, onToggle: () => undefined }]} />)
}

beforeEach(() => {
  __resetGitBranchCacheForTests()
  useNavigationPrefs.setState({ width: 280, expanded: {} })
  const base = useTerminalStore.getState().getStatus('none')
  useTerminalStore.setState({ panes: { p2: { ...base, status: 'running', agentState: 'blocked', agentSource: 'hook' } }, pendingCommands: {}, activePaneId: null } as never)
  Object.defineProperty(window, 'oxe', { configurable: true, value: {
    app: { platform: 'win32' }, terminal: { start: vi.fn(), stop: vi.fn(async () => undefined) }, workspace: { closePane: vi.fn(async () => undefined) },
    git: { getBranch: vi.fn(async () => ({ branch: 'main', detached: false, shortSha: null })) }
  } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** Raw `<button` tags per file under src/components/<dir> (SOURCE-TEXT, marked: the code is what CA-3 counts). */
const COMPONENTS = join(ROOT, 'src/components')
const tsxUnder = (path: string): string[] => readdirSync(path).flatMap(name => {
  const full = join(path, name)
  return statSync(full).isDirectory() ? tsxUnder(full) : name.endsWith('.tsx') ? [full] : []
})
const rawIn = (path: string): number => readFileSync(path, 'utf8').match(/<button\b/g)?.length ?? 0
const CODE_DIRS = ['Workspace', 'Grid', 'Panes', 'Sidebar']

describe('OXE-63 · BRD-03 · tabbar', () => {
  it('CA-1 · abas na escala: painéis do workspace', async () => {
    renderSurface()
    const list = await screen.findByRole('tablist', { name: tc('workspace.topbar.openPanels') })
    expect(list, 'the panel stack is the src/ui Tabs list').toHaveAttribute('data-ui', 'tabs')
    const tabs = within(list).getAllByRole('tab')
    const names = tabs.map(tab => tab.getAttribute('aria-label') ?? tab.textContent?.trim() ?? '')
    expect([...names].sort()).toEqual([tc('panels.browser'), tc('panels.changes')].sort())
    expect(tabs.filter(tab => tab.getAttribute('aria-selected') === 'true'), 'one selected tab').toHaveLength(1)
    for (const tab of tabs) {
      const name = tab.getAttribute('aria-label') ?? tab.textContent
      expect(tab.classList.contains(DISPLAY.tab), `${name}: the Tabs trigger`).toBe(true)
      for (const density of ['compact', 'comfortable'] as const) {
        expect(length(tab, 'height', density), `${name} ${density} height`).toBe(density === 'compact' ? 32 : 36)
        expect(length(tab, 'font-size', density), `${name} ${density} label`).toBe(density === 'compact' ? 12 : 13)
      }
      const active = tab.getAttribute('aria-selected') === 'true'
      if (active) expect(px(cascaded(tab, 'font-weight')?.value, DENSITY.compact), `${name}: label weight`).toBe(500)
      expect(outsideOverrides(tab, [...BUTTON_PROPS, 'color', 'background', 'border', 'border-bottom']), `${name}: not restyled outside src/ui`).toEqual([])
    }
    // The selected underline, drawn by a pseudo-element (SOURCE-TEXT, marked): 2px in the accent, a token of both modes.
    const underline = RULES.find(rule => rule.file === 'src/ui/Display.module.css' && rule.selector === `.${DISPLAY.tab}[data-state='active']::after`)
    expect(underline?.decl.height).toBe('2px')
    expect(underline?.decl.background).toBe('var(--accent)')
    bothModes('--accent')
    // Choosing a tab still shows its panel.
    const browser = tabs.find(tab => (tab.getAttribute('aria-label') ?? tab.textContent ?? '').includes(tc('panels.browser')))!
    await userEvent.setup().click(browser)
    await waitFor(() => expect(browser).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByTestId('workspace-web-preview-panel')).toBeVisible()
  })

  it('CA-1 · sem tablist feita à mão no OxeCode', () => {
    const found = CODE_DIRS.flatMap(dir => tsxUnder(join(COMPONENTS, dir)))
      .filter(path => /role=["']tablist["']/.test(readFileSync(path, 'utf8'))).map(path => relative(ROOT, path).split('\\').join('/'))
    expect(found, 'every OxeCode tab bar is the src/ui Tabs').toEqual([])
  })

  it('CA-1 · medidas das abas do BRD-03 em enforced', () => {
    expect(notEnforced(id => /^BRD-03\.tabs?\./.test(id))).toEqual([])
  })
})

describe('OXE-63 · BRD-03 · buttons', () => {
  it('CA-2 · botões na escala: barra do workspace', async () => {
    renderSurface()
    const bar = screen.getByLabelText(tc('workspace.topbar.label'))
    await waitFor(() => expect(within(bar).getAllByRole('button').length, 'the bar keeps its actions').toBeGreaterThanOrEqual(6))
    for (const name of [tc('workspace.topbar.mcp'), tc('workspace.topbar.activity'), tc('panels.more')]) expect(within(bar).getByRole('button', { name }), `"${name}" stays`).toBeInTheDocument()
    expect(within(bar).getByTestId('workspace-topbar-mcp'), 'the e2e hook stays on MCP').toBeInTheDocument()
    expect(buttonReport(bar)).toEqual([])
  })

  it('CA-2 · botões na escala: lateral recolhida', () => {
    const atlas = { ...createWorkspace({ id: 'atlas', name: 'Atlas' } as Partial<Workspace>), panes: [{ ...createWorkspace().panes[0], id: 'p2', workspaceId: 'atlas' }] } as Workspace
    const borealis = createWorkspace({ id: 'borealis', name: 'Borealis', isActive: false, panes: [] } as Partial<Workspace>)
    useUIStore.setState({ collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, code: true } })
    render(<Sidebar workspaces={[atlas, borealis]} activeWorkspaceId="atlas" appVersion="test" isCollapsed onNewWorkspace={vi.fn()} onSelectWorkspace={vi.fn()} onCloseWorkspace={vi.fn()} onToggleCollapse={vi.fn()} />)
    const rail = document.querySelector('aside')!
    const buttons = within(rail).getAllByRole('button')
    const forWorkspace = (name: string): HTMLElement => {
      const found = buttons.filter(button => (button.getAttribute('aria-label') ?? '').startsWith(name))
      expect(found, `one rail button for ${name}`).toHaveLength(1)
      return found[0]
    }
    expect(forWorkspace('Atlas')).toHaveAttribute('aria-current', 'true')
    expect(forWorkspace('Borealis')).not.toHaveAttribute('aria-current')
    expect(forWorkspace('Atlas').getAttribute('aria-label'), 'the rail still says a terminal needs a decision').toBe(tc('sidebar.railNeedsDecision', { name: 'Atlas' }))
    expect(within(rail).getByTestId('btn-new-workspace'), 'the e2e hook stays on New workspace').toBeInTheDocument()
    expect(buttonReport(rail)).toEqual([])
  })

  it('CA-3 · contagem de botões crus cai e a trava desce', () => {
    const files = CODE_DIRS.flatMap(dir => tsxUnder(join(COMPONENTS, dir)))
    expect(files.length, 'the four OxeCode folders hold their components (38 .tsx on main)').toBeGreaterThan(30)
    const total = files.reduce((sum, path) => sum + rawIn(path), 0)
    expect(total, 'raw <button in src/components/{Workspace,Grid,Panes,Sidebar} (83 on main 24507378b)').toBeLessThan(83)
    const none = ['Sidebar/CodeRail.tsx', 'Sidebar/SidebarCollapseButton.tsx', 'Workspace/WorkspaceSurface.tsx', 'Workbench/WorkbenchPanelMenu.tsx']
    expect(none.filter(file => rawIn(join(COMPONENTS, file)) > 0), 'no raw <button left in the rail, the collapse button, the workspace surface and the panel toggle').toEqual([])
    const { total: all, cap } = rawButtonCap()
    expect(cap, `the design-lint raw-button cap is lowered to the count (code has ${all})`).toBeLessThanOrEqual(all)
  })

  it('CA-2 · medidas dos botões do BRD-03 em enforced', () => {
    // BRD-03.button-lg.font-size returned to enforced on the first-run scene after #858 (BRD-12) (OXE-275, coordination 15/11).
    expect(notEnforced(id => /^BRD-03\.(button|button-lg|icon-button)\./.test(id))).toEqual([])
    type Measure = { id: string; select: unknown; prop: string; expect: { token?: string }; state: string }
    const measures = (JSON.parse(readFileSync(join(ROOT, 'src/design/targets/brd-03.json'), 'utf8')) as { measures: Measure[] }).measures
    const fonts = measures.filter(measure => measure.prop === 'font-size' && typeof measure.select === 'string' && /\[data-ui=button\]/.test(measure.select as string))
    const plain = fonts.find(measure => measure.select === '[data-ui=button]:not([data-size=lg])')
    const large = fonts.find(measure => measure.select === '[data-ui=button][data-size=lg]')
    // The size each target names, through the generated tokens whatever their names (OXE-137 T18 renames --text-*).
    expect(px(plain?.expect.token && `var(${plain.expect.token})`, DENSITY.compact), 'sm and md text target').toBe(12)
    expect(px(large?.expect.token && `var(${large.expect.token})`, DENSITY.compact), 'lg text target').toBe(13)
    expect(fonts.filter(measure => measure !== plain && measure !== large).map(measure => measure.id), 'no other button font target').toEqual([])
    expect([plain?.state, large?.state]).toEqual(['enforced', 'enforced'])
    const raw = measures.find(measure => measure.id === 'BRD-03.raw-button.count')
    expect(typeof raw?.select === 'string' && !/^button\b/.test(raw.select) && /button:not\(\[data-ui\]\)/.test(raw.select), `the raw-button count is scoped to the OxeCode surface: ${JSON.stringify(raw?.select)}`).toBe(true)
  })
})
