// Frozen acceptance test for 1.5.2 OxeChat F5 · conversa AG-10/11, criterion A4 (task T4, a gap before the UI). Written
// by the planner; the executor must not edit it. Source: AG-11-CRITERIOS-F5.md row 4.1 (MARCA 15/11): the drawn diagram
// with the bar "Diagrama | Código · Ampliar · Copiar"; data column "existe ('Ampliar' falta, é leve)"; AG-11 §4.1
// (Ampliar in a modal/zoom is the light gap). Rule of the coordinator: the gaps first, as their own tasks.
// Today (main 12b8e900b): MermaidDiagram's bar has the label "Diagram", one toggle "Show code"/"Show diagram" and Copy;
// there is no way to see a large diagram bigger.
// Contract (src/components/Threads/ThreadMermaid.tsx; the dialog is the src/ui Modal/Dialog primitive): once drawn, the
// bar reads, in order, a two-way switch "Diagram" | "Code" (thread markdown.diagram and a new pair "Code"/"Código"
// if markdown.code is not reused; buttons with aria-pressed, the diagram pressed first), "Enlarge" / "Ampliar" and Copy
// (markdown.copy → markdown.copied). Enlarge opens a dialog (role dialog) that holds the same drawing, larger; Escape or
// its close button closes it and the focus goes back to Enlarge. Copy always copies the diagram's code, never the
// picture. The bar never repeats "Code block". Until the drawing exists there is no Enlarge (nothing to enlarge).
// The drawing comes from the mermaid library, mocked here (jsdom cannot lay out SVG text); the component is the real one.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage, i18n } from '../../../src/i18n'
// ---- repository text and catalog strings (inlined in each frozen file so every task's PR stands alone) ----
import { existsSync as pbExistsFile, readdirSync as pbReaddir, readFileSync as pbReadFile } from 'node:fs'
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
/** Every key path of a catalog, flattened ("a.b.c" -> text). */
function flatCatalog(ns: string, lang: string): Record<string, string> {
  const walk = (value: unknown, prefix: string): Record<string, string> => Object.assign({}, ...Object.entries(value as Record<string, unknown>).map(([key, item]) =>
    typeof item === 'string' ? { [prefix + key]: item } : walk(item, `${prefix}${key}.`)))
  return walk(JSON.parse(pbRead(`shared/locales/${lang}/${ns}.json`)), '')
}
/** The key that holds `en` in English and `pt` in pt-BR, or '' (a new pair of words the task adds to both catalogs). */
function pairKey(ns: string, en: string, pt: string): string {
  const english = flatCatalog(ns, 'en'), portuguese = flatCatalog(ns, 'pt-BR')
  return Object.keys(english).find(key => english[key] === en && portuguese[key] === pt) ?? ''
}
/** State and note of one measure of src/design/targets (undefined when absent). SOURCE-TEXT (marked): the target files are data. */
function measureOf(id: string): { state: string; note?: string } | undefined {
  const name = id.split('.')[0].toLowerCase()
  if (!pbExistsFile(pbJoin(process.cwd(), `src/design/targets/${name}.json`))) return undefined
  return (JSON.parse(pbRead(`src/design/targets/${name}.json`)) as { measures: Array<{ id: string; state: string; note?: string }> }).measures.find(item => item.id === id)
}
/** The OxeChat brand measures (src/design/targets, OXE-149) that are not enforced and locked yet. SOURCE-TEXT (marked): the target files are data. */
function notEnforced(ids: readonly string[]): string[] {
  const lock = (JSON.parse(pbRead('src/design/targets/enforced.lock.json')) as { enforced: string[] }).enforced
  const measures = new Map(['brd-02', 'brd-04', 'brd-05', 'brd-25'].filter(name => pbExistsFile(pbJoin(process.cwd(), `src/design/targets/${name}.json`))).flatMap(name => (JSON.parse(pbRead(`src/design/targets/${name}.json`)) as { measures: Array<{ id: string; state: string }> }).measures).map(item => [item.id, item.state]))
  return ids.flatMap(id => [...(!measures.has(id) ? [`${id} is not in src/design/targets`] : measures.get(id) === 'enforced' ? [] : [`${id} is ${measures.get(id)}`]), ...(lock.includes(id) ? [] : [`${id} is not in enforced.lock.json`])])
}
vi.mock('mermaid', () => ({ default: {
  initialize: vi.fn(),
  parse: vi.fn(async (code: string) => !code.includes('%%broken')),
  render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}" data-test-drawing="yes" viewBox="0 0 100 40"><g><rect width="40" height="20"></rect><text>Refund</text></g></svg>` }))
} }))

const tt = (key: string, options: Record<string, unknown> = {}): string => i18n.t(key, { ns: 'thread', ...options }) as string
const ENLARGE = { en: 'Enlarge', 'pt-BR': 'Ampliar' } as const
const CODE = 'flowchart LR\n  A[Refund] --> B{Seen key?}\n  B -->|yes| C[Skip]\n  B -->|no| D[Post]'
let writeText: ReturnType<typeof vi.fn>
async function drawn(code = CODE) {
  const { MermaidDiagram } = await import('../../../src/components/Threads/ThreadMermaid')
  render(<MermaidDiagram code={code} />)
  await waitFor(() => expect(document.querySelector('[data-test-drawing="yes"]'), 'the drawing is in').toBeTruthy(), { timeout: 3_000 })
  return document.querySelector<HTMLElement>('[data-testid="thread-diagram"]')!
}
const barButtons = (block: HTMLElement): HTMLElement[] => within(block.querySelector<HTMLElement>('.thread-code-toolbar') ?? block).getAllByRole('button')

beforeEach(() => {
  writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
})
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('A4 · the drawn diagram and Enlarge (row 4.1)', () => {
  test.each(['en', 'pt-BR'] as const)('(%s) the bar reads Diagram | Code · Enlarge · Copy, the diagram pressed, and never "Code block"', async locale => {
    await changeLanguage(locale)
    const block = await drawn()
    const names = barButtons(block).map(button => (button.getAttribute('aria-label') ?? button.textContent ?? '').replace(/\s+/g, ' ').trim())
    const diagram = names.indexOf(tt('markdown.diagram')), enlarge = names.findIndex(name => name === ENLARGE[locale]), copy = names.findIndex(name => name.endsWith(tt('markdown.copy')) || name === tt('markdown.copyCode'))
    const code = names.findIndex((name, index) => index > diagram && index < enlarge)
    expect([diagram, code, enlarge, copy].every(index => index >= 0), `bar ${names.join(' | ')}`).toBe(true)
    expect(diagram < code && code < enlarge && enlarge < copy, `order ${names.join(' | ')}`).toBe(true)
    const buttons = barButtons(block)
    expect(buttons[diagram]).toHaveAttribute('aria-pressed', 'true')
    expect(buttons[code]).toHaveAttribute('aria-pressed', 'false')
    expect(block.textContent ?? '').not.toMatch(/Code block|Bloco de código/)
  })

  test('Code shows the code and Diagram brings the drawing back', async () => {
    const block = await drawn()
    const buttons = barButtons(block)
    const diagram = buttons.find(button => button.textContent?.includes(tt('markdown.diagram')))!
    const code = buttons[buttons.indexOf(diagram) + 1]
    await userEvent.click(code)
    expect(code).toHaveAttribute('aria-pressed', 'true')
    expect(block.querySelector('pre code')?.textContent).toContain('A[Refund]')
    await userEvent.click(diagram)
    expect(block.querySelector('[data-test-drawing="yes"]')).toBeTruthy()
  })

  test.each(['en', 'pt-BR'] as const)('(%s) Enlarge opens the same drawing in a dialog; Escape closes it and the focus goes back to Enlarge', async locale => {
    await changeLanguage(locale)
    const block = await drawn()
    const enlarge = within(block).getByRole('button', { name: ENLARGE[locale] })
    await userEvent.click(enlarge)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.querySelector('[data-test-drawing="yes"]'), 'the same drawing, in the dialog').toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(enlarge).toHaveFocus())
  })

  test('Copy copies the code, never the picture, and says Copied', async () => {
    const block = await drawn()
    const copy = barButtons(block).at(-1)!
    await userEvent.click(copy)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CODE))
    await waitFor(() => expect(copy.textContent).toContain(tt('markdown.copied')))
  })

  test('nothing to enlarge before there is a drawing', async () => {
    const { MermaidDiagram } = await import('../../../src/components/Threads/ThreadMermaid')
    await act(async () => { render(<MermaidDiagram code={'flowchart LR\n  %%broken'} />) })
    await new Promise(resolve => setTimeout(resolve, 600))
    expect(screen.queryByRole('button', { name: ENLARGE.en })).toBeNull()
  })

  test('adds Enlarge / Ampliar to both catalogs', () => {
    expect(pairKey('thread', ENLARGE.en, ENLARGE['pt-BR'])).not.toBe('')
  })
})
