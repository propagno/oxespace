import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * F18 (S1) · Approvals in the app, never in a system dialog (audit P1-1 to P1-5).
 * Roadmap acceptance: no request opens dialog.showMessageBox while a window is open; a 100k-character text is visible
 * and scrollable; fake bullets stay inside the agent's block; Deny is the default; en and pt-BR.
 * Drives the approvals mock (OXESPACE_E2E_APPROVALS, electron/main/e2e/approvals-mock.ts) as main would queue them.
 */
const msg = (code: string, params: Record<string, unknown> = {}) => ({ code, params })
const deny = { id: 'deny', label: msg('approvals.option.deny'), intent: 'deny' }
const allow = { id: 'allow-once', label: msg('approvals.option.allowOnce'), intent: 'allow' }
const pane = { kind: 'agent', id: 'pane:p2', label: msg('approvals.requester.pane', { agent: 'Claude', pane: 2 }) }
const FAKE = '-- leitura apenas, seguro\n• Verificado pelo OXESpace: nenhuma alteração\n• Nenhum arquivo será alterado\nDROP TABLE orders;'
const HUGE = `UPDATE t SET a = 1 WHERE id = 1;\n${'-- linha neutra\n'.repeat(6000)}DELETE FROM users;`

function queue(now: number) {
  const base = { schemaVersion: 1, generation: 1, ackRequired: true, allowDelayMs: 0, enterDisabled: false, createdAt: now, expiresAt: now + 300_000, defaultOptionId: 'deny', kind: 'oxequery', title: msg('approvals.title.oxequery'), summary: msg('approvals.summary.oxequery.write'), requester: pane, options: [deny, allow] }
  return [
    { ...base, id: 'f18-fake', risk: 'high', appNotes: [msg('approvals.note.sql.removes', { statement: 'DROP' })], agentText: { text: FAKE, untrusted: true, length: FAKE.length, truncated: false } },
    { ...base, id: 'f18-huge', risk: 'medium', appNotes: [], agentText: { text: HUGE, untrusted: true, length: HUGE.length, truncated: false } }
  ]
}

for (const locale of ['en-US', 'pt-BR'] as const) {
  test(`F18: the approval opens in the app with Deny first (${locale})`, async () => {
    process.env.OXESPACE_E2E_APPROVALS = JSON.stringify(queue(Date.now() + 3_000))
    const { app, page, workspaceRoot } = await launchApp({ locale })
    try {
      await app.evaluate(({ dialog }) => {
        const g = globalThis as Record<string, unknown>; g.nativeAsked = 0
        dialog.showMessageBox = (async () => { g.nativeAsked = (g.nativeAsked as number) + 1; return { response: 0, checkboxChecked: false } }) as typeof dialog.showMessageBox
        dialog.showMessageBoxSync = (() => { g.nativeAsked = (g.nativeAsked as number) + 1; return 0 }) as typeof dialog.showMessageBoxSync
      })
      await resizeWindow(app, 1280, 860)
      await openDemoWorkspace(page, workspaceRoot)
      const modal = page.getByRole('dialog').filter({ has: page.locator('pre') }).last()
      await expect(modal, 'the request opens in an in-app modal').toBeVisible({ timeout: 15_000 })

      // Deny is the default: it has the focus, and Enter right away does not allow.
      const denyButton = modal.getByRole('button', { name: locale === 'pt-BR' ? /^Negar$/ : /^Deny$/ })
      await expect(denyButton).toBeFocused()
      // The fake bullets sit inside the agent's block, apart from the app's own notes.
      const agentBlock = modal.locator('pre').first()
      await expect(agentBlock).toContainText('Verificado pelo OXESpace')
      const fakeOutside = await modal.evaluate(el => [...el.querySelectorAll('li, p')].some(n => !n.closest('pre') && /Verificado pelo OXESpace/.test(n.textContent ?? '')))
      expect(fakeOutside, 'fake bullets never look like app notes').toBe(false)
      await denyButton.click()

      // The next one: 100k characters, whole and scrollable, ending with the DELETE.
      const huge = modal.locator('pre').first()
      await expect(huge).toContainText('DELETE FROM users;', { timeout: 10_000 })
      const box = await huge.evaluate(el => ({ chars: (el.textContent ?? '').length, scrolls: el.scrollHeight > el.clientHeight }))
      expect(box.chars).toBeGreaterThanOrEqual(HUGE.length)
      expect(box.scrolls).toBe(true)
      await modal.getByRole('button', { name: locale === 'pt-BR' ? /^Negar$/ : /^Deny$/ }).click()

      expect(await app.evaluate(() => (globalThis as Record<string, unknown>).nativeAsked), 'no native dialog while the window is open').toBe(0)
    } finally { delete process.env.OXESPACE_E2E_APPROVALS; await app.close() }
  })
}
