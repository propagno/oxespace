import AxeBuilder from '@axe-core/playwright'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * HML · the 1.5.0 hard gate (user, 08/11: "visual totalmente polido, erros na interface não serão admitidos").
 * The black-box pass on the PACKAGED app, every surface, in every combination: en and pt-BR × light and dark ×
 * 900×620 and full size. Every surface is checked for what a person would see as a defect:
 *   - a page error or console error;
 *   - the page scrolling sideways, or a control outside the window;
 *   - text cut off without an ellipsis;
 *   - a raw i18n key or an unfilled {{placeholder}} on screen;
 *   - in pt-BR, English text that the en run shows identically (an untranslated string), unless it's a name;
 *   - axe serious or critical violations;
 *   - keyboard: Tab must move a visible focus, never lose it to <body>, never leave the window.
 * Every finding is written to findings.json (and the test fails), with a screenshot per surface. HML turns each one
 * into an HML-Fn-x for the TECH LEAD.
 *
 * Runs only on a CI runner, against OXESPACE_PACKAGED_EXECUTABLE (the test copy with the inspect fuse on, like ci.yml's
 * packaged E2E) and a throwaway --user-data-dir. Live OXESPACE_* / AI_MEMORY_* variables never reach it.
 */
const EXE = process.env.OXESPACE_PACKAGED_EXECUTABLE ?? ''
test.skip(!EXE || process.env.GITHUB_ACTIONS !== 'true', 'runs only in the HML packaged pass job, on a CI runner')

type Locale = 'en-US' | 'pt-BR'
type Theme = 'light' | 'dark'
type Size = { label: string; width: number; height: number }
/** 900×620 is the smallest supported window; full is the window maximized on the runner's screen. */
const SIZES: Size[] = [{ label: '900x620', width: 900, height: 620 }, { label: 'full', width: 0, height: 0 }]
/** Names and code that read the same in both languages on purpose. */
const SAME_IN_BOTH = /^((Ctrl|Shift|Alt|Cmd|Mod|⌘|⇧)([ +]\S+)+|[Tt]erminal \d+|[\w.-]+ CLI|[a-z][a-z0-9-]*( [a-z0-9-]+)+|OXESpace( [\d.]+)?|OxeCode|OxeChat|OxeQuery|(Claude )?(Sonnet|Opus|Haiku)( [\d.]+)?|Claude( Code)?|Codex|Git(Hub)?|Git Bash|Command Prompt|Windows PowerShell|MCP|PostgreSQL|MongoDB|MySQL|SQL|JSON|HTTP|URL|API|Docker|Podman|CLAUDE\.md|AGENTS\.md|Ctrl|Shift|Alt|Enter|Esc|Tab|OK|main|bash|zsh|pwsh|PowerShell|Terminal|Web Preview|\d[\d.:,%\s]*|[A-Z]{1,4}|[^A-Za-zÀ-ÿ]+)$/

interface Finding { combo: string; surface: string; kind: string; detail: string }
const findings: Finding[] = []
/** The en run's texts per surface, kept in a file: Playwright restarts the worker after a failed test, so a Map in
 *  memory would be empty by the time pt-BR runs. */
const EN_FILE = join(tmpdir(), `hml-pass-en-texts-${process.env.GITHUB_RUN_ID ?? 'local'}.json`)
const readEn = (): Record<string, string[]> => { try { return JSON.parse(readFileSync(EN_FILE, 'utf8')) as Record<string, string[]> } catch { return {} } }
const saveEn = (key: string, texts: Set<string>) => { const all = readEn(); all[key] = [...texts]; writeFileSync(EN_FILE, JSON.stringify(all)) }

function cleanEnv(locale: Locale): Record<string, string> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !/^(OXESPACE_|AI_MEMORY_)/i.test(k))) as Record<string, string>
  return { ...env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_LOCALE: locale, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' }
}

async function launch(locale: Locale, theme: Theme, size: Size): Promise<{ app: ElectronApplication; page: Page; root: string; errors: string[] }> {
  const root = mkdtempSync(join(tmpdir(), `hml-pass-${locale}-${theme}-${size.label}-`))
  const env = cleanEnv(locale)
  env.CLAUDE_CONFIG_DIR = join(root, 'claude-config'); env.CODEX_HOME = join(root, 'codex-home')
  const app = await electron.launch({ executablePath: EXE, args: [`--user-data-dir=${join(root, 'user-data')}`], env })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`) })
  await page.emulateMedia({ colorScheme: theme })
  await app.evaluate(({ BrowserWindow }, s) => { const w = BrowserWindow.getAllWindows()[0]; if (!s.width) { w.maximize(); return } w.unmaximize(); w.setContentSize(s.width, s.height); w.center() }, size)
  await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 60_000 })
  await page.waitForTimeout(800)
  return { app, page, root, errors }
}

async function quit(app: ElectronApplication): Promise<void> {
  let pid: number | undefined
  try { pid = app.process().pid } catch { return }
  await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  await Promise.race([app.close().catch(() => undefined), new Promise(r => setTimeout(r, 10_000))])
  if (pid) { try { if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(pid, 'SIGKILL') } catch { /* gone */ } }
}

/** What a person would call broken on the screen as it is now. */
async function inspect(page: Page, combo: string, surface: string, locale: Locale, errors: string[], outDir: string): Promise<void> {
  const add = (kind: string, detail: string) => findings.push({ combo, surface, kind, detail: detail.slice(0, 400) })
  for (const e of errors.splice(0)) add('error', e)
  const shot = join(outDir, `${combo}--${surface}.png`.replace(/[^\w.-]+/g, '_'))
  await page.screenshot({ path: shot }).catch(() => undefined)
  const seen = await page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight
    const out = { hscroll: document.documentElement.scrollWidth > vw + 1, offscreen: [] as string[], clipped: [] as string[], keys: [] as string[], texts: [] as string[], bg: getComputedStyle(document.body).backgroundColor }
    const srOnly = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width <= 2 || r.height <= 2 || (s.clip && s.clip !== 'auto') || /inset\(50%|inset\(100%/.test(s.clipPath) || s.position === 'absolute' && r.width * r.height <= 4 }
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return !srOnly(el) && r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05 && !el.closest('[aria-hidden="true"], .xterm, .monaco-editor') }
    const label = (el: Element) => `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''} "${(el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60)}"`
    for (const el of Array.from(document.querySelectorAll('button, a, [role="button"], [role="tab"], [role="menuitem"], input, select'))) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1) {
        // Inside a scroll container that can scroll it into view is fine.
        let p = el.parentElement, scrollable = false
        while (p && p !== document.body) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX + s.overflowY) && (p.scrollWidth > p.clientWidth || p.scrollHeight > p.clientHeight)) { scrollable = true; break } p = p.parentElement }
        if (!scrollable) out.offscreen.push(label(el))
      }
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const parents = new Set<Element>()
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { const t = (n.textContent ?? '').trim(); if (t && n.parentElement) parents.add(n.parentElement) }
    for (const el of parents) {
      if (!visible(el)) continue
      const text = Array.from(el.childNodes).filter(c => c.nodeType === 3).map(c => c.textContent ?? '').join('').trim().replace(/\s+/g, ' ')
      if (!text) continue
      out.texts.push(text)
      const s = getComputedStyle(el)
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && /(hidden|clip)/.test(s.overflowX) && s.textOverflow !== 'ellipsis') out.clipped.push(label(el))
      if (/\{\{\s*\w+\s*\}\}/.test(text) || (/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,5}$/.test(text) && !/\.(ts|tsx|js|json|md|sql|png|sh|py|txt|yml|yaml|lock)$/.test(text))) out.keys.push(text)
    }
    return out
  })
  if (seen.hscroll) add('hscroll', 'the page scrolls sideways')
  for (const o of seen.offscreen) add('offscreen', o)
  for (const c of seen.clipped) add('clipped', c)
  for (const k of seen.keys) add('i18n-key', k)
  const texts = new Set(seen.texts)
  const key = `${combo.replace(/^(en-US|pt-BR)/, '')}|${surface}`
  if (locale === 'en-US') saveEn(key, texts)
  else {
    const enList = readEn()[key]
    const en = enList ? new Set(enList) : undefined
    if (en) for (const t of texts) if (en.has(t) && t.split(' ').length >= 2 && /[a-z]{3}/.test(t) && !SAME_IN_BOTH.test(t)) add('untranslated', t)
  }
  const axe = await new AxeBuilder({ page }).setLegacyMode(true).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).disableRules(['region']).analyze().catch(e => ({ violations: [{ id: 'axe-failed', impact: 'serious', nodes: [{ target: [String(e).slice(0, 100)] }] }] }))
  for (const v of axe.violations) if (v.impact === 'serious' || v.impact === 'critical') add(`axe:${v.id}`, v.nodes.slice(0, 3).map(n => JSON.stringify(n.target)).join(' '))
  // Keyboard: Tab moves a visible focus that stays in the window and never falls to <body>.
  const lost: string[] = []
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    const f = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null
      if (!a || a === document.body) return { lost: true, label: 'body' }
      if (a.closest('.xterm, .monaco-editor')) return { lost: false, ok: true, label: 'editor' }
      // A menu, listbox or dialog container holds focus while its items show it (opened by pointer, no item yet);
      // an item shows it by data-highlighted / aria-selected, as Radix and listboxes do.
      if (/^(menu|menubar|listbox|dialog|alertdialog|tree|grid)$/.test(a.getAttribute('role') ?? '')) return { lost: false, ok: true, inView: true, label: 'container' }
      if (a.hasAttribute('data-highlighted') || a.getAttribute('aria-selected') === 'true') return { lost: false, ok: true, inView: true, label: 'highlighted' }
      // Visible focus is any change a person can see: outline, ring, border, background or the parent's (a wrapper
      // that draws the ring for its input). Read focused, blur, read again, focus back (keyboard modality stays).
      const look = (el: Element | null) => { if (!el) return ''; const s = getComputedStyle(el); return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderTopColor, s.borderBottomColor, s.borderBottomWidth, s.backgroundColor, s.color].join('|') }
      const focused = look(a) + '#' + look(a.parentElement) + '#' + look(a.parentElement?.parentElement ?? null)
      a.blur()
      const blurred = look(a) + '#' + look(a.parentElement) + '#' + look(a.parentElement?.parentElement ?? null)
      a.focus()
      const r = a.getBoundingClientRect()
      return { lost: false, ok: focused !== blurred, inView: r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1 && r.width > 0, label: `${a.tagName.toLowerCase()} "${(a.getAttribute('aria-label') ?? a.textContent ?? '').trim().slice(0, 50)}"` }
    })
    if (f.lost) { lost.push('focus fell to <body>'); break }
    if (f.ok === false) lost.push(`no visible focus on ${f.label}`)
    if (f.inView === false) lost.push(`focus outside the window on ${f.label}`)
  }
  for (const l of [...new Set(lost)]) add('keyboard', l)
  await page.keyboard.press('Escape').catch(() => undefined)
  console.log('HML', combo, surface, `bg=${seen.bg}`)
}

const combos: Array<{ locale: Locale; theme: Theme; size: Size }> = []
for (const locale of ['en-US', 'pt-BR'] as Locale[]) for (const theme of ['light', 'dark'] as Theme[]) for (const size of SIZES) combos.push({ locale, theme, size })

for (const { locale, theme, size } of combos) {
  const combo = `${locale}-${theme}-${size.label}`
  test(`HML packaged pass · ${combo}`, async () => {
    test.setTimeout(600_000)
    const outDir = test.info().outputPath('surfaces'); mkdirSync(outDir, { recursive: true })
    const { app, page, root, errors } = await launch(locale, theme, size)
    const before = findings.length
    try {
      await inspect(page, combo, '01-start', locale, errors, outDir)
      // The wizard, then a workspace on a fresh git repo.
      const repo = join(root, 'repo'); mkdirSync(repo, { recursive: true })
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
      execFileSync('git', ['-c', 'user.email=hml@example.invalid', '-c', 'user.name=hml', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo })
      writeFileSync(join(repo, 'README.md'), '# HML\n')
      await page.getByTestId('btn-new-workspace').first().click(); await page.waitForTimeout(600)
      await inspect(page, combo, '02-wizard', locale, errors, outDir)
      await page.getByTestId('btn-new-workspace').first().click().catch(() => undefined)
      await page.getByTestId('wizard-dir-input').fill(repo)
      await page.getByTestId('wizard-layout-card-1').click().catch(() => undefined)
      await page.getByTestId('wizard-launch-btn').click()
      await page.waitForTimeout(3_000)
      const modes = await page.locator('button[data-app-mode]').evaluateAll(b => b.map(x => x.getAttribute('data-app-mode') ?? ''))
      for (const m of modes) {
        await page.locator(`button[data-app-mode="${m}"]`).first().click().catch(() => undefined); await page.waitForTimeout(1_200)
        await inspect(page, combo, `03-mode-${m}`, locale, errors, outDir)
      }
      await page.locator('button[data-app-mode="code"]').first().click().catch(() => undefined); await page.waitForTimeout(600)
      await page.keyboard.press('Control+k'); await page.waitForTimeout(600)
      await inspect(page, combo, '04-palette', locale, errors, outDir)
      await page.keyboard.press('Escape')
      const menu = page.getByRole('button', { name: /^(Application menu|Menu do aplicativo)$/ }).first()
      if (await menu.count()) { await menu.click({ timeout: 5_000 }).catch(() => undefined); await page.waitForTimeout(400); await inspect(page, combo, '05-app-menu', locale, errors, outDir); await page.keyboard.press('Escape') }
      // Every Settings page.
      await page.keyboard.press('Control+,'); await page.waitForTimeout(1_000)
      const nav = page.getByRole('navigation', { name: /Settings categories|Categorias/ }).first()
      const pages = (await nav.count()) ? (await nav.getByRole('button').allInnerTexts()).map(t => t.trim()).filter(Boolean) : []
      for (const [i, name] of pages.entries()) {
        await nav.getByRole('button', { name, exact: true }).first().click({ timeout: 5_000 }).catch(() => undefined); await page.waitForTimeout(700)
        // Keyboard checks start inside the page each time, so Tab walks that page.
        await inspect(page, combo, `06-settings-${String(i).padStart(2, '0')}-${name}`, locale, errors, outDir)
        if (!(await page.getByRole('dialog').count())) { await page.keyboard.press('Control+,'); await page.waitForTimeout(600) }
      }
      await page.keyboard.press('Escape')
    } finally {
      await quit(app)
      const mine = findings.slice(before)
      writeFileSync(join(test.info().outputPath(), 'findings.json'), JSON.stringify(mine, null, 2))
      const byKind = mine.reduce<Record<string, number>>((acc, f) => { acc[f.kind] = (acc[f.kind] ?? 0) + 1; return acc }, {})
      console.log('HML-FINDINGS', combo, JSON.stringify(byKind))
      test.info().annotations.push({ type: 'findings', description: JSON.stringify(byKind) })
    }
    expect.soft(findings.slice(before), `no interface defect in ${combo}`).toEqual([])
  })
}
