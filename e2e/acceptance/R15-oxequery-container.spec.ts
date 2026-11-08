import { expect, test } from '@playwright/test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { launchReal, mode, openRepo, quitReal, realProfile } from './real-app'

/**
 * HML · 1.5.0 F2 R15 + G5 (TECH LEAD 08/11) · With the OxePod mode gone, a person still connects OxeQuery to a database
 * container: OxeQuery › New connection › "From a running container" lists it, picking it fills host and port, the
 * person types the password, and a query runs. Main's oxepod backend stays (T17), so this must work after F2.
 *
 * Real app, real Docker, no e2e doubles: the job (.github/workflows/acceptance-containers.yml) starts a postgres
 * container bound to 127.0.0.1 and passes HML_PG_CONTAINER, HML_PG_PORT and HML_PG_PASSWORD (masked in the log, never
 * printed here). Without them the spec is skipped, so it never reaches a person's Docker.
 *
 * The picker is found by role and accessible name (button, tab, radio or combobox naming a container), not by DESIGN's
 * final copy, until that copy lands (TECH LEAD 08/11).
 */
const NAME = process.env.HML_PG_CONTAINER ?? ''
const PORT = process.env.HML_PG_PORT ?? ''
const PASSWORD = process.env.HML_PG_PASSWORD ?? ''

test.skip(!NAME || !PORT || !PASSWORD || process.env.GITHUB_ACTIONS !== 'true', 'runs only in the containers job on a CI runner, against the container it started')

test('R15/G5: OxeQuery connects to a running postgres container without the OxePod mode, and a query runs', async () => {
    const info = test.info()
  test.setTimeout(240_000)
  const notes: string[] = []
  const note = (line: string) => { notes.push(line); console.log('HML', line) }
  const profile = realProfile('hml-r15-container')
  const { app, page } = await launchReal(profile)
  try {
    await openRepo(page, profile.repo)
    const modes = await page.locator('button[data-app-mode]').evaluateAll(b => b.map(x => x.getAttribute('data-app-mode')))
    note(`modes: ${JSON.stringify(modes)}`)
    expect.soft(modes, 'the OxePod mode is gone (R15)').not.toContain('pods')

    await mode(page, 'data'); await page.waitForTimeout(1_000)
    await page.locator('[data-oq-action="newConnection"]').first().click({ timeout: 15_000 })
    const dialog = page.getByRole('dialog').last()
    await expect(dialog, 'the New connection dialog opens').toBeVisible({ timeout: 10_000 })

    // The picker (FE-G5, #696): the radio "From a running container", then the select labelled Container, whose
    // options read "<name> · <engine> · port <n>". Found by role and label, never by the wider copy.
    const picker = dialog.getByRole('radio', { name: /running container|contêiner em execução/i }).first()
    const hasPicker = await picker.count()
    note(`picker in New connection: ${hasPicker > 0}`)
    expect(hasPicker, 'OxeQuery › New connection offers "From a running container" (G5)').toBeGreaterThan(0)
    await picker.click()
    const select = dialog.getByLabel(/^(Container|Contêiner)$/).first()
    await expect.poll(async () => (await select.locator('option').allInnerTexts()).join(' | '), { timeout: 20_000, message: `the running container ${NAME} is listed` }).toContain(NAME)
    const options = await select.locator('option').allInnerTexts()
    note(`container options: ${JSON.stringify(options)}`)
    expect.soft(options.find(o => o.includes(NAME)) ?? '', 'listed as name · engine · port').toMatch(new RegExp(`${NAME} · PostgreSQL · port ${PORT}`))
    await select.selectOption({ label: options.find(o => o.includes(NAME)) as string })

    // Host and port are filled from the container; the password is the person's to type, and it has the focus.
    const password = dialog.getByLabel(/^(Password|Senha)$/).first()
    await expect.soft(dialog.getByLabel(/^(Port|Porta)$/).first(), 'the mapped port is filled in').toHaveValue(PORT, { timeout: 10_000 })
    const host = await dialog.getByLabel(/^Host$/).first().inputValue().catch(() => '')
    note(`host: ${host}`)
    expect.soft(host, 'the host is filled in').toMatch(/^(127\.0\.0\.1|localhost)$/)
    expect.soft(await password.inputValue(), 'the password is not filled in for the person').toBe('')
    await expect.soft(password, 'the empty password has the focus').toBeFocused()
    await password.fill(PASSWORD)
    await password.press('Enter')
    if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', { name: /^(Save and open|Salvar e abrir)$/ }).click({ timeout: 5_000 }).catch(() => undefined)

    // Connected: its tab opens, and a query returns a row.
    await expect(page.getByRole('tab', { name: new RegExp(NAME) }).first(), 'the connection opens').toBeVisible({ timeout: 30_000 })
    const editor = page.locator('.oq-editor .monaco-editor').locator('visible=true').first()
    await editor.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type("SELECT 'hml-r15-ok' AS answer")
    await page.keyboard.press('Control+Enter')
    await expect(page.getByText('hml-r15-ok').last(), 'the query result is shown').toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: info.outputPath('r15-container.png') })

    const body = await page.locator('body').innerText()
    expect.soft(body.includes(PASSWORD), 'the password is shown nowhere on screen').toBe(false)
  } finally {
    await quitReal(app)
    // The password is in the vault only: no plain file of the profile holds it.
    const leaks: string[] = []
    const scan = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); const st = statSync(p); if (st.isDirectory()) { if (n !== 'repo' && !/Cache/.test(n)) scan(p) } else if (st.size < 50_000_000 && readFileSync(p).includes(PASSWORD)) leaks.push(p.slice(profile.root.length)) } }
    try { scan(profile.root) } catch { /* profile gone */ }
    note(`password found in: ${JSON.stringify(leaks)}`)
    expect.soft(leaks, 'the password is in no plain file of the profile').toEqual([])
    info.annotations.push({ type: 'r15', description: notes.join('\n') })
  }
})
