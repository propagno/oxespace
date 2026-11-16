// Frozen end-to-end acceptance spec of OxeChat F4 (OXE program oxespace-152-chat, phase F4, Jira OXE-166), written by the
// planner; the executor does not edit it. User rule of 15/11: "o design está sendo melhorado 100% o backend deve
// acompanhar": each card has one CA in the BUILT app with real services (e2e/oxc/oxc-real.ts: the real main process and
// database, a temp git repository, the stand-in claude on PATH; no fixture, no paid run). Linux only (the stand-in is a
// script). The sidebar shows a real conversation as a two-line SidebarRow, and a real pending command as the row's mini card; Allow once answers it through respondPending and the stand-in gets the answer.
import { expect, test } from '@playwright/test'
import { conversationIn, launchOxeChat, openInOxeChat, pendingRequest, send } from './oxc-real'

test.skip(process.platform === 'win32', 'the stand-in agent is a script; on Windows the app launches only a native .exe')

test('OXE-166 (A10, e2e): a real conversation is a two-line row, and its pending command is answered from the mini card', async () => {
  test.setTimeout(240_000)
  const chat = await launchOxeChat('oxc1')
  try {
    const { id } = await conversationIn(chat, 'read-only')
    chat.scenario([{ tool: 'Bash', input: { command: 'npm run migrate -- --env staging' } }])
    await send(chat, id, 'Run the migration')
    await pendingRequest(chat, id)
    await openInOxeChat(chat, 'Run the migration')
    const sidebar = chat.page.locator('[aria-label="OxeChat sidebar"]')
    const row = sidebar.locator('[data-ui="sidebar-row"]').filter({ hasText: 'Run the migration' }).first()
    await expect(row).toHaveAttribute('data-lines', '2')
    await expect(row.locator('[data-ui="row-title"]')).toContainText('Run the migration')
    const card = sidebar.locator('[data-ui="row-attention"]').filter({ hasText: 'npm run migrate' })
    await expect(card).toBeVisible({ timeout: 30_000 })
    await card.getByRole('button', { name: 'Allow once' }).click()
    await expect.poll(() => chat.log().some(entry => entry.event === 'answer' && entry.tool === 'Bash' && entry.behavior === 'allow'), { timeout: 30_000 }).toBe(true)
    await expect(sidebar.locator('button:not([data-ui])')).toHaveCount(0)
  } finally { await chat.close() }
})
