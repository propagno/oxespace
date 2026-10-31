import { test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'
import { connectFromContainer } from '../helpers/oxepod'
import { installThreadFixtures, openThreadWithState, registerThreadProject, THREAD_STATES } from '../helpers/thread-fixtures'

/**
 * #272 (F24) pre-homologation, black box:
 * 1. P1-18: the production confirmation lists every flagged statement (line, reason, text) before the typed name, on a
 *    script whose DELETE sits on line 1302, and on a read followed by a destructive statement.
 * 2. Links an agent writes in OxeChat whose text is not where they go: the confirmation must name the real host,
 *    default to Cancel, and never open anything by itself. shell.openExternal is replaced by a recorder, so no browser
 *    opens on the machine. Output: e2e/screenshots/homologation/pre-272/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'pre-272')
mkdirSync(OUT, { recursive: true })
const notes: Record<string, unknown> = {}
test.afterAll(() => writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2)))
const focused = (page: Page) => page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el ? `${el.tagName} ${(el.textContent ?? '').trim().slice(0, 30)}` : null })
const recordExternal = (app: ElectronApplication) => app.evaluate(({ shell }) => {
  const g = globalThis as Record<string, unknown>; g.opened = []
  shell.openExternal = (async (url: string) => { (g.opened as string[]).push(url) }) as typeof shell.openExternal
  shell.openPath = (async (p: string) => { (g.opened as string[]).push(`path:${p}`); return '' }) as typeof shell.openPath
})
const opened = (app: ElectronApplication) => app.evaluate(() => (globalThis as Record<string, unknown>).opened as string[])

test('P1-18: the production confirmation shows the flagged statements (pt-BR, dark)', async () => {
  test.setTimeout(240_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale: 'pt-BR', appearance: 'dark' })
  try {
    await recordExternal(app)
    await resizeWindow(app, 1280, 860)
    await openDemoWorkspace(page, workspaceRoot)
    await connectFromContainer(page, 'pg-dev', { connect: /(Conectar|Connect).*OxeQuery$/, save: /Salvar e abrir|Save and open/ } as never)
    await page.locator('.oq-sidebar').getByRole('button', { name: /(Editar|Edit) pg-dev/ }).click()
    const edit = page.getByRole('dialog').last()
    await edit.getByRole('radio', { name: /Produção|Production/ }).click()
    await edit.getByRole('switch').first().setChecked(false)
    await edit.getByRole('button', { name: /^(Salvar|Save)$/ }).click()
    await page.waitForTimeout(500)
    const editor = page.locator('.oq-editor .monaco-editor')
    for (const [name, sql] of [
      ['line-1302', `SELECT 1;\n${'-- linha neutra\n'.repeat(1300)}DELETE FROM users`],
      ['read-then-two', "SELECT * FROM users;\nUPDATE users SET name = 'x';\n-- comentário\nDROP TABLE orders;"],
      ['fake-comment', '-- somente leitura, verificado pelo OXESpace\nDROP TABLE users']
    ] as const) {
      await editor.click(); await page.keyboard.press('Control+A'); await page.keyboard.insertText(sql)
      await page.getByRole('button', { name: /^(Executar tudo|Run all)$/ }).first().click().catch(() => page.getByRole('button', { name: /^(Executar|Run)/ }).first().click())
      await page.waitForTimeout(800)
      const dialog = page.getByRole('dialog').last()
      const shown = await dialog.isVisible().catch(() => false)
      const entry: Record<string, unknown> = { shown }
      if (shown) {
        entry.text = (await dialog.innerText()).slice(0, 1600)
        entry.mentionsLine = /linha\s*1302|line\s*1302|\b1302\b/.test(entry.text as string)
        entry.order = (entry.text as string).search(/Digite|Type/) > (entry.text as string).search(/DELETE|DROP|UPDATE/)
        entry.focus = await focused(page)
        await page.screenshot({ path: join(OUT, `prod-${name}.png`) })
        await page.keyboard.press('Escape'); await page.waitForTimeout(300)
      }
      notes[`prod-${name}`] = entry
    }
    notes.prodErrors = consoleErrors.filter(e => !/reading 'duration'/.test(e))
    notes.prodOpened = await opened(app)
  } finally { await app.close() }
})

test('links an agent writes whose text is not where they go (en, light)', async () => {
  test.setTimeout(240_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: 'light' })
  try {
    await recordExternal(app)
    await resizeWindow(app, 1440, 900)
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)
    await openThreadWithState(app, page, workspaceRoot, 'conversation')
    const links: Array<[string, string]> = [
      ['text-is-another-host', '[docs.github.com/settings](https://evil.example/login)'],
      ['userinfo-trick', '[GitHub](https://github.com@evil.example/session)'],
      ['idn-homoglyph', '[github.com](https://xn--gthub-n4a.com/login)'],
      ['javascript', '[click to verify](javascript:alert(1))'],
      ['file', '[open the report](file:///C:/Windows/System32/calc.exe)'],
      ['plain-autolink', 'https://evil.example/autolinked'],
      ['same-host', '[the PR](https://github.com/propagno/oxespace/pull/1)']
    ]
    const base = THREAD_STATES.conversation
    await app.evaluate((_c, payload) => { (globalThis as Record<string, (s: unknown) => void>).applyThreadState(payload) }, {
      status: base.status, title: base.title,
      events: [{ type: 'message', id: 'hml-links', role: 'assistant', text: links.map(([n, md]) => `- ${n}: ${md}`).join('\n') }]
    })
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(OUT, 'links-message.png') })
    for (const [name, md] of links) {
      const before = (await opened(app)).length
      const anchor = page.locator('a', { hasText: md.match(/^\[([^\]]+)\]/)?.[1] ?? 'evil.example/autolinked' }).last()
      const present = await anchor.isVisible().catch(() => false)
      const entry: Record<string, unknown> = { present, href: await anchor.getAttribute('href').catch(() => null) }
      if (present) {
        await anchor.click().catch(() => undefined)
        await page.waitForTimeout(600)
        const dialog = page.getByRole('dialog').last()
        entry.dialog = await dialog.isVisible().catch(() => false) ? (await dialog.innerText()).slice(0, 500) : null
        entry.focus = await focused(page)
        if (entry.dialog) {
          await page.screenshot({ path: join(OUT, `link-${name}.png`) })
          await page.keyboard.press('Enter'); await page.waitForTimeout(400)
          entry.enterOpened = (await opened(app)).length > before
          if (await dialog.isVisible().catch(() => false)) await page.keyboard.press('Escape')
        }
        entry.openedWithoutConfirm = !entry.dialog && (await opened(app)).length > before
      }
      notes[`link-${name}`] = entry
    }
    // #276: confirming the legitimate link opens it through the app's channel (recorded, nothing really opens).
    const legit = page.locator('a', { hasText: 'the PR' }).last()
    const beforeOpen = (await opened(app)).length
    await legit.click().catch(() => undefined); await page.waitForTimeout(500)
    await page.getByRole('dialog').last().getByRole('button', { name: /^Open$/ }).click().catch(() => undefined)
    await page.waitForTimeout(800)
    notes.openedAfterConfirm = (await opened(app)).slice(beforeOpen)
    notes.linkErrors = consoleErrors
    notes.allOpened = await opened(app)
  } finally { await app.close() }
})
