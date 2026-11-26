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
import { launchApp, layoutAtWidth, openDemoWorkspace, pinWorkspaceColor, type Density } from '../helpers/launch'
import { seedGitRepo } from '../helpers/seed'
import { installThreadFixtures, openThreadWithState, registerThreadProject, setThreadState } from '../helpers/thread-fixtures'
import { openSettings } from '../helpers/settings'

type Expect = { token?: string; oneOf?: string[]; px?: number; eq?: number | string; max?: number }
type Measure = { id: string; scene: string; select: string | { text: string; within?: string }; prop: string; expect: Expect; of?: string; attr?: string; tolerance: number; densities: string[]; themes: string[]; state: 'pending' | 'enforced' }
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
    // OXE-297: focus another pane before signalling paneId so it stays unseen on Windows runners with window focus.
    if (panes.length > 1) await page.locator(`[data-testid="pane-container"][data-pane-id="${panes[0]}"]`).click()
    await app.evaluate((_electron, value) => (globalThis as unknown as { __oxeE2eAgentState?: (input: unknown) => unknown }).__oxeE2eAgentState?.(value), { paneId, state: 'waiting', agent: 'claude', hookEvent: 'PermissionRequest' })
    const row = page.locator("[data-ui=sidebar-row][data-lines='2']").first()
    await row.waitFor({ timeout: 10_000 })
    // Wait for finite CSS transitions (e.g. pane-header focus background) to settle so measureScene reads final token colors, not mid-transition interpolations.
    await page.evaluate(async () => {
      const transitions = document.getAnimations().filter(a => typeof CSSTransition !== 'undefined' && a instanceof CSSTransition)
      await Promise.race([
        Promise.all(transitions.map(a => a.finished.catch(() => undefined))),
        new Promise<void>(resolve => setTimeout(resolve, 400))
      ])
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    })
    // DIAG (#854, BRD-01.row-two-line.height): the row's box and each child's, to read a height over --row-2.
    console.log(`[BRAND] two-line row: ${await row.evaluate(node => [node, ...node.children].map(child => `${child === node ? 'row' : (child.getAttribute('class') ?? child.tagName)}=${Math.round(child.getBoundingClientRect().height * 10) / 10}`).join(' '))}`)
    console.log(`[BRAND] two-line title: ${await row.evaluate(node => { const title = node.children[1] as HTMLElement | undefined; if (!title) return 'none'; const cs = getComputedStyle(title); return `display=${cs.display} lh=${cs.lineHeight} fs=${cs.fontSize} ws=${cs.whiteSpace} :: ` + [...title.childNodes].map(child => child.nodeType === 3 ? `text(${(child.textContent ?? '').length})` : (() => { const el = child as HTMLElement; const c = getComputedStyle(el); return `${el.tagName.toLowerCase()}.${el.getAttribute('class') ?? ''}[${c.display},${c.position},h=${Math.round(el.getBoundingClientRect().height * 10) / 10}]` })()).join(' ') })}`)
    console.log(`[BRAND] short OxeCode buttons: ${await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('aside [data-ui=button], [data-ui=workspace-bar] [data-ui=button], [data-ui=panel-stack] [data-ui=button]')].filter(el => el.getBoundingClientRect().height < 27.5).map(el => `${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}|${el.getAttribute('data-size')}|${el.getAttribute('class')}|h=${Math.round(el.getBoundingClientRect().height * 10) / 10}`).join(' ; ') || 'none')}`)
  } catch (error) {
    console.log(`[BRAND] could not seed a terminal that needs a decision: ${(error as Error).message.split('\n')[0]}`)
  }
}

const SCENE_ROOT: Record<string, string> = { 'needs-you-queue': '[data-ui=needs-you-queue]', 'code-workspace': 'body', 'chat-conversation': 'body', 'chat-approval': 'body', 'chat-new-session': 'body', 'chat-anatomy': 'body', 'settings-general': '.settings-center', 'command-bar': '[data-ui=command-bar]', 'first-run': '[data-testid=first-run]', 'code-menu': 'body' }

/**
 * The code-workspace scene has two side panels open (Changes and Browser), so the panel tabs BRD-03 measures exist.
 * Opening a panel never fails the run: if the Panels menu cannot open one, the scene is measured without it and the
 * tab measures report "no element", which is the honest result for that build.
 */
async function openSidePanels(page: Page): Promise<void> {
  const bar = page.locator('[data-ui="panel-group"]').first()
  for (const [buttonName, menuName] of [[/^Changes\b/, /^Changes$/], [/^Browser$/, /^Browser$/]] as const) {
    try {
      const direct = bar.getByRole('button', { name: buttonName }).first()
      if (await direct.isVisible().catch(() => false)) {
        await direct.click({ timeout: 10_000 })
      } else {
        await page.getByTestId('btn-open-tools').click({ timeout: 10_000 })
        await page.getByRole('menu', { name: 'Panels' }).getByRole('menuitemcheckbox', { name: menuName }).click({ timeout: 10_000 })
      }
    } catch (error) {
      console.log(`[BRAND] could not open the ${menuName.source} panel: ${(error as Error).message.split('\n')[0]}`)
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

/**
 * BRD-10 (OXE-73): the needs-you queue with a conversation's approval and its exact command. The run's conversation is
 * a fixture of the renderer's Thread IPC that main's agents read model does not see, so main's own agents:changed push
 * brings one request row (risk low, so Deny and Allow once show) to the window. A failure leaves the scene's measures as
 * "no element".
 */
async function openNeedsYouQueue(app: ElectronApplication, page: Page): Promise<void> {
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const sources = { panes: { ok: true, seq: 1 }, threads: { ok: true, seq: 1 }, delegations: { ok: true, seq: 1 }, work: { ok: true, seq: 1 } }
      const row = { kind: 'thread', id: 'e2e-brand-thread', state: 'needs-you', provider: 'claude', mode: 'thread', title: 'Brand', workspaceId: null, since: 1, seenAt: null, session: null, worktree: null, cost: null,
        requests: [{ requestId: 'e2e-brand-request', kind: 'approval', title: { code: 'agents.request.approval', params: {} }, risk: 'low', reversible: null, answerable: true, since: 1, command: { text: 'npm run typecheck', untrusted: true } }] }
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('agents:changed', { upsert: [row], removed: [], sources })
    })
    await page.getByTestId('needs-you-pill').click({ timeout: 10_000 })
    await page.locator('[data-ui=needs-you-queue] [data-ui=needs-you-item][data-kind=request]').first().waitFor({ timeout: 10_000 })
  } catch (error) {
    console.log(`[BRAND] could not open the needs-you queue: ${(error as Error).message.split('\n')[0]}`)
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
    const pick = (select: string | { text: string; within?: string }): Element[] => {
      if (typeof select !== 'string') {
        // { text, within }: the text counted inside one element only; no such element means none of the text.
        const scope = select.within ? root.querySelector(select.within) : root
        if (!scope) return []
        const snapshot = document.evaluate(`.//*[starts-with(normalize-space(text()), ${JSON.stringify(select.text)})]`, scope, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
        return Array.from({ length: snapshot.snapshotLength }, (_, index) => snapshot.snapshotItem(index) as Element).filter(visible)
      }
      return [...root.querySelectorAll(select.replace(/::after$/, ''))].filter(visible)
    }
    const firstFamily = (value: string): string => value.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
    // A token's colour as the browser computes it (a probe), so it compares with an element's computed colour.
    const colorOf = (value: string): string => { const probeColor = document.createElement('div'); probeColor.style.color = value; document.body.appendChild(probeColor); const out = getComputedStyle(probeColor).color; probeColor.remove(); return out }
    return list.map(measure => {
      const elements = pick(measure.select)
      const expected = measure.expect
      if (measure.prop === 'count') {
        const ok = typeof expected.max === 'number' ? elements.length <= expected.max : elements.length === expected.eq
        return { id: measure.id, ok, expected: typeof expected.max === 'number' ? `count <= ${expected.max}` : `count = ${expected.eq}`, measured: `${elements.length}` }
      }
      if (!elements.length) return { id: measure.id, ok: false, expected: JSON.stringify(expected), measured: 'no element', detail: 'nothing matched the selector in this scene' }
      if (measure.prop === 'attr') {
        // The attribute named by `attr` on every element found, against expect.eq.
        const values = elements.map(element => element.getAttribute(measure.attr ?? '') ?? '(absent)')
        const off = values.filter(value => value !== String(expected.eq))
        return { id: measure.id, ok: off.length === 0, expected: `${measure.attr} = ${expected.eq}`, measured: off.length ? [...new Set(off)].slice(0, 4).join(', ') : 'ok', detail: off.length ? `${off.length}/${elements.length} element(s) off target` : undefined }
      }
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
        } else if (measure.prop === 'margin-block-start' || measure.prop === 'border-left-width') {
          const value = parseFloat(measure.prop === 'margin-block-start' ? style.marginBlockStart : style.borderLeftWidth) || 0
          measured = `${value}px`
          ok = wanted.some(target => Math.abs(parseFloat(target) - value) <= measure.tolerance)
        } else if (measure.prop === 'inline-start-offset') {
          // The element's left edge minus the left edge of `of` (its nearest such ancestor, else the first in the scene).
          const from = measure.of ? (element.parentElement?.closest(measure.of) ?? root.querySelector(measure.of)) : null
          const value = from ? element.getBoundingClientRect().left - from.getBoundingClientRect().left : NaN
          measured = from ? `${Math.round(value * 10) / 10}px` : `no ${measure.of ?? 'of'} element`
          ok = from !== null && wanted.some(target => Math.abs(parseFloat(target) - value) <= measure.tolerance)
        } else if (measure.prop === 'border-left-color' || measure.prop === 'background-color') {
          measured = measure.prop === 'border-left-color' ? style.borderLeftColor : style.backgroundColor
          ok = wanted.some(target => colorOf(target) === measured)
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
  }, { list: list.map(({ id, select, prop, expect, tolerance, of, attr }) => ({ id, select, prop, expect, tolerance, of, attr })), rootSelector: SCENE_ROOT[scene], tokenNames })
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
        const { app, page, workspaceRoot } = await launchApp({ appearance: theme, density, env: { OXESPACE_E2E_AGENT_STATE: '1', OXESPACE_E2E_REAL_GIT_BRANCH: '1' } })
        try {
          // 1440 CSS px on every runner: a screen narrower than that clamps the window, so the page is zoomed out to fit.
          await layoutAtWidth(app, page, 1440, 900)
          // BRD-12 (OXE-77): a fresh profile opens on the first run, before any workspace exists.
          await page.getByTestId('first-run').waitFor({ timeout: 15_000 }).catch(() => console.log('[BRAND] the first run did not show'))
          await page.evaluate(() => document.fonts.ready.then(() => undefined))
          await measureScene(page, 'first-run', density, theme)
          await installThreadFixtures(app, workspaceRoot)
          // OXE-286: code-workspace opens a real git repo on a named branch.
          seedGitRepo(workspaceRoot, { withBranchChanges: false })
          await openDemoWorkspace(page, workspaceRoot)
          await pinWorkspaceColor(page)
          await registerThreadProject(app, page, workspaceRoot)
          await openSidePanels(page)
          await page.evaluate(() => document.fonts.ready.then(() => undefined))
          await seedNeedsDecision(app, page)
          await measureScene(page, 'code-workspace', density, theme)
          // BRD-16 (OXE-85): the terminal's ⋯ menu opened in OxeCode, scene code-menu. A miss reports "no element".
          await page.locator('[data-testid="pane-container"]').first().getByRole('button', { name: 'More pane actions' }).click({ timeout: 10_000 }).catch(() => console.log('[BRAND] could not open the pane menu'))
          await page.getByTestId('pane-actions-menu').waitFor({ timeout: 5_000 }).catch(() => console.log('[BRAND] the pane menu did not show'))
          await measureScene(page, 'code-menu', density, theme)
          await page.keyboard.press('Escape')
          await page.getByTestId('pane-actions-menu').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {})
          await openCommandBar(page)
          await measureScene(page, 'command-bar', density, theme)
          await page.keyboard.press('Escape')
          await page.locator('[data-ui="command-bar"]').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {})
          await openNeedsYouQueue(app, page)
          await measureScene(page, 'needs-you-queue', density, theme)
          await page.keyboard.press('Escape')
          await page.locator('[data-ui=needs-you-queue]').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {})
          await openThreadWithState(app, page, workspaceRoot, 'conversation')
          // CR-53: the conversation renders after its snapshot is read; measure once the prompt card is on screen.
          await page.locator('[data-ui=prompt-card]').first().waitFor({ timeout: 10_000 }).catch(() => console.log('[BRAND] the prompt card did not show'))
          await measureScene(page, 'chat-conversation', density, theme)
          // OxeChat's approved target (15/11): a request waiting in the conversation and on its sidebar row, and the
          // opening of a conversation with no messages yet (the new-conversation screen).
          // The same conversation, moved between states: a failure here reports its measures as "no element" and never
          // ends the run (the status of every interface PR comes from this run).
          for (const [state, scene] of [['approval', 'chat-approval'], ['empty', 'chat-new-session']] as const) {
            try {
              await setThreadState(app, workspaceRoot, state)
              await page.waitForLoadState('domcontentloaded')
              if (scene === 'chat-approval') {
                await page.locator('[data-ui=row-attention]').first().waitFor({ timeout: 5_000 })
              }
            } catch (error) {
              console.log(`[BRAND] could not set the ${state} state: ${(error as Error).message.split('\n')[0]}`)
            }
            await measureScene(page, scene, density, theme)
          }
          // BRD-25 (OXE-167, OXE-172): the same conversation seeded with the AG-11 situations, scene chat-anatomy.
          // A failure reports its measures as "no element", like chat-approval.
          try {
            await setThreadState(app, workspaceRoot, 'anatomy')
            await page.waitForLoadState('domcontentloaded')
            // thread:changed is applied on a 100ms timer, then the snapshot is read. Measuring in that gap still
            // sees the previous state (an empty conversation) and counts 0 alerts. The four alerts are one answer.
            await page.locator('[data-ui=alert]').nth(3).waitFor({ state: 'visible', timeout: 10_000 })
            // CR-53: AG-11 folds a finished turn's work under its "N actions" line; open it to measure the steps inside.
            const fold = page.getByTestId('thread-turn-fold').last()
            if (await fold.getAttribute('aria-expanded') === 'false') await fold.click()
            const explore = page.locator('[data-ui=explore-group] > [aria-expanded=false]').first()
            if (await explore.count()) await explore.click()
            await page.locator('[data-ui=step], [data-ui=reasoning]').first().waitFor({ timeout: 5_000 }).catch(() => console.log('[BRAND] the fold showed no step'))
            await page.locator('[data-ui=working-set]').first().waitFor({ timeout: 5_000 }).catch(() => console.log('[BRAND] the working-set bar did not show'))
            // Move the pointer away from fold/explore and let finite CSS transitions settle so BRD-25.fold.height
            // reads final token colors instead of mid-transition hover/active alpha interpolations.
            await page.mouse.move(0, 0)
            await page.evaluate(async () => {
              await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
              const finite = document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
              await Promise.race([
                Promise.all(finite.map(a => a.finished.catch(() => undefined))),
                new Promise<void>(resolve => setTimeout(resolve, 500))
              ])
              await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
            })
          } catch (error) {
            console.log(`[BRAND] could not set the anatomy state: ${(error as Error).message.split('\n')[0]}`)
          }
          await measureScene(page, 'chat-anatomy', density, theme)
          await openSettings(page)
          await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor()
          // With a workspace open Settings can open in that workspace's scope: open the app's General page, which BRD-06 measures.
          await page.locator('.settings-center-nav').getByRole('button', { name: /^General/ }).first().click({ timeout: 10_000 }).catch(() => console.log('[BRAND] could not open General'))
          // General loads lazily: measure once its page column is there (a miss reports "no element", as before).
          await page.locator('[data-ui=settings-page]').first().waitFor({ timeout: 10_000 }).catch(() => console.log('[BRAND] the General page did not render'))
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
