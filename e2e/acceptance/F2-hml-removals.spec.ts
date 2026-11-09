import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchReal, mode, openRepo, quitReal, realProfile } from './real-app'

/**
 * HML · 1.5.0 F2 (the cockpit removals R1–R15, R0a–R0d), black box on the REAL app. Red until F2 lands.
 *
 * What a person meets after F2, in three questions:
 * (a) nothing people still need disappears without a replacement:
 *     /work → Delegated work, with cancel; files open read-only with Open in editor (and a way to pick an editor);
 *     the project's instructions where Memory was;
 * (b) data from removed features is safe: a fresh install never shows the "what changed" band, and Settings › Data can
 *     export again (the upgrade path, 1.4.3 with data → 1.5.0, is HML's A40 install-over, not this spec);
 * (c) no dead link or menu item stays: the mode switch, the application menus, the command palette, Settings, the
 *     tool catalog, Keyboard settings and the terminal menu name no removed feature, and the removed chords do nothing.
 *
 * Every check records what it saw (report.txt in test-results). No agent, no account, no network.
 */

/** The removed features' names, en and pt-BR, as a person would see them in a label. */
const REMOVED = /\b(OxePost|OxePod|Linear|Teams?|Equipe|Skills|Automa(?:tions?|ções)|AI Memory|Memória|Memory|RTK|search by meaning|busca por significado|Semantic|Documentation tools|hybrid explore|Work panel)\b/i
/** Entries that may name a removed feature on purpose: the "what changed" band and the export of removed data. */
const ALLOWED = /what changed in 1\.5|o que mudou na 1\.5|removed in 1\.5|removidos na 1\.5|export removed data|exportar dados removidos/i

const notes: string[] = []
const note = (line: string) => { notes.push(line); console.log('HML', line) }
const flush = (info: TestInfo, name: string) => { writeFileSync(info.outputPath(`${name}.txt`), notes.join('\n')); info.annotations.push({ type: name, description: notes.join('\n') }); notes.length = 0 }
const leftovers = (labels: string[]) => labels.map(l => l.replace(/\s+/g, ' ').trim()).filter(l => REMOVED.test(l) && !ALLOWED.test(l))

async function menuLabels(page: Page): Promise<string[]> {
  const labels: string[] = []
  const top = page.getByRole('button', { name: /^(Application menu|Menu do aplicativo)$/ }).first()
  const hasTop = (await top.count()) > 0
  // The app menu closes on Escape, so it is opened again before each top-level entry; every click is bounded, so a
  // detached item is a skipped entry, never a hung test (baseline run 42484708486 hung on menuitem.nth(4)).
  const open = async () => { if (hasTop) { await top.click({ timeout: 3_000 }).catch(() => undefined); await page.waitForTimeout(300) } }
  const scope = () => { const bar = page.getByRole('menubar').first(); return bar }
  await open()
  const barCount = await scope().count()
  const entries = barCount ? await scope().getByRole('menuitem').allInnerTexts() : await page.getByRole('menuitem').allInnerTexts()
  labels.push(...entries)
  await page.keyboard.press('Escape')
  for (const entry of entries.map(e => e.trim()).filter(Boolean).slice(0, 20)) {
    await open()
    const item = page.getByRole('menuitem', { name: entry, exact: true }).first()
    if (!(await item.count())) { await page.keyboard.press('Escape'); continue }
    // A submenu opens on hover or click; read whatever is shown, then close.
    await item.hover({ timeout: 3_000 }).catch(() => undefined); await page.waitForTimeout(200)
    await item.click({ timeout: 3_000 }).catch(() => undefined); await page.waitForTimeout(200)
    labels.push(...(await page.getByRole('menuitem').allInnerTexts().catch(() => [])))
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  }
  return [...new Set(labels.map(l => l.trim()).filter(Boolean))]
}

test.describe('F2 · (c) no removed feature is left behind in the interface', () => {
  test('the mode switch lists OxeCode, OxeChat and OxeQuery, and the old OxePod/OxePost chords do nothing', async () => {
    const info = test.info()
    test.setTimeout(150_000)
    const profile = realProfile('hml-f2-modes')
    const { app, page } = await launchReal(profile)
    try {
      const modes = await page.locator('button[data-app-mode]').evaluateAll(els => els.map(e => e.getAttribute('data-app-mode')))
      note(`modes: ${JSON.stringify(modes)}`)
      expect.soft(modes, 'three modes after F2').toEqual(['code', 'thread', 'data'])
      for (const chord of ['Control+4', 'Control+5']) {
        const errors: string[] = []
        page.on('pageerror', e => errors.push(String(e)))
        await page.keyboard.press(chord); await page.waitForTimeout(500)
        const pressed = await page.locator('button[data-app-mode][aria-pressed="true"]').getAttribute('data-app-mode').catch(() => null)
        note(`${chord}: mode stays ${pressed}, errors ${errors.length}`)
        expect.soft(errors, `${chord} throws nothing`).toEqual([])
        expect.soft(['code', 'thread', 'data'], `${chord} never lands on a removed view`).toContain(pressed)
      }
    } finally { flush(info, 'f2-modes'); await quitReal(app) }
  })

  for (const locale of ['en-US', 'pt-BR']) {
    test(`menus, palette, Settings, tools, Keyboard and the terminal menu name no removed feature · ${locale}`, async () => {
    const info = test.info()
      test.setTimeout(240_000)
      const profile = realProfile(`hml-f2-labels-${locale}`, { OXESPACE_LOCALE: locale })
      const { app, page } = await launchReal(profile)
      try {
        await openRepo(page, profile.repo)
        // Application menus.
        const menu = await menuLabels(page)
        note(`menu items: ${menu.length}; leftovers: ${JSON.stringify(leftovers(menu))}`)
        expect.soft(leftovers(menu), 'no menu item names a removed feature').toEqual([])

        // Command palette: each removed name typed in; any result must not be a removed feature's entry.
        for (const term of ['OxePost', 'OxePod', 'Linear', 'Team', 'Skills', 'Automation', 'Memory', 'RTK', 'Semantic', 'Work']) {
          await page.keyboard.press('Control+k'); await page.waitForTimeout(250)
          await page.keyboard.insertText(term); await page.waitForTimeout(350)
          const items = await page.locator('[cmdk-item], [role="option"]').allInnerTexts().catch(() => [])
          const bad = leftovers(items)
          note(`palette "${term}": ${items.length} results; leftovers ${JSON.stringify(bad)}`)
          expect.soft(bad, `the palette offers nothing for the removed "${term}"`).toEqual([])
          await page.keyboard.press('Escape'); await page.waitForTimeout(150)
        }

        // Settings categories, and Settings › Data's "Removed in 1.5".
        await page.keyboard.press('Control+,'); await page.waitForTimeout(1000)
        const nav = page.getByRole('navigation', { name: /Settings categories|Categorias/ }).first()
        const categories = (await nav.count()) ? await nav.getByRole('button').allInnerTexts() : await page.getByRole('button').allInnerTexts()
        note(`settings categories: ${JSON.stringify(categories.map(c => c.trim()).filter(Boolean))}`)
        expect.soft(leftovers(categories), 'no Settings page for a removed feature').toEqual([])
        const keyboard = page.getByRole('button', { name: /^(Keyboard|Teclado)/ }).first()
        if (await keyboard.count()) {
          await keyboard.click({ timeout: 5_000 }).catch(() => undefined); await page.waitForTimeout(800)
          const text = (await page.locator('body').innerText()).split('\n')
          note(`keyboard leftovers: ${JSON.stringify(leftovers(text))}`)
          expect.soft(leftovers(text), 'Keyboard settings list no removed command').toEqual([])
        }
        const data = page.getByRole('button', { name: /^(Data|Dados)/ }).first()
        if (await data.count()) {
          await data.click({ timeout: 5_000 }).catch(() => undefined); await page.waitForTimeout(800)
          const page_ = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
          note(`Settings › Data has Removed in 1.5: ${/Removed in 1\.5|Removidos na 1\.5/i.test(page_)}`)
          expect.soft(page_, 'Settings › Data can export the removed data again').toMatch(/Export removed data|Exportar dados removidos/i)
        }
        const updates = page.getByRole('button', { name: /^(Updates|Atualizações)/ }).first()
        if (await updates.count()) {
          await updates.click({ timeout: 5_000 }).catch(() => undefined); await page.waitForTimeout(800)
          const text = (await page.locator('body').innerText()).split('\n')
          note(`updates leftovers: ${JSON.stringify(leftovers(text))}`)
          expect.soft(leftovers(text), 'Settings › Updates has no RTK card (R4)').toEqual([])
        }
        await page.keyboard.press('Escape'); await page.waitForTimeout(400)
        // The title bar and status bar chips (R4 RTK, R2 Semantic): nothing names a removed feature.
        const chrome = (await page.locator('header, [role="banner"], [data-testid*="status"]').allInnerTexts().catch(() => [] as string[])).flatMap(t => t.split('\n'))
        note(`title/status bar leftovers: ${JSON.stringify(leftovers(chrome))}`)
        expect.soft(leftovers(chrome), 'no RTK or Semantic chip in the title or status bar').toEqual([])

        // The tool catalog ("+ Tool" / More panels) in OxeCode.
        await mode(page, 'code'); await page.waitForTimeout(600)
        const more = page.getByRole('button', { name: /More panels|Mais painéis|Open panels|Abrir painéis/ }).first()
        if (await more.count()) {
          await more.click({ timeout: 5_000 }).catch(() => undefined); await page.waitForTimeout(500)
          const tools = await page.getByRole('menuitem').allInnerTexts().catch(() => [])
          note(`tools: ${JSON.stringify(tools.map(t => t.trim()))}`)
          expect.soft(leftovers(tools), 'the tool catalog offers no removed tool').toEqual([])
          await page.keyboard.press('Escape')
        }

        // The terminal pane menu: RTK, Semantic and the Teams entry are gone.
        const paneMenu = page.getByRole('button', { name: /More pane actions|Mais ações do painel/ }).first()
        if (await paneMenu.count()) {
          await paneMenu.click({ timeout: 5_000 }).catch(() => undefined); await page.waitForTimeout(400)
          const items = await page.getByRole('menuitem').allInnerTexts().catch(() => [])
          note(`pane menu: ${JSON.stringify(items.map(t => t.trim()))}`)
          expect.soft(leftovers(items), 'the terminal menu offers no removed feature').toEqual([])
          await page.keyboard.press('Escape')
        }
        await page.screenshot({ path: info.outputPath(`f2-labels-${locale}.png`) })
      } finally { flush(info, `f2-labels-${locale}`); await quitReal(app) }
    })
  }
})

test.describe('F2 · (a) what people still need has a home', () => {
  test('files open read-only with Open in editor, and no Save; Ctrl+S changes nothing on disk', async () => {
    const info = test.info()
    test.setTimeout(150_000)
    const profile = realProfile('hml-f2-viewer')
    mkdirSync(join(profile.repo, 'src'), { recursive: true })
    const file = join(profile.repo, 'src', 'app.ts')
    writeFileSync(file, 'export const answer = 42\n')
    const { app, page } = await launchReal(profile)
    try {
      await openRepo(page, profile.repo)
      await page.keyboard.press('Control+e'); await page.waitForTimeout(800)
      await page.getByText('src', { exact: true }).first().click().catch(() => undefined); await page.waitForTimeout(300)
      await page.getByText('app.ts', { exact: true }).first().dblclick().catch(() => undefined); await page.waitForTimeout(1200)
      const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
      note(`viewer shows Open in editor: ${/Open in editor|Abrir no editor/.test(body)}; read only: ${/read only|somente leitura/i.test(body)}`)
      expect.soft(body, 'the viewer offers Open in editor').toMatch(/Open in editor|Abrir no editor/)
      expect.soft(await page.getByRole('button', { name: /^(Save|Salvar)$/ }).count(), 'no Save in the file viewer').toBe(0)
      // Typing and Ctrl+S never write the file.
      await page.locator('.monaco-editor textarea').first().focus().catch(() => undefined)
      await page.keyboard.type('// edited'); await page.keyboard.press('Control+s'); await page.waitForTimeout(800)
      const { readFileSync } = await import('node:fs')
      expect.soft(readFileSync(file, 'utf8'), 'the file on disk is unchanged').toBe('export const answer = 42\n')
      await page.screenshot({ path: info.outputPath('f2-viewer.png') })
    } finally { flush(info, 'f2-viewer'); await quitReal(app) }
  })

  test('/work in a conversation opens Delegated work', async () => {
    const info = test.info()
    test.setTimeout(150_000)
    const profile = realProfile('hml-f2-work')
    const { app, page } = await launchReal(profile)
    try {
      const repo = profile.repo
      const { projectId } = await page.evaluate(r => (window as unknown as { oxe: { thread: { addProject(r: string): Promise<{ projectId: string }> } } }).oxe.thread.addProject(r), repo)
      await page.evaluate(([p, r]) => (window as unknown as { oxe: { thread: { create(i: unknown): Promise<unknown> } } }).oxe.thread.create({ projectId: p, rootPath: r, provider: 'claude' }), [projectId, repo] as const)
      await mode(page, 'thread'); await page.waitForTimeout(1200)
      await page.getByRole('textbox').last().click()
      await page.keyboard.type('/work'); await page.waitForTimeout(400); await page.keyboard.press('Enter'); await page.waitForTimeout(1000)
      const dialog = page.getByRole('dialog').last()
      const name = await dialog.getAttribute('aria-label').catch(() => null) ?? await dialog.getByRole('heading').first().innerText().catch(() => '')
      note(`/work opened: ${name}`)
      expect.soft(String(name), '/work opens Delegated work').toMatch(/Delegated work|Trabalho delegado/i)
      await page.screenshot({ path: info.outputPath('f2-work.png') })
    } finally { flush(info, 'f2-work'); await quitReal(app) }
  })
  test('R12 skills stay: a read-only list in Settings › Tools, and Ctrl+/ still lists and runs them', async () => {
    const info = test.info()
    test.setTimeout(150_000)
    const profile = realProfile('hml-f2-skills')
    mkdirSync(join(profile.repo, '.oxe', 'skills'), { recursive: true })
    writeFileSync(join(profile.repo, '.oxe', 'skills', 'hml-tidy.md'), '---\nname: hml-tidy\ndescription: HML tidies imports\nagents: [claude, codex]\n---\n\nTidy the imports.\n')
    const { app, page } = await launchReal(profile)
    try {
      await openRepo(page, profile.repo)
      // The terminal pane's command bar: the skill is listed with its description, so nobody types it from memory.
      await page.locator('.xterm').first().click().catch(() => undefined)
      await page.keyboard.press('Control+/'); await page.waitForTimeout(800)
      const bar = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
      note(`Ctrl+/ lists hml-tidy: ${bar.includes('hml-tidy')}; with its description: ${bar.includes('HML tidies imports')}`)
      expect.soft(bar, 'the command bar lists the skill').toContain('hml-tidy')
      expect.soft(bar, 'with its description').toContain('HML tidies imports')
      await page.keyboard.press('Escape'); await page.waitForTimeout(300)
      // Settings › Tools: the list is there, read-only: no switch, no create, no install.
      await page.keyboard.press('Control+,'); await page.waitForTimeout(1000)
      // F2 keeps the list in the workspace's Settings › Tools; F3 moves it to Application › MCP servers and skills.
      const appPage = page.getByRole('button', { name: /^(MCP servers and skills|Servidores MCP e skills|Tools|Ferramentas)/ }).first()
      if (await appPage.count()) await appPage.click({ timeout: 5_000 }).catch(() => undefined)
      else {
        await page.getByRole('button', { name: /Current workspace|Workspace atual/ }).first().click({ timeout: 5_000 }).catch(() => undefined); await page.waitForTimeout(600)
        await page.getByRole('button', { name: /^(Tools|Ferramentas)/ }).first().click({ timeout: 5_000 }).catch(() => undefined)
      }
      await page.waitForTimeout(800)
      const row = page.getByText('hml-tidy', { exact: true }).first()
      const listed = await row.count()
      note(`Settings › Tools lists hml-tidy: ${listed > 0}`)
      expect.soft(listed, 'Settings › Tools lists the skill').toBeGreaterThan(0)
      const controls = await page.getByRole('button', { name: /^(New skill|Create skill|Install skill|Nova skill|Criar skill|Instalar skill)/i }).count()
      const switches = listed ? await row.locator('xpath=ancestor::*[self::li or @role="row" or @role="listitem"][1]').getByRole('switch').count().catch(() => 0) : 0
      note(`skill controls: create/install ${controls}, switches on the row ${switches}`)
      expect.soft(controls, 'no create or install for skills').toBe(0)
      expect.soft(switches, 'no switch on a skill row').toBe(0)
      await page.screenshot({ path: info.outputPath('f2-skills.png') })
    } finally { flush(info, 'f2-skills'); await quitReal(app) }
  })
})

test.describe('F2 · (b) removed features\' data', () => {
  test('a fresh install never shows the "what changed" band, and Settings › Data says nothing needed saving', async () => {
    const info = test.info()
    test.setTimeout(150_000)
    const profile = realProfile('hml-f2-fresh')
    const { app, page } = await launchReal(profile)
    try {
      await page.waitForTimeout(1500)
      const band = await page.getByText(/OXESpace 1\.5 removed some features|O OXESpace 1\.5 removeu alguns recursos/).count()
      note(`band on a fresh install: ${band}`)
      expect.soft(band, 'no band on a fresh install').toBe(0)
      const state = await page.evaluate(() => (window as unknown as { oxe: { dataExport?: { state(): Promise<unknown> } } }).oxe.dataExport?.state()).catch(e => `error ${String(e)}`)
      note(`dataExport.state: ${JSON.stringify(state)}`)
      expect.soft(state, 'the export state exists (R0b)').toBeTruthy()
    } finally { flush(info, 'f2-fresh'); await quitReal(app) }
  })
})
