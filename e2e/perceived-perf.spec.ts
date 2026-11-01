/**
 * Perceived performance (roadmap F7, phase 1): what the user SEES after opening a surface, frame by frame.
 *
 * For each surface (Code, Thread with a conversation open, OxeQuery, OxePod, OxePost, Settings on the Agents
 * and Appearance pages) one in-renderer probe clicks the control synchronously and then samples every animation
 * frame until the surface has shown its real content for a moment:
 *  - feedback: the first frame with a loader (LoadingState, Skeleton, Spinner, BrandLoader) or the content;
 *  - content: the first frame where the surface's content selectors are visible and no loader is left;
 *  - blank: frames where the main region (the work surface, or the dialog's content area) shows nothing at all:
 *    no visible text, no media or control, no loader. The longest continuous blank span is reported; the 1.4
 *    goal is 100 ms at most. The sidebar of the Thread and data views is sampled the same way, separately.
 * Cold is the first open of a surface in a session (its lazy chunk not loaded yet), warm the second one. Each
 * launch measures every surface cold, then warm, so 5 launches give 5 samples of each; median and max are
 * reported. Boot is read from the main process's startup marks and the renderer's paint timeline.
 *
 * The app runs in mock-native mode with the Thread IPC replaced by the fixture fake, so runs are comparable.
 * Playwright's fake clock is NOT installed (it replaces requestAnimationFrame), which is why this spec has its
 * own launch instead of helpers/launch.ts.
 *
 * One extra launch (OXESPACE_PERF_SHOTS=0 skips it) repeats the probes while capturing screenshots, and keeps
 * the one taken inside the longest blank span under e2e/screenshots/perceived-perf/; its numbers are not used.
 *
 * The first test gates (on the medians): first feedback, main-region blank and sidebar blank at most 100 ms for every
 * surface, cold and warm. The second compares the renderer's idle memory with the idle preload on and off.
 *
 * Build first: npx electron-vite build
 * Run: npx playwright test --config playwright.tools.config.ts perceived-perf.spec.ts --workers=1 --reporter=line
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installThreadFixtures, registerThreadProject, setThreadState } from './helpers/thread-fixtures'
import { PERF_ADVISORY, perfAdvisoryApplies } from './helpers/perfAdvisory'

const LAUNCHES = Number(process.env.OXESPACE_PERF_LAUNCHES ?? 5)
const BLANK_GOAL_MS = 100
/**
 * First content, median ms of 5 launches, measured on main before F7 (phase 1 baseline, commit 0a48638d):
 *
 *   surface                 cold  warm
 *   OxeCode (Code)            60    35
 *   OxeChat (Thread)         335    22
 *   OxeQuery                 335    22
 *   OxePod                   341    14
 *   OxePost                  336    20
 *   Settings · Agents        344    26
 *   Settings · Appearance     29    26
 *
 * The gate fails a surface whose median first content exceeds its baseline by more than 10%, or by more than one
 * frame (16.7 ms) for the warm numbers, which are a frame or two and would otherwise fail on frame rounding alone.
 */
const CONTENT_BASELINE_MS: Record<'cold' | 'warm', Record<string, number>> = {
  // OxeCode cold rebased onto current main (74 ms measured on main without this branch, 2026-10-31; was 60 on the
  // older main the phase-1 baseline used): the Code path is not this branch's, the gate keeps it from getting worse.
  cold: { 'OxeCode (Code)': 74, 'OxeChat (Thread)': 335, OxeQuery: 335, OxePod: 341, OxePost: 336, 'Settings · Agents': 344, 'Settings · Appearance': 29 },
  warm: { 'OxeCode (Code)': 35, 'OxeChat (Thread)': 22, OxeQuery: 22, OxePod: 14, OxePost: 20, 'Settings · Agents': 26, 'Settings · Appearance': 26 }
}
const contentLimit = (baseline: number): number => Math.max(baseline * 1.1, baseline + 16.7)
const CAPTURE = process.env.OXESPACE_PERF_SHOTS !== '0'
const SHOTS_DIR = join(process.cwd(), 'e2e', 'screenshots', 'perceived-perf')

/** What the in-page probe needs: the control to click and what counts as the surface's content. */
interface Probe {
  /** CSS selectors that must all match a visible element once the content is shown. */
  content: string[]
  /** Text the first content selector must contain (the conversation's own words, say). */
  text?: string
  /** A dialog: the blank region is its content area, and before it exists the old screen is still shown. */
  dialog: boolean
  /** Also sample the view's sidebar (the Thread and data views share `aside.thread-navigation`). */
  sidebar: boolean
  settleMs: number
  timeoutMs: number
}

interface Sample {
  feedback: number | null
  content: number | null
  blank: number
  sidebarBlank: number
  /** performance.now() bounds of the longest main-region blank span, for matching screenshots. */
  blankFrom: number | null
  blankTo: number | null
  /** The DOM at the start of the longest blank span: what was on screen instead of the surface. */
  scene: string
  sidebarScene: string
  frames: number
  longestFrame: number
  /** Each change of what is on screen: main and sidebar loaders (L/l) and which content selectors match (1/0). */
  trace: string
}

/**
 * Runs in the renderer: clicks `[data-perf-trigger]` and samples every frame. Self-contained (it is serialized by
 * page.evaluate), so every helper lives inside it.
 */
function probeInPage(probe: Probe): Promise<Sample> {
  const EXCLUDE = '.app-statusbar, .error-banner'
  const LOADER = /loading|skeleton|spinner|loader/i
  const MEDIA = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'INPUT', 'TEXTAREA', 'SELECT', 'IFRAME'])
  const shown = (el: Element): boolean => el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  const sized = (el: Element): boolean => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  /** Any visible text, media or form control under `root` (depth-first, hidden subtrees pruned). */
  const painted = (root: Element): boolean => {
    const stack: Element[] = [root]
    while (stack.length) {
      const el = stack.pop()!
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          if (child.textContent?.trim() && sized(el)) return true
        } else if (child instanceof Element) {
          if (child.matches(EXCLUDE) || !shown(child)) continue
          if (MEDIA.has(child.tagName.toUpperCase()) && sized(child)) return true
          stack.push(child)
        }
      }
    }
    return false
  }
  const loaderIn = (root: Element | null): boolean => !!root && Array.from(root.querySelectorAll('[role="status"], [aria-busy="true"]')).some(el =>
    shown(el) && sized(el) && (LOADER.test(el.getAttribute('class') ?? '') || !!el.querySelector('[class*="spinner"], [class*="skeleton"], [class*="loading"]')))
  const describe = (root: Element | null): string => {
    if (!root) return '(region not in the DOM)'
    const parts = Array.from(root.querySelectorAll(':scope > *, :scope > * > *')).filter(el => !el.matches(EXCLUDE) && shown(el)).slice(0, 8).map(el => {
      const r = el.getBoundingClientRect()
      const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 3).join('.')
      return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''} ${Math.round(r.width)}x${Math.round(r.height)} children=${el.childElementCount}`
    })
    return parts.length ? parts.join(' | ') : `${root.tagName.toLowerCase()} with no visible children`
  }
  const visibleSidebar = (): Element | null => Array.from(document.querySelectorAll('aside.thread-navigation')).find(el => shown(el) && sized(el)) ?? null
  const contentShown = (): boolean => probe.content.every((selector, index) => Array.from(document.querySelectorAll(selector)).some(el =>
    shown(el) && sized(el) && (index !== 0 || !probe.text || (el.textContent ?? '').includes(probe.text))))

  const trigger = document.querySelector<HTMLElement>('[data-perf-trigger]')
  if (!trigger) throw new Error('no [data-perf-trigger] element')
  trigger.removeAttribute('data-perf-trigger')

  type Frame = { t: number; blank: boolean; sidebarBlank: boolean; feedback: boolean; content: boolean; scene?: string; sidebarScene?: string }
  const frames: Frame[] = []
  const trace: string[] = []
  return new Promise(resolve => {
    const start = performance.now()
    const tick = (): void => {
      const t = performance.now() - start
      const dialog = probe.dialog ? document.querySelector('.settings-center') : null
      const region = probe.dialog ? (dialog ? document.querySelector('.settings-center-content') : null) : document.querySelector('section.workspace-surface')
      const sidebar = probe.sidebar ? visibleSidebar() : null
      const loading = loaderIn(region) || loaderIn(sidebar)
      const content = contentShown() && !loading
      // Before a dialog exists the previous screen is still on show: no feedback yet, but not blank either.
      const blank = probe.dialog ? !!dialog && (!region || (!painted(region) && !loaderIn(region))) : !region || (!painted(region) && !loaderIn(region))
      const sidebarBlank = probe.sidebar ? !sidebar || (!painted(sidebar) && !loaderIn(sidebar)) : false
      const state = `${loaderIn(region) ? 'L' : '-'}${loaderIn(sidebar) ? 'l' : '-'} ${probe.content.map(selector => Array.from(document.querySelectorAll(selector)).some(el => shown(el) && sized(el)) ? 1 : 0).join('')}`
      if (!trace.length || !trace[trace.length - 1].endsWith(` ${state}`)) trace.push(`${Math.round(t)} ${state}`)
      const previous = frames[frames.length - 1]
      const frame: Frame = { t, blank, sidebarBlank, feedback: loading || content || (probe.dialog && !!dialog), content }
      if (blank && !previous?.blank) frame.scene = describe(probe.dialog ? dialog : region)
      if (sidebarBlank && !previous?.sidebarBlank) frame.sidebarScene = describe(sidebar)
      frames.push(frame)
      const firstContent = frames.find(f => f.content)
      if ((firstContent && t - firstContent.t >= probe.settleMs) || t >= probe.timeoutMs) {
        const longest = (key: 'blank' | 'sidebarBlank'): { span: number; from: number | null; to: number | null; scene: string } => {
          let best = { span: 0, from: null as number | null, to: null as number | null, scene: '' }
          let open: Frame | null = null
          frames.forEach((f, i) => {
            if (f[key] && !open) open = f
            const closes = open && (!f[key] || i === frames.length - 1)
            if (open && closes) {
              const span = f.t - open.t
              if (span > best.span) best = { span, from: open.t + start, to: f.t + start, scene: (key === 'blank' ? open.scene : open.sidebarScene) ?? '' }
              if (!f[key]) open = null
            }
          })
          return best
        }
        const main = longest('blank')
        const side = longest('sidebarBlank')
        resolve({
          feedback: frames.find(f => f.feedback)?.t ?? null,
          content: firstContent?.t ?? null,
          blank: main.span, sidebarBlank: side.span, blankFrom: main.from, blankTo: main.to,
          scene: main.scene, sidebarScene: side.scene, frames: frames.length,
          longestFrame: frames.reduce((max, f, i) => i ? Math.max(max, f.t - frames[i - 1].t) : f.t, 0),
          trace: trace.join(' | ')
        })
        return
      }
      requestAnimationFrame(tick)
    }
    trigger.click()
    requestAnimationFrame(tick)
  })
}

type View = 'OxeCode' | 'OxeChat' | 'OxeQuery' | 'OxePod' | 'OxePost'
interface Surface { name: string; probe: Probe; /** Untimed setup, then tags the control to click. */ arm: (page: Page) => Promise<void>; /** Untimed teardown. */ leave?: (page: Page) => Promise<void> }

const MODE_PROBE = { dialog: false, settleMs: 300, timeoutMs: 10_000 }
const modeButton = (page: Page, name: View) => page.locator('nav[aria-label="Application view"]').getByRole('button', { name, exact: true })
const armMode = (name: View) => async (page: Page): Promise<void> => { await modeButton(page, name).evaluate(el => el.setAttribute('data-perf-trigger', '')) }
const settingsSurface = (name: string, page: 'providers' | 'appearance'): Surface => ({
  name,
  probe: { dialog: true, sidebar: false, settleMs: 300, timeoutMs: 10_000, content: ['.settings-center-content :is(h2, h3)', '.settings-center-content :is(button, input, select, textarea, [role="switch"])'] },
  arm: async p => {
    await modeButton(p, 'OxeCode').click()
    await p.evaluate(target => localStorage.setItem('oxe.settings.destination', JSON.stringify({ scope: 'application', page: target })), page)
    await p.getByRole('button', { name: 'Open settings' }).first().evaluate(el => el.setAttribute('data-perf-trigger', ''))
  },
  leave: async p => {
    await p.getByRole('button', { name: 'Back to work', exact: true }).click()
    await p.locator('.settings-center').waitFor({ state: 'detached' })
  }
})

const SURFACES: Surface[] = [
  { name: 'OxeChat (Thread)', arm: armMode('OxeChat'), probe: { ...MODE_PROBE, sidebar: true, text: 'How should sessions be stored?', content: ['.thread-host .thread-timeline', 'aside.thread-navigation'] } },
  { name: 'OxeQuery', arm: armMode('OxeQuery'), probe: { ...MODE_PROBE, sidebar: true, content: ['.oq-host .oq-view', 'aside.oq-sidebar .oq-sidebar-content header'] } },
  { name: 'OxePod', arm: armMode('OxePod'), probe: { ...MODE_PROBE, sidebar: true, content: ['.pod-host [aria-label="OxePod"]', 'aside.thread-navigation [data-pod-filter]'] } },
  { name: 'OxePost', arm: armMode('OxePost'), probe: { ...MODE_PROBE, sidebar: true, content: ['.post-host [aria-label="OxePost"]', 'aside.thread-navigation [data-post-filter]'] } },
  { name: 'OxeCode (Code)', arm: armMode('OxeCode'), probe: { ...MODE_PROBE, sidebar: false, content: ['.workspace-host:not(.workspace-host-hidden) [data-testid="terminal-pane"]'] } },
  settingsSurface('Settings · Agents', 'providers'),
  settingsSurface('Settings · Appearance', 'appearance')
]
/** Code's first open is the workspace itself: the wizard's Launch button to the grid with its terminal. */
const CODE_COLD: Surface = {
  name: 'OxeCode (Code)',
  probe: SURFACES.find(s => s.name === 'OxeCode (Code)')!.probe,
  arm: async page => { await page.getByTestId('wizard-launch-btn').evaluate(el => el.setAttribute('data-perf-trigger', '')) }
}

type Samples = Record<string, Sample[]>
type Results = { cold: Samples; warm: Samples; boot: Record<string, number[]> }
const fresh = (): Results => ({ cold: {}, warm: {}, boot: {} })
/** The round being measured; a confirmation round starts a fresh one. */
let results: Results = fresh()
const push = <T>(into: Record<string, T[]>, key: string, value: T): void => { (into[key] ??= []).push(value) }

async function launch(): Promise<{ app: ElectronApplication; page: Page; repo: string }> {
  const root = mkdtempSync(join(tmpdir(), 'oxespace-perceived-'))
  const repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  const app = await electron.launch({
    args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: { ...process.env, TZ: 'UTC', OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3') }
  })
  const page = await app.firstWindow()
  return { app, page, repo }
}

/** Window creation (main's `oxe:window-create` start) to ready-to-show, first paint, first contentful paint and LCP. */
async function readBoot(app: ElectronApplication, page: Page): Promise<Record<string, number>> {
  await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible' })
  const main = (): Promise<{ origin: number; measures: Record<string, { start: number; duration: number }> }> => app.evaluate(() => ({
    origin: performance.timeOrigin,
    measures: Object.fromEntries(performance.getEntriesByType('measure').filter(e => e.name.startsWith('oxe:')).map(e => [e.name, { start: e.startTime, duration: e.duration }]))
  }))
  await expect.poll(async () => Object.keys((await main()).measures), { message: 'the renderer reports its first painted screen' }).toContain('oxe:interactive')
  const { origin, measures } = await main()
  const renderer = await page.evaluate(() => new Promise<Record<string, number>>(resolve => {
    const out: Record<string, number> = { origin: performance.timeOrigin }
    for (const entry of performance.getEntriesByType('paint')) out[entry.name] = entry.startTime
    try {
      new PerformanceObserver(list => {
        const last = list.getEntries().at(-1) as (PerformanceEntry & { renderTime?: number }) | undefined
        if (last) out.lcp = last.renderTime || last.startTime
      }).observe({ type: 'largest-contentful-paint', buffered: true })
    } catch { /* no LCP support */ }
    setTimeout(() => resolve(out), 100)
  }))
  const windowAt = origin + (measures['oxe:window-create']?.start ?? NaN)
  const since = (rendererMs: number | undefined): number => rendererMs === undefined ? NaN : renderer.origin + rendererMs - windowAt
  return {
    'boot: process→window created': measures['oxe:window-create']?.start ?? NaN,
    'boot: window→ready-to-show': origin + (measures['oxe:ready-to-show']?.duration ?? NaN) - windowAt,
    'boot: window→first paint': since(renderer['first-paint']),
    'boot: window→first contentful paint': since(renderer['first-contentful-paint']),
    'boot: window→start screen LCP': since(renderer.lcp),
    'boot: window→interactive (oxe mark)': origin + (measures['oxe:interactive']?.duration ?? NaN) - windowAt,
    'boot: process→interactive': measures['oxe:interactive']?.duration ?? NaN
  }
}

/** Runs one probe; with `shots`, screenshots the window meanwhile and keeps the one inside the longest blank. */
async function measure(page: Page, surface: Surface, phase: 'cold' | 'warm', shots: boolean): Promise<Sample> {
  await surface.arm(page)
  if (!shots) return page.evaluate(probeInPage, surface.probe)
  let done = false
  const taken: Array<{ at: number; image: Buffer }> = []
  const running = page.evaluate(probeInPage, surface.probe).finally(() => { done = true })
  while (!done) {
    const at = await page.evaluate(() => performance.now()).catch(() => NaN)
    const image = await page.screenshot().catch(() => null)
    if (image) taken.push({ at, image })
  }
  const sample = await running
  if (sample.blank > 2 * 16.7 && sample.blankFrom !== null && sample.blankTo !== null) {
    const inside = taken.filter(shot => shot.at >= sample.blankFrom! && shot.at <= sample.blankTo!)
    const pick = inside[Math.floor(inside.length / 2)] ?? taken.filter(shot => shot.at <= sample.blankTo!).at(-1)
    if (pick) {
      mkdirSync(SHOTS_DIR, { recursive: true })
      const file = join(SHOTS_DIR, `${surface.name.replace(/[^A-Za-z]+/g, '-').toLowerCase()}-${phase}-blank-${Math.round(sample.blank)}ms.png`)
      writeFileSync(file, pick.image)
      console.log(`[SHOT] ${surface.name} ${phase}: ${file}${inside.length ? '' : ' (taken just before the blank span)'}`)
    }
  }
  return sample
}

/** One session: boot, Code cold through the wizard, every other surface cold, then every surface warm. */
async function session(shots: boolean): Promise<void> {
  const { app, page, repo } = await launch()
  try {
    const boot = await readBoot(app, page)
    if (!shots) for (const [key, value] of Object.entries(boot)) push(results.boot, key, value)
    await installThreadFixtures(app, repo)
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    const record = (phase: 'cold' | 'warm', name: string, sample: Sample): void => {
      if (shots) return
      if (phase === 'cold' && !results.cold[name]) console.log(`[TRACE] ${name} cold: ${sample.trace}`)
      push(results[phase], name, sample)
    }
    record('cold', CODE_COLD.name, await measure(page, CODE_COLD, 'cold', shots))
    // A conversation exists before Thread opens, so its first open selects it (thread.store load picks the first).
    await registerThreadProject(app, page, repo)
    await page.evaluate(() => window.oxe.thread!.create({ provider: 'claude' } as never))
    await setThreadState(app, repo, 'conversation')
    await page.waitForTimeout(300)
    for (const phase of ['cold', 'warm'] as const) {
      for (const surface of SURFACES) {
        if (phase === 'cold' && surface.name === CODE_COLD.name) continue
        record(phase, surface.name, await measure(page, surface, phase, shots))
        await surface.leave?.(page)
        await page.waitForTimeout(250)
      }
    }
  } finally {
    await app.close().catch(() => undefined)
  }
}

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const fmt = (xs: Array<number | null>): string => {
  const values = xs.filter((x): x is number => x !== null && Number.isFinite(x))
  if (!values.length) return 'n/a'
  const missing = xs.length - values.length
  return `${median(values).toFixed(0)}/${Math.max(...values).toFixed(0)}${missing ? ` (${missing} timed out)` : ''}`
}

function reportAll(): void {
  for (const [key, values] of Object.entries(results.boot)) console.log(`[RESULT] ${key.padEnd(40)} median/max ${fmt(values)} ms`)
  console.log('[RESULT] surface                  phase  feedback   content    blank      sidebar-blank  (median/max ms of 5)')
  const offenders: string[] = []
  for (const phase of ['cold', 'warm'] as const) {
    for (const [name, samples] of Object.entries(results[phase])) {
      const cols = [fmt(samples.map(s => s.feedback)), fmt(samples.map(s => s.content)), fmt(samples.map(s => s.blank)), fmt(samples.map(s => s.sidebarBlank))]
      console.log(`[RESULT] ${name.padEnd(24)} ${phase.padEnd(6)} ${cols.map(c => c.padEnd(10)).join(' ')} frames~${median(samples.map(s => s.frames))} longest-frame=${fmt(samples.map(s => s.longestFrame))}`)
      const worst = samples.reduce((a, b) => (b.blank > a.blank ? b : a))
      if (worst.blank > BLANK_GOAL_MS) offenders.push(`[BLANK] ${name} ${phase}: ${worst.blank.toFixed(0)} ms main region · on screen: ${worst.scene}`)
      const worstSide = samples.reduce((a, b) => (b.sidebarBlank > a.sidebarBlank ? b : a))
      if (worstSide.sidebarBlank > BLANK_GOAL_MS) offenders.push(`[BLANK] ${name} ${phase}: ${worstSide.sidebarBlank.toFixed(0)} ms sidebar · on screen: ${worstSide.sidebarScene}`)
    }
  }
  for (const line of offenders) console.log(line)
  if (!offenders.length) console.log(`[BLANK] no surface exceeded ${BLANK_GOAL_MS} ms blank`)
}

/** One gate check: a median and the most it may be. */
interface Check { label: string; value: number; limit: number }

/** The F7 gate, on the medians of a round: every surface answers within 100 ms, no region stays blank longer, and first content holds its baseline. */
function gateChecks(round: Results): Check[] {
  const checks: Check[] = []
  for (const phase of ['cold', 'warm'] as const) {
    for (const [name, samples] of Object.entries(round[phase])) {
      const med = (pick: (s: Sample) => number | null): number => median(samples.map(s => pick(s) ?? Infinity))
      checks.push({ label: `${name} ${phase}: first feedback`, value: med(s => s.feedback), limit: BLANK_GOAL_MS })
      checks.push({ label: `${name} ${phase}: main region blank`, value: med(s => s.blank), limit: BLANK_GOAL_MS })
      checks.push({ label: `${name} ${phase}: sidebar blank`, value: med(s => s.sidebarBlank), limit: BLANK_GOAL_MS })
      const baseline = CONTENT_BASELINE_MS[phase][name]
      if (baseline !== undefined) checks.push({ label: `${name} ${phase}: first content against the ${baseline} ms baseline`, value: med(s => s.content), limit: contentLimit(baseline) })
    }
  }
  return checks
}

/**
 * On CI (CI=true or OXESPACE_PERF_GATE=1) a check that fails is measured again in a second round of LAUNCHES launches, and the
 * gate fails only when it fails in both. A shared runner has slow minutes: a single round 2 ms over its limit
 * (OxeChat cold 371 against 368.5 on #308) was a 40-minute rerun of the whole job, while a real regression fails
 * both rounds. The limits stay as they are; locally a run is judged on its one round, as before.
 */
// CI runs this spec both in the E2E step (CI=true) and in the performance gate step (OXESPACE_PERF_GATE=1).
const CONFIRM = (process.env.CI === 'true' || process.env.OXESPACE_PERF_GATE === '1') && process.env.OXESPACE_PERF_CONFIRM !== '0'

// F7.3: the one temporary exception, advisory on every run that is not for main or a tag (e2e/helpers/perfAdvisory.ts).
const ADVISORY = PERF_ADVISORY
const advisoryHere = (check: Check): boolean => perfAdvisoryApplies(check.label)

async function measureRound(): Promise<void> {
  for (let i = 0; i < LAUNCHES; i++) {
    try { await session(false) } catch (error) { console.log(`[RESULT] launch ${i + 1} failed: ${(error as Error).message.split('\n')[0]}`) }
  }
  reportAll()
}

test('perceived performance: first feedback, first content and blank time per surface', async () => {
  // A packaged_smoke_only dispatch proves the packaged binary; PR and main runs keep this gate (ci.yml).
  test.skip(process.env.OXESPACE_PACKAGED_SMOKE === 'true', 'packaged smoke dispatch: perf budgets are gated on PR and main runs')
  test.setTimeout((CONFIRM ? 36 : 20) * 60_000)
  await measureRound()
  if (CAPTURE) {
    try { await session(true) } catch (error) { console.log(`[SHOT] capture launch failed: ${(error as Error).message.split('\n')[0]}`) }
  }
  expect(Object.keys(results.cold).length, 'at least one launch measured the surfaces').toBeGreaterThan(0)
  const first = gateChecks(results)
  const over = (check: Check): boolean => !(check.value <= check.limit)
  let second: Map<string, Check> | null = null
  if (CONFIRM && first.some(over)) {
    console.log(`[CONFIRM] over the limit in round 1, measuring again: ${first.filter(over).map(c => `${c.label} ${c.value.toFixed(0)}/${c.limit.toFixed(0)}`).join('; ')}`)
    results = fresh()
    await measureRound()
    second = new Map(gateChecks(results).map(check => [check.label, check]))
  }
  for (const check of first) {
    const again = second?.get(check.label)
    // Without a second round, round 1 decides; with one, a check fails only if it is over in both.
    const failed = over(check) && (!second || !again || over(again))
    if (second && over(check)) console.log(`[CONFIRM] ${check.label}: round 1 ${check.value.toFixed(0)}, round 2 ${again ? again.value.toFixed(0) : 'n/a'} (limit ${check.limit.toFixed(0)}) → ${failed ? 'regression' : 'runner noise'}`)
    const shown = again ? `${check.label} (round 1 ${check.value.toFixed(0)}, round 2 ${again.value.toFixed(0)})` : check.label
    if (failed && advisoryHere(check)) {
      // GitHub annotation: visible on the PR, never a failure there; push to main still fails.
      console.log(`::warning title=F7.3 OxeChat cold first content (advisory off main until ${ADVISORY.expires})::${shown}: ${Math.max(check.value, again?.value ?? -Infinity).toFixed(0)} ms, limit ${check.limit.toFixed(0)} ms`)
      continue
    }
    expect.soft(failed ? Math.max(check.value, again?.value ?? -Infinity) : Math.min(check.value, check.limit), shown).toBeLessThanOrEqual(check.limit)
  }
  // The exception must not outlive its fix: past the date the whole gate fails, everywhere, until it is removed.
  expect(Date.now(), `the F7.3 advisory exception expired on ${ADVISORY.expires}: fix OxeChat cold first content and remove ADVISORY`).toBeLessThan(Date.parse(`${ADVISORY.expires}T00:00:00Z`))
})

/**
 * What the idle preload costs an idle window: the renderer's working set and JS heap 6 s after start, most recent view
 * OxeQuery, in three setups: (a) the default on a machine under 8 GB (deviceMemory 4: Settings only), (b) deviceMemory
 * forced to 8 and charging (OxeQuery and Settings), (c) the preload off (`oxe.preload` = 'off').
 */
test('perceived performance: idle memory cost of the preload', async () => {
  test.setTimeout(12 * 60_000)
  type Setup = 'a settings only' | 'b view + settings' | 'c off'
  const setups: Setup[] = ['a settings only', 'b view + settings', 'c off']
  const samples = Object.fromEntries(setups.map(setup => [setup, [] as Array<{ workingSetMb: number; heapMb: number; marks: string[] }>])) as Record<Setup, Array<{ workingSetMb: number; heapMb: number; marks: string[] }>>
  for (let round = 0; round < 3; round++) {
    for (const setup of setups) {
      const { app, page } = await launch()
      try {
        await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible' })
        const memory = setup.startsWith('b') ? 8 : 4
        await page.addInitScript(gb => {
          Object.defineProperty(Navigator.prototype, 'deviceMemory', { configurable: true, get: () => gb })
          Object.defineProperty(Navigator.prototype, 'getBattery', { configurable: true, value: () => Promise.resolve({ charging: true }) })
        }, memory)
        await page.evaluate(off => {
          localStorage.setItem('oxe.recent-view', 'data')
          if (off) localStorage.setItem('oxe.preload', 'off'); else localStorage.removeItem('oxe.preload')
        }, setup.startsWith('c'))
        await page.reload()
        await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible' })
        await page.waitForTimeout(6_000)
        const marks = await page.evaluate(() => performance.getEntriesByType('mark').map(entry => entry.name).filter(name => name.startsWith('oxe:preload')))
        const heapMb = await page.evaluate(() => ((performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1024 / 1024)
        const workingSetMb = await app.evaluate(({ app: electronApp, BrowserWindow }) => {
          const pid = BrowserWindow.getAllWindows()[0].webContents.getOSProcessId()
          return (electronApp.getAppMetrics().find(metric => metric.pid === pid)?.memory.workingSetSize ?? 0) / 1024
        })
        samples[setup].push({ workingSetMb, heapMb, marks })
      } finally {
        await app.close().catch(() => undefined)
      }
    }
  }
  for (const setup of setups) {
    const list = samples[setup]
    console.log(`[RESULT] idle renderer, (${setup.padEnd(17)}) working set median ${median(list.map(s => s.workingSetMb)).toFixed(1)} MB` +
      ` (${list.map(s => s.workingSetMb.toFixed(0)).join(', ')}) · JS heap median ${median(list.map(s => s.heapMb)).toFixed(1)} MB · marks ${[...new Set(list.flatMap(s => s.marks))].join(' ') || 'none'}`)
  }
  const off = median(samples['c off'].map(s => s.workingSetMb))
  for (const setup of setups.slice(0, 2)) console.log(`[RESULT] idle preload cost (${setup}): working set ${(median(samples[setup].map(s => s.workingSetMb)) - off).toFixed(1)} MB`)
  expect(Object.values(samples).flat()).toHaveLength(9)
})
