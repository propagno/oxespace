import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * HML · 1.5.0 F3 (DESIGN's 1.5.0-f3-design.md U3.1–U3.5; BACKEND's H1/H2/A10, #695), black box on the REAL app.
 * Red until F3 lands.
 *
 * The real capture path, with no agent and no account: every shell pane carries the agent hook port and its execution
 * token (terminal.service executionEnvironment), so the pane runs the app's own resources/agent-hooks/
 * oxespace-status-hook.cjs on hand-written Claude Code PreToolUse/PostToolUse events, exactly what Claude Code would pipe
 * into it during a turn. The commands in the events are never executed: nothing leaves the runner.
 *
 * Seeded secrets (SEED_*) go into headers, the query, userinfo, the body and the output; none may reach the screen, the
 * HTTP rows, Agent activity or any plain file of the profile.
 */
const SEED = { header: 'SEEDHDR7c1e9a', query: 'SEEDQRY4b2f0d', userinfo: 'SEEDUSR93ad21', body: 'SEEDBDY5e6c11', out: 'SEEDOUT0f8b77', err: 'SEEDERR2a4c90' }
const HOOK = join(process.cwd(), 'resources', 'agent-hooks', 'oxespace-status-hook.cjs')

const notes: string[] = []
const note = (line: string) => { notes.push(line); console.log('HML', line) }
const flush = (name: string) => { const info = test.info(); writeFileSync(info.outputPath(`${name}.txt`), notes.join('\n')); info.annotations.push({ type: name, description: notes.join('\n') }); notes.length = 0 }

/** One Bash tool call as Claude Code hands it to its hooks: the PreToolUse, then the PostToolUse with the output. */
function bashCall(id: string, command: string, stdout: string, stderr = '') {
  const base = { session_id: 'hml-f3-session', transcript_path: '/dev/null', cwd: '/tmp', tool_name: 'Bash', tool_input: { command, description: 'HML F3' }, tool_use_id: id }
  return [
    { ...base, hook_event_name: 'PreToolUse' },
    { ...base, hook_event_name: 'PostToolUse', tool_response: { stdout, stderr, interrupted: false, isImage: false } }
  ]
}

/** Writes each event to a file outside the profile and pipes it, in order, through the real hook script in the pane. */
async function sendThroughPane(page: Page, events: unknown[], dir: string, agent: 'claude' | 'codex' = 'claude'): Promise<void> {
  const files = events.map((event, i) => { const f = join(dir, `ev-${Date.now()}-${i}.json`); writeFileSync(f, typeof event === 'string' ? event : JSON.stringify(event)); return f })
  await page.locator('.xterm').first().click()
  for (const f of files) {
    await page.keyboard.type(`node '${HOOK}' ${agent} < '${f}'; echo HML-HOOK-EXIT=$?`)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
  }
  await page.waitForTimeout(1_500)
}
const terminalText = (page: Page) => page.locator('.xterm-rows').first().innerText().catch(() => '')
const bodyText = async (page: Page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ')

/** The HTTP calls panel, from the OxeCode tool catalog, by role and name. */
async function openHttpPanel(page: Page): Promise<boolean> {
  const more = page.getByRole('button', { name: /More panels|Mais painéis|Open panels|Abrir painéis/ }).first()
  if (await more.count()) { await more.click({ timeout: 5_000 }).catch(() => undefined); await page.waitForTimeout(400) }
  const item = page.getByRole('menuitem', { name: /HTTP calls|Chamadas HTTP/ }).first()
  if (!(await item.count())) { await page.keyboard.press('Escape'); return false }
  await item.click({ timeout: 5_000 }).catch(() => undefined); await page.waitForTimeout(800)
  return true
}

function scanForSeeds(root: string): string[] {
  const hits: string[] = []
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n); const st = statSync(p)
      if (st.isDirectory()) { if (n !== 'repo' && !/Cache/.test(n)) walk(p) } else if (st.size < 50_000_000) {
        const raw = readFileSync(p)
        for (const [k, v] of Object.entries(SEED)) if (raw.includes(v)) hits.push(`${p.slice(root.length)}: ${k}`)
      }
    }
  }
  walk(root)
  return hits
}

test.describe('F3 · the agents\' HTTP calls, captured by the real hook in a real pane', () => {
  test('U3.2/A59: calls appear masked, Errors and Flagged filter, Agent activity shows the same rows, and no secret is stored or shown', async () => {
    test.setTimeout(240_000)
    const events = mkdtempSync(join(tmpdir(), 'hml-f3-events-'))
    const profile = realProfile('hml-f3-http')
    const { app, page } = await launchReal(profile)
    try {
      await openRepo(page, profile.repo)
      await sendThroughPane(page, [
        ...bashCall('toolu_hml_1', `curl -s -i -X POST 'https://api.hml-f3.test/v1/charges/123?token=${SEED.query}&page=2' -H 'Authorization: Bearer ${SEED.header}' -d '{"pw":"${SEED.body}"}'`, `HTTP/2 201\r\ncontent-type: application/json\r\n\r\n{"id":"ch_1","note":"${SEED.out}"}`, SEED.err),
        ...bashCall('toolu_hml_2', 'curl -k -s -i http://example.org/missing', 'HTTP/1.1 404 Not Found\r\n\r\nnope'),
        ...bashCall('toolu_hml_3', `curl -s https://deploy:${SEED.userinfo}@api.hml-f3.test/v1/deploys/550e8400-e29b-41d4-a716-446655440000`, '{"ok":true}'),
        ...bashCall('toolu_hml_4', 'git status && npm test', 'nothing to commit')
      ], events)
      const term = await terminalText(page)
      const exits = [...term.matchAll(/HML-HOOK-EXIT=(\d+)/g)].map(m => m[1])
      note(`hook exits: ${JSON.stringify(exits)}`)
      expect.soft(exits.length, 'every event went through the hook').toBeGreaterThanOrEqual(8)
      expect.soft(exits.every(e => e === '0'), 'the hook always exits 0').toBe(true)

      const opened = await openHttpPanel(page)
      note(`HTTP calls panel opened: ${opened}`)
      expect(opened, 'Tools › HTTP calls exists in OxeCode').toBe(true)
      const panel = await bodyText(page)
      expect.soft(panel, 'the host group').toContain('api.hml-f3.test')
      expect.soft(panel, 'the path template').toContain('/v1/charges/:id')
      expect.soft(panel, 'a UUID becomes :id').toContain('/v1/deploys/:id')
      expect.soft(panel, 'the status').toMatch(/\b201\b/)
      expect.soft(panel, 'plain http to an outside host is flagged').toMatch(/Not encrypted|Sem criptografia/)
      expect.soft(panel, '-k is flagged').toMatch(/TLS not checked|TLS não verificado/)
      expect.soft(panel, 'the non-HTTP command adds nothing').not.toContain('npm test')
      for (const word of ['Block', 'Allow', 'Bloquear', 'Permitir']) expect.soft(await page.getByRole('button', { name: new RegExp(`^${word}`) }).count(), `no ${word} control in F3`).toBe(0)

      // The POST row by its accessible name, then its detail.
      const post = page.getByRole('button', { name: /POST \/v1\/charges\/:id, 201/ }).first()
      await post.click({ timeout: 10_000 }).catch(() => undefined); await page.waitForTimeout(500)
      const detail = await bodyText(page)
      note(`detail excerpt: ${detail.slice(detail.indexOf('POST'), detail.indexOf('POST') + 300)}`)
      expect.soft(detail, 'Authorization is masked').toContain('•••• (Authorization)')
      expect.soft(detail, 'the body size, never its content').toMatch(/Body:? ?\S* ?·? ?\d+ ?B|Corpo/)
      expect.soft(detail, 'response with the duration').toMatch(/201 · \d+ ms/)

      // Errors: no status or >= 400. Flagged: production or insecure. The filter: host or path.
      await page.getByRole('button', { name: /^(Errors|Erros)$/ }).first().click({ timeout: 5_000 }).catch(() => undefined); await page.waitForTimeout(500)
      const errors = await page.getByRole('button', { name: /^(GET|POST|PUT|DELETE|PATCH) / }).allInnerTexts()
      note(`Errors rows: ${JSON.stringify(errors)}`)
      expect.soft(errors.length > 0 && errors.every(r => /404|No status|Sem status/.test(r)), 'Errors lists only 404 / no status').toBe(true)
      await page.getByRole('button', { name: /^(Flagged|Sinalizadas)$/ }).first().click({ timeout: 5_000 }).catch(() => undefined); await page.waitForTimeout(500)
      const flagged = await page.getByRole('button', { name: /^(GET|POST|PUT|DELETE|PATCH) / }).allInnerTexts()
      note(`Flagged rows: ${JSON.stringify(flagged)}`)
      expect.soft(flagged.length, 'Flagged lists the -k call only').toBe(1)
      await page.getByRole('button', { name: /^(All|Todas)$/ }).first().click({ timeout: 5_000 }).catch(() => undefined)
      await page.getByRole('textbox', { name: /Filter by host or path|Filtrar por host ou caminho/ }).first().fill('deploys').catch(() => undefined); await page.waitForTimeout(500)
      const filtered = await page.getByRole('button', { name: /^(GET|POST|PUT|DELETE|PATCH) / }).allInnerTexts()
      expect.soft(filtered.length, 'the filter matches the path').toBe(1)
      await page.screenshot({ path: test.info().outputPath('f3-http.png') })

      // Agent activity › HTTP: the same calls, a row opens the detail modal by keyboard, Esc gives focus back.
      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+,'); await page.waitForTimeout(800)
      await page.getByRole('button', { name: /^(Agent activity|Atividade dos agentes)$/ }).first().click({ timeout: 5_000 }).catch(() => undefined); await page.waitForTimeout(800)
      await page.getByRole('button', { name: /^HTTP/ }).first().click({ timeout: 5_000 }).catch(() => undefined); await page.waitForTimeout(800)
      const activity = await bodyText(page)
      expect.soft(activity, 'Agent activity lists the POST').toMatch(/POST api\.hml-f3\.test\/v1\/charges\/:id/)
      const row = page.getByRole('row').filter({ hasText: /charges/ }).first()
      await row.focus().catch(() => undefined); await page.keyboard.press('Enter'); await page.waitForTimeout(600)
      const modal = page.getByRole('dialog').last()
      expect.soft(await modal.isVisible().catch(() => false), 'Enter opens the detail modal').toBe(true)
      expect.soft(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), 'focus is inside the modal').toBe(true)
      await page.keyboard.press('Escape'); await page.waitForTimeout(300)
      expect.soft(await page.evaluate(() => document.activeElement?.getAttribute('role') ?? document.activeElement?.tagName), 'focus is back on the row').toMatch(/row|TR/)
      await page.screenshot({ path: test.info().outputPath('f3-activity.png') })

      const everything = await bodyText(page)
      for (const [k, v] of Object.entries(SEED)) expect.soft(everything.includes(v) || panel.includes(v) || detail.includes(v), `${k} is on no screen`).toBe(false)
    } finally {
      flush('f3-http')
      await quitReal(app)
      const hits = scanForSeeds(profile.root)
      console.log('HML seeds in profile files:', JSON.stringify(hits))
      expect.soft(hits, 'no seeded secret in any plain file of the profile').toEqual([])
    }
  })

  test('U3.5/A58: 6 MiB of output still makes a row with its status and a visible cut; a 9 MiB or broken event never breaks the pane', async () => {
    test.setTimeout(240_000)
    const events = mkdtempSync(join(tmpdir(), 'hml-f3-big-'))
    const profile = realProfile('hml-f3-cut')
    const { app, page } = await launchReal(profile)
    try {
      await openRepo(page, profile.repo)
      const big = 'HTTP/1.1 200 OK\r\n\r\n' + 'x'.repeat(6 * 1024 * 1024)
      const huge = 'y'.repeat(9 * 1024 * 1024)
      await sendThroughPane(page, [
        ...bashCall('toolu_hml_big', 'curl -s -i https://files.hml-f3.test/dump', big),
        ...bashCall('toolu_hml_huge', 'curl -s https://files.hml-f3.test/huge', huge),
        '{"hook_event_name":"PostToolUse","tool_name":"Bash", broken'
      ], events)
      const term = await terminalText(page)
      const exits = [...term.matchAll(/HML-HOOK-EXIT=(\d+)/g)].map(m => m[1])
      note(`hook exits: ${JSON.stringify(exits)}`)
      expect.soft(exits.length >= 5 && exits.every(e => e === '0'), 'the hook exits 0 on 6 MiB, 9 MiB and a broken event').toBe(true)
      // The pane still works.
      await page.keyboard.type('echo HML-PANE-ALIVE'); await page.keyboard.press('Enter'); await page.waitForTimeout(800)
      expect.soft(await terminalText(page), 'the pane still answers').toContain('HML-PANE-ALIVE')

      expect(await openHttpPanel(page), 'Tools › HTTP calls exists').toBe(true)
      const panel = await bodyText(page)
      expect.soft(panel, 'the 6 MiB call is listed').toContain('/dump')
      expect.soft(panel, 'the 9 MiB call is still listed').toContain('/huge')
      await page.getByRole('button', { name: /GET \/dump/ }).first().click({ timeout: 10_000 }).catch(() => undefined); await page.waitForTimeout(500)
      const detail = await bodyText(page)
      expect.soft(detail, 'its status, read from the kept head').toMatch(/\b200\b/)
      expect.soft(detail, 'the cut is said, with the full size').toMatch(/Output cut to the first 4 KB of 6(\.0)? MB|Saída cortada nos primeiros 4 KB de 6(,0)? MB/)
      const domX = await page.evaluate(() => (document.body.textContent ?? '').split('x'.repeat(1000)).length - 1)
      note(`1000-x runs in the DOM: ${domX}`)
      expect.soft(domX, 'no more than 4 KB of the output in the DOM').toBeLessThanOrEqual(4)
      await page.screenshot({ path: test.info().outputPath('f3-cut.png') })
    } finally { flush('f3-cut'); await quitReal(app) }
  })
})

test.describe('F3 · Settings after the removals (U3.4)', () => {
  test('U3.4a/c: the page list and order, no Memory, Automations or OxePost Requests, and search finds export, activity and skills', async () => {
    test.setTimeout(150_000)
    const profile = realProfile('hml-f3-settings')
    const { app, page } = await launchReal(profile)
    try {
      await openRepo(page, profile.repo)
      await page.keyboard.press('Control+,'); await page.waitForTimeout(1_000)
      const nav = page.getByRole('navigation', { name: /Settings categories|Categorias/ }).first()
      const pages = ((await nav.count()) ? await nav.getByRole('button').allInnerTexts() : []).map(t => t.trim()).filter(Boolean)
      note(`settings pages: ${JSON.stringify(pages)}`)
      const app_ = ['General', 'Appearance', 'Agents', 'Approvals and safety', 'Notifications', 'Keyboard', 'Terminal', 'MCP servers and skills', 'Phone and devices', 'Data and privacy', 'Agent activity', 'Diagnostics', 'About']
      const order = app_.map(p => pages.findIndex(x => x.startsWith(p)))
      note(`order indexes: ${JSON.stringify(order)}`)
      expect.soft(order.every(i => i >= 0), 'every Application page is there').toBe(true)
      expect.soft(order.every((v, i) => i === 0 || v > order[i - 1]), 'in DESIGN\'s order').toBe(true)
      expect.soft(pages.filter(p => /Memory|Memória|Automations|Automações|OxePost/.test(p)), 'no Memory, Automations or OxePost page').toEqual([])
      const approvals = page.getByRole('button', { name: /^Approvals and safety/ }).first()
      if (await approvals.count()) {
        await approvals.click(); await page.waitForTimeout(600)
        const text = await bodyText(page)
        expect.soft(text, 'no OxePost Requests section').not.toMatch(/OxePost|Requests section/)
        expect.soft(text, 'Network access reads "Hosts agents can call."').toContain('Hosts agents can call.')
      }
      const diagnostics = page.getByRole('button', { name: /^Diagnostics/ }).first()
      if (await diagnostics.count()) { await diagnostics.click(); await page.waitForTimeout(600); expect.soft(await bodyText(page), 'no Code search index row (R2)').not.toContain('Code search index') }
      const search = page.getByRole('searchbox').or(page.getByRole('textbox', { name: /Search settings|Buscar nas configurações/ })).first()
      for (const term of ['export', 'activity', 'skills']) {
        await search.fill(term).catch(() => undefined); await page.waitForTimeout(500)
        const found = await bodyText(page)
        const hit = term === 'export' ? /Export removed data/ : term === 'activity' ? /Agent activity/ : /skills/i
        note(`search "${term}": ${hit.test(found)}`)
        expect.soft(found, `Settings search finds "${term}"`).toMatch(hit)
      }
      await page.screenshot({ path: test.info().outputPath('f3-settings.png') })
    } finally { flush('f3-settings'); await quitReal(app) }
  })
})
