// Frozen end-to-end acceptance spec of OxeChat F4 (OXE program oxespace-152-chat, phase F4, Jira OXE-167), written by the
// planner; the executor does not edit it. User rule of 15/11: "o design está sendo melhorado 100% o backend deve
// acompanhar": each card has one CA in the BUILT app with real services (e2e/oxc/oxc-real.ts: the real main process and
// database, a temp git repository, the stand-in claude on PATH; no fixture, no paid run). Linux only (the stand-in is a
// script). A real turn shows in the conversation header and column: chat-header with the chat-title, the user-message and the turn-line; a real pending command is a request-card in the column.
import { expect, test } from '@playwright/test'
import { conversationIn, launchOxeChat, openInOxeChat, pendingRequest, send } from './oxc-real'

test.skip(process.platform === 'win32', 'the stand-in agent is a script; on Windows the app launches only a native .exe')

test('OXE-167 (A11, e2e): a real turn fills the header and the column; a real request is a request-card in it', async () => {
  test.setTimeout(240_000)
  const chat = await launchOxeChat('oxc2')
  try {
    const { id } = await conversationIn(chat, 'read-only')
    chat.scenario([])
    await send(chat, id, 'Explain the login flow')
    await openInOxeChat(chat, 'Explain the login flow')
    const page = chat.page
    await expect(page.locator('[data-ui="chat-header"] [data-ui="chat-title"]')).toContainText('Explain the login flow')
    const column = page.locator('[data-ui="chat-column"]')
    await expect(column.locator('[data-ui="user-message"]').first()).toContainText('Explain the login flow')
    await expect(column.locator('[data-ui="turn-line"]').first()).toBeVisible({ timeout: 30_000 })
    chat.scenario([{ tool: 'Bash', input: { command: 'npm test' } }])
    await send(chat, id, 'Now run the tests')
    await pendingRequest(chat, id)
    await expect(column.locator('[data-ui="request-card"]').filter({ hasText: 'npm test' })).toBeVisible({ timeout: 30_000 })
  } finally { await chat.close() }
})
