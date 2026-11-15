/**
 * OXE-149: the built app against the approved brand target (src/design/targets/brd-NN.json), in both densities and
 * both themes. Every desktop measure is checked and reported; only `enforced` ones fail the run (a `pending` measure is
 * a screen its BRD has not delivered yet). On the elements a measure finds, text, background and border colors must
 * be values of the generated tokens of the active theme (CA-4). The results go to BRAND_OUT as JSON; CI turns both
 * platforms' files into the `marca/conformidade` status on the PR head (ci.yml › ci-result).
 *
 * Runs only through playwright.brand.config.ts (the smoke config ignores e2e/brand/**).
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launchApp, openDemoWorkspace, pinWorkspaceColor, resizeWindow, type Density } from '../helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject, setThreadState } from '../helpers/thread-fixtures'
import { openSettings } from '../helpers/settings'

type Expect = { token?: string; oneOf?: string[]; px?: number; eq?: number }
type Measure = { id: string; scene: string; select: string | { text: string }; prop: string; expect: Expect; tolerance: number; densities: string[]; themes: string[]; state: 'pending' | 'enforced' }
type Result = { id: string; state: string; density: string; theme: string; scene: string; ok: boolean; expected: string; measured: string; detail?: string }

const targetsDir = join(process.cwd(), 'src/design/targets')
const measures: Measure[] = readdirSync(targetsDir)
  .filter(name => /^brd-\d{2}\.json$/.test(name))
  .flatMap(name => {
    const doc = JSON.parse(readFileSync(join(targetsDir, name), 'utf8')) as { platform: string; measures: Measure[] }
    return doc.platform === 'desktop' ? doc.measures : []
  })
const tokenNames = [...new Set([...readFileSync(join(process.cwd(), 'src/styles/tokens.generated.css'), 'utf8').matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]))]
const results: Result[] = []

/** Where each scene's selectors are evaluated. Settings is a dialog; the other scenes are the whole window. */
/**
 * BRD-01's two-line row: one terminal of the open workspace waits on a permission, through main's AgentStateService e2e
 * hook (electron/main/e2e/agent-state-hook.ts, as the BRD-09 e2e uses it), so the sidebar draws its second line.
 */
async function seedNeedsDecision(app: ElectronApplication, page: Page): Promise<void> {
  try {
    const panes = await page.evaluate(() => (window as unknown as { oxe: { workspace: { list(): Promise<Array<{ panes: Array<{ id: string; type: string }> }>> } } }).oxe.workspace.list()
      .then(list => list.flatMap(workspace => workspace.panes).filter(pane => pane.type === 'terminal').map(pane => pane.id)))
    const paneId = panes.at(-1)
    if (!paneId) throw new Error('no terminal pane')
    await app.evaluate((_electron, value) => (globalThis as unknown as { __oxeE2eAgentState?: (input: unknown) => unknown }).__oxeE2eAgentState?.(value), { paneId, state: 'waiting', agent: 'claude', hookEvent: 'PermissionRequest' })
    const row = page.locator("[data-ui=sidebar-row][data-lines='2']").first()
    await row.waitFor({ timeout: 10_000 })
    // DIAG (#854, BRD-01.row-two-line.height): the row's box and each child's, to read a height over --row-2.
    console.log(`[BRAND] two-line row: ${await row.evaluate(node => [node, ...node.children].map(child => `${child === node ? 'row' : (child.getAttribute('class') ?? child.tagName)}=${Math.round(child.getBoundingClientRect().height * 10) / 10}`).join(' '))}`)
  } catch (error) {
    console.log(`[BRAND] could not seed a terminal that needs a decision: ${(error as Error).message.split('\n')[0]}`)
  }
}

const SCENE_ROOT: Record<string, string> = { 'code-workspace': 'body', 'chat-conversation': 'body', 'chat-approval': 'body', 'chat-new-session': 'body', 'settings-general': '.settings-center', 'command-bar': '[data-ui=command-bar]' }

/**
 * The code-workspace scene has two side panels open (Changes and Browser), so the panel tabs BRD-03 measures exist.
 * Opening a panel never fails the run: if the Panels menu cannot open one, the scene is measured without it and the
 * tab measures report "no element", which is the honest result for that build.
 */
async function openSidePanels(page: Page): Promise<void> {
  for (const name of [/^Changes$/, /^Browser$/]) {
    try {
      await page.getByTestId('btn-open-tools').click({ timeout: 10_000 })
      await page.getByRole('menu', { name: 'Panels' }).getByRole('menuitemcheckbox', { name }).click({ timeout: 10_000 })
    } catch (error) {
      console.log(`[BRAND] could not open the ${name.source} panel: ${(error as Error).message.split('\n')[0]}`)
      await page.keyboard.press('Escape').catch(() => {})
    }
  }
  await page.getByTestId('changes-panel').waitFor({ timeout: 10_000 }).catch(() => {})
}

/** BRD-11 (OXE-75): Ctrl+K in OxeCode, then ">" so the bar lists its command rows. A failure leaves the scene's measures as "no element". */
async function openCommandBar(page: Page): Promise<void> {
  try {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
    await page.locator('[data-ui="command-bar"]').waitFor({ timeout: 10_000 })
    await page.keyboard.type('>')
    await page.locator('[data-ui="command-row"]').first().waitFor({ timeout: 10_000 })
  } catch (error) {
    console.log(`[BRAND] could not open the command bar: ${(error as Error).message.split('\n')[0]}`)
  }
}

async function measureScene(page: Page, scene: string, density: Density, theme: 'light' | 'dark'): Promise<void> {
  const list = measures.filter(measure => measure.scene === scene && measure.densities.includes(density) && measure.themes.includes(theme))
  const found = await page.evaluate(({ list, rootSelector, tokenNames }) => {
    const root = document.querySelector(rootSelector) ?? document.body
    const rootStyle = getComputedStyle(document.documentElement)
    const token = (name: string): string => rootStyle.getPropertyValue(name).trim()
    // The colors the generated tokens resolve to in this theme, normalized by the browser. A name that is not a color
    // leaves the probe on its parent's sentinel color and is skipped.
    const host = document.createElement('div')
    host.style.color = 'rgb(1, 2, 3)'
    const probe = document.createElement('div')
    host.appendChild(probe)
    document.body.appendChild(host)
    const colors = new Set<string>(['rgba(0, 0, 0, 0)'])
    for (const name of tokenNames) {
      probe.style.color = `var(${name})`
      const value = getComputedStyle(probe).color
      if (value !== 'rgb(1, 2, 3)') colors.add(value)
    }
    host.remove()
    const visible = (element: Element): boolean => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 }
    const pick = (select: string | { text: string }): Element[] => {
      if (typeof select !== 'string') {
        const snapshot = document.evaluate(`.//*[starts-with(normalize-space(text()), ${JSON.stringify(select.text)})]`, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
        return Array.from({ length: snapshot.snapshotLength }, (_, index) => snapshot.snapshotItem(index) as Element).filter(visible)
      }
      return [...root.querySelectorAll(select.replace(/::after$/, ''))].filter(visible)
    }
    const firstFamily = (value: string): string => value.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
    return list.map(measure => {
      const elements = pick(measure.select)
      const expected = measure.expect
      if (measure.prop === 'count') {
        const ok = elements.length === expected.eq
        return { id: measure.id, ok, expected: `count = ${expected.eq}`, measured: `${elements.length}` }
      }
      if (!elements.length) return { id: measure.id, ok: false, expected: JSON.stringify(expected), measured: 'no element', detail: 'nothing matched the selector in this scene' }
      const wanted: string[] = expected.token ? [token(expected.token)] : expected.oneOf ? expected.oneOf.map(token) : [`${expected.px}px`]
      const pseudo = typeof measure.select === 'string' && measure.select.endsWith('::after') ? '::after' : null
      const misses: string[] = []
      const offColors: string[] = []
      for (const element of elements) {
        const style = getComputedStyle(element, pseudo)
        let measured: string
        let ok: boolean
        if (measure.prop === 'height' || measure.prop === 'width') {
          const value = pseudo ? parseFloat(style[measure.prop]) : element.getBoundingClientRect()[measure.prop]
          measured = `${Math.round(value * 10) / 10}px`
          ok = wanted.some(target => Math.abs(parseFloat(target) - value) <= measure.tolerance)
        } else if (measure.prop === 'font-size' || measure.prop === 'border-radius') {
          const value = parseFloat(measure.prop === 'font-size' ? style.fontSize : style.borderTopLeftRadius)
          measured = `${value}px`
          ok = wanted.some(target => Math.abs(parseFloat(target) - value) <= measure.tolerance)
        } else if (measure.prop === 'font-weight') {
          measured = style.fontWeight
          ok = wanted.some(target => Number(target) === Number(style.fontWeight))
        } else {
          measured = firstFamily(style.fontFamily)
          ok = wanted.some(target => firstFamily(target) === measured)
        }
        if (!ok) misses.push(measured)
        if (!pseudo) {
          const own = getComputedStyle(element)
          const checks: Array<[string, string]> = [['color', own.color], ['background', own.backgroundColor]]
          if (parseFloat(own.borderTopWidth) > 0) checks.push(['border', own.borderTopColor])
          for (const [what, value] of checks) if (!colors.has(value)) offColors.push(`${what} ${value}`)
        }
      }
      const unique = (values: string[]): string => [...new Set(values)].slice(0, 4).join(', ')
      return {
        id: measure.id,
        ok: misses.length === 0 && offColors.length === 0,
        expected: wanted.join(' | '),
        measured: misses.length ? unique(misses) : 'ok',
        detail: [misses.length ? `${misses.length}/${elements.length} element(s) off target` : '', offColors.length ? `color not a token: ${unique(offColors)}` : ''].filter(Boolean).join('; ') || undefined
      }
    })
  }, { list: list.map(({ id, select, prop, expect, tolerance }) => ({ id, select, prop, expect, tolerance })), rootSelector: SCENE_ROOT[scene], tokenNames })
  for (const item of found) {
    const measure = list.find(entry => entry.id === item.id)!
    results.push({ ...item, state: measure.state, density, theme, scene })
    console.log(`[BRAND] ${item.ok ? 'ok  ' : 'OFF '} ${measure.state.padEnd(8)} ${density}/${theme} ${item.id} expected ${item.expected} measured ${item.measured}${item.detail ? ` (${item.detail})` : ''}`)
  }
}

test.describe.serial('brand conformance (OXE-149)', () => {
  for (const density of ['compact', 'comfortable'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`${density} ${theme}`, async () => {
        test.setTimeout(180_000)
        const { app, page, workspaceRoot } = await launchApp({ appearance: theme, density, env: { OXESPACE_E2E_AGENT_STATE: '1' } })
        try {
          await resizeWindow(app, 1440, 900)
          await installThreadFixtures(app, workspaceRoot)
          await openDemoWorkspace(page, workspaceRoot)
          await pinWorkspaceColor(page)
          await registerThreadProject(app, page, workspaceRoot)
          await openSidePanels(page)
          await page.evaluate(() => document.fonts.ready.then(() => undefined))
          await seedNeedsDecision(app, page)
          await measureScene(page, 'code-workspace', density, theme)
          await openCommandBar(page)
          await measureScene(page, 'command-bar', density, theme)
          await page.keyboard.press('Escape')
          await page.locator('[data-ui="command-bar"]').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {})
          await openThreadWithState(app, page, workspaceRoot, 'conversation')
          await measureScene(page, 'chat-conversation', density, theme)
          // OxeChat's approved target (15/11): a request waiting in the conversation and on its sidebar row, and the
          // opening of a conversation with no messages yet (the new-conversation screen).
          // The same conversation, moved between states: a failure here reports its measures as "no element" and never
          // ends the run (the status of every interface PR comes from this run).
          for (const [state, scene] of [['approval', 'chat-approval'], ['empty', 'chat-new-session']] as const) {
            try {
              await setThreadState(app, workspaceRoot, state)
              await page.waitForLoadState('domcontentloaded')
            } catch (error) {
              console.log(`[BRAND] could not set the ${state} state: ${(error as Error).message.split('\n')[0]}`)
            }
            await measureScene(page, scene, density, theme)
          }
          await openSettings(page)
          await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor()
          await measureScene(page, 'settings-general', density, theme)
        } finally {
          await app.close()
        }
      })
    }
  }

  test.afterAll(() => {
    const out = process.env.BRAND_OUT || join('test-results', 'brand-conformance.json')
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, `${JSON.stringify({ platform: `${process.platform}-${process.arch}`, results }, null, 1)}\n`)
  })

  test('no enforced measure diverges', () => {
    const off = results.filter(result => result.state === 'enforced' && !result.ok).map(result => `${result.id} ${result.density}/${result.theme}: ${result.measured}${result.detail ? ` (${result.detail})` : ''}`)
    const pending = results.filter(result => result.state === 'pending' && !result.ok).length
    console.log(`[BRAND] ${results.length} checks · ${off.length} enforced divergence(s) · ${pending} pending reported`)
    expect(off).toEqual([])
  })
})
