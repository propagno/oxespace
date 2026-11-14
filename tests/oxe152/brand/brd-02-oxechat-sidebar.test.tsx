// Frozen acceptance test for 1.5.2 OxeChat F3 "visual da marca" (OXE program oxespace-152-chat, phase F3, Jira OXE-61,
// BRD-02). Written by the planner; the executor must not edit it. Spec: .oxe/alm/specs/OXE-61.md (spec-v1), with the
// BRD-01 anatomy of OXE-60 (rules 1 to 4) and the primitives of OXE-48 (src/ui/Sidebar.tsx, docs/design/brand.md Scale).
// Today (main 3e25c98fa) the OxeChat sidebar is hand-made: no [data-ui=sidebar-*] at all, two-line rows of 40px,
// a "Archived · N / N conversations" strip, and a collapsed rail of one letter per conversation.
// Contract (measures are compact, comfortable in brackets; both themes by token):
// - CA-1: the aside holds exactly one src/ui SidebarHeader ([data-ui=sidebar-header], height --bar-lg 36 [40], title
//   "Conversations") and one SidebarFooter ([data-ui=sidebar-footer], --bar-lg); the filter is the SidebarFilter
//   ([data-ui=sidebar-filter], --control-md 28 [32], background --fill-hover, no border) holding the "Filter
//   conversations" searchbox; each project is a SidebarGroup ([data-ui=sidebar-group], min-height --row-1 28 [32],
//   no border, no box-shadow, no background unless selected) with its name in the title; each conversation a SidebarRow
//   ([data-ui=sidebar-row], --row-1) and the selected one aria-current="true" on --fill-selected. No stylesheet outside
//   src/ui restyles these primitives (size, padding, color, border, background, radius, type) at a specificity that can
//   win, and no wrapper between a row and the list gives it a fixed height.
// - CA-2: a conversation that does not need the person is one line: no detail, no second line, the title slot holds the
//   title only. Provider and state words leave the row (coordination 14/11) and go to its accessible name and tooltip:
//   the row's accessible name still carries the state (no accessibility regression), its title the provider and state.
// - CA-3: a conversation that needs the person (status approval) has the SidebarRow detail (11, --attn-fg) with words,
//   a two-line row of --row-2 44 [48] (src/ui/Sidebar.module.css .twoLine gets min-height var(--row-2)), and a status
//   signal in its lead ([data-status="attention"] or a src/ui StatusDot [data-status-dot="attention"]) drawn in the sun
//   ochre --attn, never the warning orange (brand 14/11; the src/ui StatusDot "attention" moves from --intent-warning-solid
//   to --attn, the #804 StatusSignal rule). Every row leads with a status signal.
// - CA-4: no "Archived ·" and no "N conversation(s)" text in the sidebar, in en and pt-BR; "Archived" is an entry of the
//   menu of the Projects section label (a SidebarSection with an action), and choosing it shows the archived
//   conversations (region "Archived conversations").
// - CA-5: collapsed (Ctrl+B), the rail shows one button per project, named by the project first, with a status signal
//   of that project's conversations (attention over failed over running over the rest) and no visible letter; the
//   project of the selected conversation is aria-current="true". Choosing a project opens a menu of its conversations
//   and choosing one selects it (T61: the collapsed rail still lists the conversations and opens one).
// - Section labels (Pinned, Projects) are the src/ui SidebarSection at --bar-sm, 24 in both densities (brand 14/11: the
//   primitive moves from --control-sm to --bar-sm).
// - CA-6: the 1.4 structure stays: Conversations (with "Add project" in the header) → Pinned → Projects → each project →
//   its sections → its conversations.
// - CA-7: every control of the sidebar, expanded or collapsed, is a src/ui primitive, so the 24x24 floor of
//   tests/design-lint-target-size.test.ts covers it in both densities.
// The OxeChat cold-sidebar tests (tests/oxe152/chat/oxe-58-*) keep their hooks: the aside's data-list-source and
// aria-busy, [data-testid=thread-sidebar-skeleton], and the legacy hook classes they read.
// How it is read: the real ThreadSidebar over the real thread store; the rules that reach each element are read from
// src/**/*.css as text and matched with Element.matches() (SOURCE-TEXT check, marked: jsdom computes no CSS), with
// CSS-module classes mapped to vitest's names and the src/styles.css layers honoured; tokens come from tokensCss().
// Queries use data-ui, ARIA roles or text (RT-2). Packaged pixels are the CI visual goldens' (re-recorded there).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThreadSidebar } from '../../../src/components/Threads/ThreadSidebar'
import { resetSectionsForTests } from '../../../src/components/Threads/sections/sectionsApi'
import { useThreadStore } from '../../../src/store/thread.store'
import { useUIStore } from '../../../src/store/ui.store'
import { changeLanguage } from '../../../src/i18n'
import { StatusDot } from '../../../src/ui'
import { tokensCss } from '../../../src/design/tokens/css'
import type { ConversationThread, ThreadApi, ThreadProjectSummary } from '../../../shared/types/thread'

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
const SIDEBAR = moduleStyles.get('src/ui/Sidebar.module.css')!
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
const zero = (value: string | undefined): boolean => value === undefined || /^(0|0px|none|transparent)(\s|$)/.test(value)
const bothModes = (token: string): void => { for (const [mode, block] of Object.entries(MODES)) expect(block[token], `${token} is defined in ${mode} mode`).toBeTruthy() }
const tokenOf = (value: string | undefined): string | undefined => /^var\((--[\w-]+)\)$/.exec(value ?? '')?.[1]

const SECRET = 'C:/repos'
const project = (projectId: string, displayName: string): ThreadProjectSummary => ({ projectId, displayName, identityLabel: `${SECRET}/${projectId}`, hidden: false, contexts: [{ rootPath: `${SECRET}/${projectId}`, label: displayName }] })
const conversation = (id: string, title: string, projectId: string, extra: Partial<ConversationThread> = {}): ConversationThread => ({
  id, workspaceId: `ws-${projectId}`, projectId, rootPath: `${SECRET}/${projectId}`, provider: 'claude', title, pinned: false, status: 'idle', nativeSessionId: null, createdAt: 100, updatedAt: Date.now() - 60_000, ...extra
} as ConversationThread)
const THREADS = [
  conversation('a', 'Fix the login bug', 'p1', { lastTurnStatus: 'completed', createdAt: 50 }),
  conversation('b', 'Run the migration', 'p1', { status: 'approval', createdAt: 40 }),
  conversation('c', 'Tune the query', 'p2', { status: 'running', createdAt: 30 }),
  conversation('d', 'Weekly audit', 'p1', { pinned: true, createdAt: 20 }),
  conversation('e', 'Old spike', 'p1', { archived: true, createdAt: 10 } as Partial<ConversationThread>)
]
let api: Record<string, ReturnType<typeof vi.fn>>
function fixture() {
  api = {
    list: vi.fn(async () => THREADS), projects: vi.fn(async () => ({ projects: [project('p1', 'Atlas'), project('p2', 'Borealis')], unavailable: [] })),
    read: vi.fn(async (id: string) => ({ thread: THREADS.find(item => item.id === id)!, events: [] })), command: vi.fn(async () => undefined), onChanged: vi.fn(() => () => {}),
    sections: vi.fn(async (workspaceId: string) => workspaceId === 'thread:p1' ? { sections: [{ id: 'rev', name: 'Reviews', order: 0, collapsed: false }], assignments: { a: 'rev' } } : { sections: [], assignments: {} }),
    saveSections: vi.fn(async (_workspaceId: string, state: unknown) => ({ ok: true, state }))
  }
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api as unknown as ThreadApi } })
  useThreadStore.setState({ threads: THREADS, projects: [project('p1', 'Atlas'), project('p2', 'Borealis')], unavailableProjects: [], loading: false, listLoaded: true, selectedId: 'a', secondaryId: null,
    snapshot: null, snapshotCache: {}, snapshotCacheOrder: [], errors: {}, hiddenProjects: [], expanded: {}, unreadIds: [] } as never)
  useUIStore.setState({ collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, thread: false } })
}
const aside = (): HTMLElement => screen.getByRole('complementary', { name: /^(OxeChat sidebar|Barra lateral do OxeChat)$/ })
const all = (selector: string, root: ParentNode = aside()): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(selector)]
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
async function renderSidebar() {
  render(<ThreadSidebar onCreate={vi.fn()} onAccounts={vi.fn()} onAddProject={vi.fn()} onOpenInCode={vi.fn(async () => undefined)} />)
  await waitFor(() => expect(within(aside()).getAllByText('Fix the login bug').length).toBeGreaterThan(0))
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

beforeEach(() => { localStorage.clear(); resetSectionsForTests(); fixture() })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-61 · BRD-02 · expanded: the OxeChat sidebar has the BRD-01 anatomy', () => {
  it('CA-1 · anatomia igual à do BRD-01', async () => {
    await renderSidebar()
    const headers = all('[data-ui="sidebar-header"]'), footers = all('[data-ui="sidebar-footer"]'), filters = all('[data-ui="sidebar-filter"]')
    expect(headers, 'one SidebarHeader').toHaveLength(1)
    expect(footers, 'one SidebarFooter').toHaveLength(1)
    expect(filters, 'one SidebarFilter').toHaveLength(1)
    expect(headers[0]).toHaveTextContent(/^Conversations/)
    expect(within(filters[0]).getByRole('searchbox', { name: 'Filter conversations' })).toBeInTheDocument()
    for (const density of ['compact', 'comfortable'] as const) {
      const bar = density === 'compact' ? 36 : 40, control = density === 'compact' ? 28 : 32, row = density === 'compact' ? 28 : 32
      expect(length(headers[0], 'height', density), `header ${density}`).toBe(bar)
      expect(length(footers[0], 'height', density), `footer ${density}`).toBe(bar)
      expect(length(filters[0], 'height', density), `filter ${density}`).toBe(control)
      for (const name of ['Atlas', 'Borealis']) expect(length(groupOf(name), 'min-height', density), `group ${name} ${density}`).toBe(row)
      for (const title of ['Fix the login bug', 'Tune the query', 'Weekly audit']) expect(length(rowOf(title), 'min-height', density), `row ${title} ${density}`).toBe(row)
    }
    for (const label of ['Pinned', 'Projects']) {
      const section = sectionLabel(label)
      expect(section, `${label} is a SidebarSection`).toBeTruthy()
      expect(cascaded(section!, 'height')?.value, `${label} section height token`).toBe('var(--bar-sm)')
      for (const density of ['compact', 'comfortable'] as const) expect(length(section!, 'height', density), `${label} section ${density}`).toBe(24)
    }
    expect(tokenOf(cascaded(filters[0], 'background')?.value), 'filter fill').toBe('--fill-hover')
    for (const prop of ['border', 'border-top', 'border-top-width', 'border-width']) expect(zero(cascaded(filters[0], prop)?.value), `filter ${prop}`).toBe(true)
    for (const name of ['Atlas', 'Borealis']) {
      const group = groupOf(name)
      expect(group).not.toHaveAttribute('aria-current')
      for (const prop of ['border', 'border-top', 'border-bottom', 'border-width', 'box-shadow', 'background', 'background-color']) expect(zero(cascaded(group, prop)?.value), `group ${name} ${prop}`).toBe(true)
    }
    const selected = rowOf('Fix the login bug')
    expect(selected).toHaveAttribute('aria-current', 'true')
    expect(rowOf('Tune the query')).not.toHaveAttribute('aria-current')
    expect(tokenOf(cascaded(selected, 'background')?.value), 'selected fill').toBe('--fill-selected')
    bothModes('--fill-hover'); bothModes('--fill-selected')
    // Nothing outside src/ui restyles the primitives, and no wrapper fixes a row's height.
    const list = within(aside()).getByRole('navigation', { name: 'OxeChat projects' })
    const report = [...headers, ...footers, ...filters, ...all('[data-ui="sidebar-group"]'), ...all('[data-ui="sidebar-row"]')].flatMap(el => {
      const own = outsideOverrides(el).map(line => `${el.getAttribute('data-ui')} "${el.textContent?.trim().slice(0, 24)}": ${line}`)
      const wrappers: string[] = []
      for (let node = el.parentElement; node && node !== list && node !== aside(); node = node.parentElement) {
        for (const prop of ['height', 'min-height']) {
          const value = cascaded(node, prop)
          if (value && !value.rule.layered && !/^(0|0px|auto|none|100%|inherit|initial|fit-content|min-content|max-content)$/.test(value.value)) wrappers.push(`wrapper of "${el.textContent?.trim().slice(0, 24)}": ${value.rule.file} ${value.rule.selector} { ${prop}: ${value.value} }`)
        }
      }
      return [...own, ...wrappers]
    })
    expect([...new Set(report)]).toEqual([])
  })

  it('CA-1 · medidas do BRD-02 em enforced', () => {
    expect(notEnforced(id => id.startsWith('BRD-02.'))).toEqual([])
  })

  it('CA-2 · conversa de uma linha', async () => {
    await renderSidebar()
    for (const title of ['Fix the login bug', 'Tune the query', 'Weekly audit']) {
      const row = rowOf(title)
      expect(row.querySelector(`.${SIDEBAR.detail}`), `${title}: no detail`).toBeNull()
      expect(row.classList.contains(SIDEBAR.twoLine), `${title}: not a two-line row`).toBe(false)
      const slots = new Set([SIDEBAR.lead, SIDEBAR.rowTitle, SIDEBAR.rowActions, SIDEBAR.meta])
      for (const child of row.children) expect([...child.classList].some(name => slots.has(name)), `${title}: only the row's own slots (${child.className})`).toBe(true)
      expect(row.querySelector(`.${SIDEBAR.rowTitle}`)?.textContent?.trim(), `${title}: the title slot holds the title only`).toBe(title)
      for (const density of ['compact', 'comfortable'] as const) expect(length(row, 'min-height', density)).toBe(density === 'compact' ? 28 : 32)
    }
    // The words that left the row: the state in its accessible name, provider and state in its tooltip.
    for (const [title, state] of [['Fix the login bug', 'Finished'], ['Tune the query', 'Working'], ['Weekly audit', 'Ready'], ['Run the migration', 'Needs you']]) {
      const row = rowOf(title)
      const named = within(aside()).getAllByRole('button', { name: name => name.includes(title) && name.includes(state) })
      expect(named, `${title}: the row's accessible name says "${state}"`).toContain(row)
      const tips = [row, ...row.querySelectorAll('[title]')].map(el => el.getAttribute('title') ?? '')
      expect(tips.some(tip => tip.includes(state) && tip.includes('Claude Code')), `${title}: the tooltip names the provider and "${state}" (${tips.join(' | ')})`).toBe(true)
    }
  })

  it('CA-3 · conversa que precisa de você', async () => {
    await renderSidebar()
    const row = rowOf('Run the migration')
    const detail = row.querySelector(`.${SIDEBAR.detail}`)
    expect(detail, 'the needs-you row has the SidebarRow detail').not.toBeNull()
    expect(detail!.textContent?.trim().length, 'the detail says what is asked').toBeGreaterThan(0)
    expect(row.classList.contains(SIDEBAR.twoLine)).toBe(true)
    for (const density of ['compact', 'comfortable'] as const) expect(length(row, 'min-height', density), `two-line row ${density}`).toBe(density === 'compact' ? 44 : 48)
    expect(tokenOf(cascaded(detail!, 'color')?.value), 'detail color').toBe('--attn-fg')
    bothModes('--attn-fg')
    for (const title of ['Fix the login bug', 'Tune the query', 'Weekly audit']) {
      expect(rowOf(title).querySelector(`.${SIDEBAR.lead} [data-status], .${SIDEBAR.lead} [data-status-dot]`), `${title}: a status signal leads the row`).not.toBeNull()
    }
    const lead = row.querySelector(`.${SIDEBAR.lead}`)
    const signal = lead?.querySelector('[data-status="attention"], [data-status-dot="attention"]')
    expect(signal, 'a needs-you signal leads the row').not.toBeNull()
    const paint = ['background', 'background-color', 'color'].map(prop => tokenOf(cascaded(signal!, prop)?.value))
    expect(paint, 'the needs-you signal is the sun ochre').toContain('--attn')
    expect(paint.filter(token => token?.startsWith('--intent-warning')), 'never the warning orange').toEqual([])
    bothModes('--attn')
    cleanup()
    render(<StatusDot status="attention" label="Needs you" />)
    const dot = document.querySelector('[data-status-dot="attention"]')!
    expect(tokenOf(cascaded(dot, 'background')?.value), 'src/ui StatusDot attention').toBe('--attn')
  })

  it('CA-4 · sem faixa de contagem', async () => {
    for (const language of ['en', 'pt-BR'] as const) {
      await changeLanguage(language)
      await renderSidebar()
      const text = aside().textContent ?? ''
      expect(text, language).not.toMatch(/Archived ·|Arquivadas ·/)
      expect(text, language).not.toMatch(/\b\d+\s+(conversation|conversa)s?\b/)
      cleanup()
    }
    await changeLanguage('en')
    await renderSidebar()
    const user = userEvent.setup()
    const projects = sectionLabel('Projects')
    expect(projects, 'Projects is a SidebarSection').toBeTruthy()
    expect(within(aside()).queryByRole('region', { name: 'Archived conversations' })).toBeNull()
    await user.click(within(projects!).getByRole('button'))
    const menu = await screen.findByRole('menu')
    const entry = [...within(menu).queryAllByRole('menuitem'), ...within(menu).queryAllByRole('menuitemcheckbox')].find(item => item.textContent?.trim() === 'Archived')
    expect(entry, '"Archived" is in the Projects menu').toBeTruthy()
    await user.click(entry!)
    const archived = await within(aside()).findByRole('region', { name: 'Archived conversations' })
    expect(archived).toHaveTextContent('Old spike')
  })

  it('CA-6 · estrutura da 1.4 mantida', async () => {
    await renderSidebar()
    const header = all('[data-ui="sidebar-header"]')[0]
    expect(header, 'the SidebarHeader').toBeTruthy()
    expect(within(header).getByRole('button', { name: 'Add project' })).toBeInTheDocument()
    const pinned = sectionLabel('Pinned'), projects = sectionLabel('Projects')
    expect(pinned, 'Pinned is a SidebarSection').toBeTruthy()
    expect(projects, 'Projects is a SidebarSection').toBeTruthy()
    const reviews = await within(aside()).findByRole('region', { name: 'Reviews' })
    const order = [header, all('[data-ui="sidebar-filter"]')[0], pinned!, rowOf('Weekly audit'), projects!, groupOf('Atlas'), reviews, rowOf('Fix the login bug'), rowOf('Run the migration'), groupOf('Borealis'), rowOf('Tune the query')]
    for (let index = 1; index < order.length; index++) expect(before(order[index - 1], order[index]), `item ${index - 1} comes before item ${index}`).toBe(true)
    expect(reviews).toContainElement(rowOf('Fix the login bug'))
    expect(reviews).not.toContainElement(rowOf('Run the migration'))
  })
})

describe('OXE-61 · BRD-02 · collapsed: the rail, and every control a primitive', () => {
  it('CA-5 · trilho com sinais', async () => {
    await renderSidebar()
    act(() => useUIStore.getState().toggleSidebar('thread'))
    const rail = aside()
    await waitFor(() => expect(within(rail).queryByRole('searchbox')).toBeNull())
    const buttons = within(rail).getAllByRole('button')
    for (const button of buttons) expect(button.textContent?.trim() ?? '', `no visible letter on "${button.getAttribute('aria-label')}"`).not.toMatch(/\p{L}/u)
    const forProject = (name: string): HTMLElement => {
      const found = buttons.filter(button => new RegExp(`^${name}\\b`).test(button.getAttribute('aria-label') ?? button.textContent ?? ''))
      expect(found, `one rail button for ${name}`).toHaveLength(1)
      return found[0]
    }
    const atlas = forProject('Atlas'), borealis = forProject('Borealis')
    expect(buttons.filter(button => /Fix the login bug|Run the migration|Tune the query/.test(button.getAttribute('aria-label') ?? '')), 'one button per project, not per conversation').toEqual([])
    expect(atlas.querySelector('[data-status="attention"], [data-status-dot="attention"]'), 'Atlas has a conversation that needs you').not.toBeNull()
    expect(borealis.querySelector('[data-status="running"], [data-status-dot="running"]'), 'Borealis has one working').not.toBeNull()
    expect(atlas).toHaveAttribute('aria-current', 'true')
    expect(borealis).not.toHaveAttribute('aria-current')
    const user = userEvent.setup()
    await user.click(atlas)
    const menu = await screen.findByRole('menu')
    const names = within(menu).getAllByRole('menuitem').map(item => item.textContent ?? '')
    expect(names.some(name => name.includes('Run the migration')) && names.some(name => name.includes('Fix the login bug')), `Atlas lists its conversations: ${names.join(' | ')}`).toBe(true)
    expect(names.some(name => name.includes('Tune the query'))).toBe(false)
    await user.click(within(menu).getAllByRole('menuitem').find(item => item.textContent?.includes('Run the migration'))!)
    await waitFor(() => expect(useThreadStore.getState().selectedId).toBe('b'))
  })

  it('CA-7 · cada controle da lateral é um primitivo de src/ui', async () => {
    await renderSidebar()
    const controls = (root: HTMLElement): HTMLElement[] => all('button, [role="button"], input, select, textarea, a[href], [role="separator"][tabindex]', root)
    const primitive = (el: HTMLElement): boolean => ['button', 'icon-button', 'sidebar-row', 'sidebar-group'].includes(el.getAttribute('data-ui') ?? '')
      || Boolean(el.closest('[data-ui="sidebar-filter"]')) || [...el.classList].some(isUiClass)
    const raw = (root: HTMLElement): string[] => controls(root).filter(el => !primitive(el)).map(el => `${el.tagName.toLowerCase()} "${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30)}"`)
    expect(raw(aside()), 'expanded').toEqual([])
    act(() => useUIStore.getState().toggleSidebar('thread'))
    await waitFor(() => expect(within(aside()).queryByRole('searchbox')).toBeNull())
    expect(raw(aside()), 'collapsed').toEqual([])
    expect(all('button', aside()).flatMap(el => outsideOverrides(el, ['width', 'height', 'min-width', 'min-height', 'padding'])), 'rail buttons keep the primitive size').toEqual([])
  })
})
