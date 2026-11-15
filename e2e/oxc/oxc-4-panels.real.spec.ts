// Frozen end-to-end acceptance spec of OxeChat F4 (OXE program oxespace-152-chat, phase F4, Jira OXE-169), written by the
// planner; the executor does not edit it. User rule of 15/11: "o design está sendo melhorado 100% o backend deve
// acompanhar": each card has one CA in the BUILT app with real services (e2e/oxc/oxc-real.ts: the real main process and
// database, a temp git repository, the stand-in claude on PATH; no fixture, no paid run). Linux only (the stand-in is a
// script). The real conversation header holds the four panel toggles; Changes opens its dock panel and closes it again; no tabs row in the conversation.
import { expect, test } from '@playwright/test'
import { conversationIn, launchOxeChat, openInOxeChat, send } from './oxc-real'

test.skip(process.platform === 'win32', 'the stand-in agent is a script; on Windows the app launches only a native .exe')

test('OXE-169 (A14, e2e): four panel toggles in the header open the dock panel one at a time; no tabs row', async () => {
  test.setTimeout(240_000)
  const chat = await launchOxeChat('oxc4')
  try {
    const { id } = await conversationIn(chat, 'read-only')
    chat.scenario([])
    await send(chat, id, 'Show the panels')
    await openInOxeChat(chat, 'Show the panels')
    const page = chat.page
    const toggles = page.locator('[data-ui="chat-header"] [data-ui="panel-toggle"]')
    await expect(toggles).toHaveCount(4)
    const changes = toggles.nth(1)
    await changes.click()
    await expect(changes).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-ui="dock-panel"]')).toHaveCount(1)
    await changes.click()
    await expect(page.locator('[data-ui="dock-panel"]')).toHaveCount(0)
    await expect(page.locator('main [role="tablist"], main [data-ui="tabs"]')).toHaveCount(0)
  } finally { await chat.close() }
})
