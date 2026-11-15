// Frozen acceptance test for 1.5.2 OxeCode F5 "fidelidade da marca na base" (OXE program oxespace-152-code, phase F5,
// Jira OXE-67, BRD-06, VIS-24). Written by the planner; the executor must not edit it. Spec: .oxe/alm/specs/OXE-67.md
// (spec-v1; grooming OXE-67/Q-2: only the pages this card touches, the 17 → 9 sections are OXE-100/BRD-23), M1 §2-3.
// Today (main 24507378b; #817 baseline run 43619045850): the page is 680 px wide and left-aligned in a 1130 page,
// its title Plex 22 (--fs-2xl), the navigation rows 32 to 34 px, and General holds hand-made cards, no
// [data-ui=settings-section] nor [data-ui=setting-row].
// Contract (compact, comfortable in brackets; measures in px and weight, never a token's name for type, because
// OXE-137 T18 renames --text-* to --fs-*):
// - CA-1: the page column (the nearest element holding the page title, under the "Settings" region, that sets a width)
//   is at most 720 px wide and centred (its inline margins auto, or the region centres it); the auto-apply note sits in
//   a column of the same rule. SOURCE-TEXT (marked): jsdom lays nothing out; the 1440x900 measure is CI's
//   (e2e/brand/brand-conformance.spec.ts, BRD-06.content.width).
// - CA-2: the page title (General, and any page drawn by SettingsContent, e.g. Appearance) is the Settings page
//   primitive's title, [data-ui=settings-page-title] (brand 14/11: never selected by heading level), at 20 px in both
//   densities, weight 600, in --font-display with --stretch-title (80%); SettingsCenter.css no longer reads --fs-2xl.
// - CA-3: every button of the "Settings categories" navigation is 28 [32] high (--row-1), as a fixed height.
// - CA-4 (the touched page, General): every option is inside a src/ui SettingRow ([data-ui=setting-row]) and every
//   row inside a SettingsSection ([data-ui=settings-section]) whose title is 14 [15] at weight 600; no control sits
//   outside that mould; the hooks tests and e2e read stay (external-editor-setting, seen-sites-setting,
//   seen-sites-count). General keeps the card: the default SettingsSection is the single mould (brand 14/11); not asserted.
// - The BRD-06 measures of src/design/targets/brd-06.json are enforced and in enforced.lock.json (OXE-149); a selector
//   that does not fit the new screen is fixed in the same change, ids unchanged; the title measures select
//   [data-ui=settings-page-title].
// - CA-5 (24x24) is tests/design-lint-target-size.test.ts's; CA-6 (OXE-105) the CI perf-gate's.
// How it is read: the real SettingsCenter (lazy pages awaited); rules matched as text with Element.matches()
// (SOURCE-TEXT check, marked), CSS-module classes mapped, the src/styles.css layers honoured; tokens from tokensCss().
// Queries use data-ui, ARIA roles or the active catalog's strings (RT-2).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsCenter } from '../../../src/components/Settings/SettingsCenter'
import { i18n } from '../../../src/i18n'
import { tokensCss } from '../../../src/design/tokens/css'
import type { Workspace } from '../../../shared/types/workspace'

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

const ts = (key: string): string => i18n.t(key, { ns: 'settings' }) as string
const workspace = { id: 'ws', name: 'demo', rootPath: '/repo', themeId: 'midnight', uiDensity: 'compact', layoutPreset: 4, defaultShellProfileId: 'sh', panes: [] } as unknown as Workspace
async function openPage(page: 'general' | 'appearance', withTitle = true): Promise<HTMLElement> {
  render(<SettingsCenter initialPage={page} workspaces={[workspace]} shellProfiles={[]} onSave={vi.fn()} onClose={vi.fn()}
    agentProfiles={[]} agentReadiness={[]} isDiscoveringAgents={false} onDiscoverAgents={vi.fn()} onConfigureAgent={vi.fn()} onNewCustomAgent={vi.fn()} />)
  const name = ts(page === 'general' ? 'general.title' : 'center.pages.appearance.label')
  // The pages are a lazy chunk; its first import, on a busy machine, can take longer than findBy's default second.
  const headings = await screen.findAllByRole('heading', { name }, { timeout: 10_000 })
  if (!withTitle) return headings[0]
  // The page title is the Settings page primitive's ([data-ui=settings-page-title], brand 14/11), whatever its level.
  const titles = [...region().querySelectorAll<HTMLElement>('[data-ui="settings-page-title"]')]
  expect(titles, `the ${page} page has one [data-ui=settings-page-title]`).toHaveLength(1)
  expect(titles[0].textContent?.trim(), `the ${page} page title says "${name}"`).toBe(name)
  return titles[0]
}
const region = (): HTMLElement => screen.getByRole('region', { name: ts('center.title') })
afterEach(() => { cleanup(); localStorage.clear() })

/** The nearest element from `el` up to the region (exclusive) that sets a width: the page column. */
function columnOf(el: HTMLElement): HTMLElement | undefined {
  for (let node: HTMLElement | null = el; node && node !== region(); node = node.parentElement) if (cascaded(node, 'max-width') || cascaded(node, 'width')) return node
  return undefined
}
function columnReport(el: HTMLElement, what: string): string[] {
  const column = columnOf(el)
  if (!column) return [`${what}: no column sets a width`]
  const out: string[] = []
  for (const density of ['compact', 'comfortable'] as const) {
    const width = length(column, 'max-width', density) ?? length(column, 'width', density)
    if (width === undefined || width > 720) out.push(`${what} ${density}: column width ${width ?? cascaded(column, 'max-width')?.value ?? cascaded(column, 'width')?.value}, expected at most 720`)
  }
  const margin = cascaded(column, 'margin')?.value.split(/\s+/) ?? []
  const inline = (side: 'left' | 'right'): string | undefined => cascaded(column, `margin-${side}`)?.value ?? cascaded(column, 'margin-inline')?.value ?? (margin.length ? margin[margin.length === 1 ? 0 : side === 'left' ? (margin.length === 4 ? 3 : 1) : 1] : undefined)
  const centredByMargins = inline('left') === 'auto' && inline('right') === 'auto'
  const parent = column.parentElement!
  const centredByParent = ['justify-content', 'justify-items', 'place-items', 'place-content'].some(prop => /\bcenter\b/.test(cascaded(parent, prop)?.value ?? ''))
  if (!centredByMargins && !centredByParent) out.push(`${what}: the column is not centred (margin ${cascaded(column, 'margin')?.value ?? 'unset'})`)
  return out
}

describe('OXE-67 · BRD-06 · Settings', () => {
  it('CA-1 · conteúdo de 720 centrado', async () => {
    const title = await openPage('general')
    const note = within(region()).getByText(ts('center.autoApplyNote'))
    expect([...columnReport(title, 'the page'), ...columnReport(note, 'the auto-apply note')]).toEqual([])
  })

  it('CA-2 · título 20 na display', async () => {
    for (const page of ['general', 'appearance'] as const) {
      const title = await openPage(page)
      for (const density of ['compact', 'comfortable'] as const) expect(resolved(title, 'font-size', density), `${page} title ${density} (font-size: ${cascaded(title, 'font-size')?.value})`).toBe(20)
      expect(px(cascaded(title, 'font-weight')?.value, DENSITY.compact), `${page} title weight`).toBe(600)
      expect(tokenOf(cascaded(title, 'font-family')?.value), `${page} title face`).toBe('--font-display')
      expect(tokenOf(cascaded(title, 'font-stretch')?.value), `${page} title stretch`).toBe('--stretch-title')
      cleanup()
    }
    const css = readFileSync(join(ROOT, 'src/components/Settings/SettingsCenter.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css, 'Settings reads no --fs-2xl (22 px, off the scale)').not.toMatch(/--fs-2xl/)
  })

  it('CA-3 · navegação em 28', async () => {
    await openPage('general', false)
    const nav = screen.getByRole('navigation', { name: ts('center.categories') })
    const buttons = within(nav).getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(10)
    const off = buttons.flatMap(button => (['compact', 'comfortable'] as const).flatMap(density => {
      const height = resolved(button, 'height', density) ?? resolved(button, 'block-size', density)
      return height === (density === 'compact' ? 28 : 32) ? [] : [`${button.textContent?.trim()} ${density}: height ${height ?? `unset (min-height ${cascaded(button, 'min-height')?.value})`}`]
    }))
    expect([...new Set(off)], 'every navigation row is --row-1').toEqual([])
  })

  it('CA-4 · tudo em SettingRow e SettingsSection', async () => {
    const title = await openPage('general')
    const page = columnOf(title) ?? title.parentElement!
    const sections = [...page.querySelectorAll<HTMLElement>('[data-ui="settings-section"]')]
    expect(sections.length, 'General groups its options in SettingsSections').toBeGreaterThanOrEqual(2)
    const rows = [...page.querySelectorAll<HTMLElement>('[data-ui="setting-row"]')]
    expect(rows.length, 'cache, external editor and seen sites are SettingRows').toBeGreaterThanOrEqual(3)
    expect(rows.filter(row => !row.closest('[data-ui="settings-section"]')).map(row => row.textContent?.slice(0, 30)), 'every row is in a section').toEqual([])
    const controls = [...page.querySelectorAll<HTMLElement>('input, select, textarea, button, [role="switch"], [role="radio"], [role="combobox"]')]
    expect(controls.length).toBeGreaterThanOrEqual(3)
    expect(controls.filter(control => !control.closest('[data-ui="setting-row"]')).map(control => control.getAttribute('aria-label') ?? control.id ?? control.textContent?.trim()), 'no option outside the mould').toEqual([])
    for (const section of sections) {
      const heading = within(section).getAllByRole('heading')[0]
      for (const density of ['compact', 'comfortable'] as const) expect(resolved(heading, 'font-size', density), `section title ${density}`).toBe(density === 'compact' ? 14 : 15)
      expect(px(cascaded(heading, 'font-weight')?.value, DENSITY.compact), 'section title weight').toBe(600)
    }
    for (const hook of ['external-editor-setting', 'seen-sites-setting', 'seen-sites-count']) expect(screen.getByTestId(hook).closest('[data-ui="setting-row"]'), `${hook} stays, in a SettingRow`).not.toBeNull()
  })

  it('CA-1 · medidas do BRD-06 em enforced', () => {
    expect(notEnforced(id => id.startsWith('BRD-06.'))).toEqual([])
    type Measure = { id: string; select: unknown }
    const measures = (JSON.parse(readFileSync(join(ROOT, 'src/design/targets/brd-06.json'), 'utf8')) as { measures: Measure[] }).measures
    const titles = measures.filter(measure => measure.id.startsWith('BRD-06.title.'))
    expect(titles.length, 'the title measures').toBeGreaterThan(0)
    expect(titles.filter(measure => String(measure.select).replace(/["']/g, '') !== '[data-ui=settings-page-title]').map(measure => `${measure.id}: ${String(measure.select)}`), 'the title is measured by data-ui, not by heading level').toEqual([])
  })
})
