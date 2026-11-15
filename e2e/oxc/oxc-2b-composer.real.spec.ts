// Frozen end-to-end acceptance spec of OxeChat F4 (OXE program oxespace-152-chat, phase F4, Jira OXE-172), written by the
// planner; the executor does not edit it. User rule of 15/11: "o design está sendo melhorado 100% o backend deve
// acompanhar": each card has one CA in the BUILT app with real services (e2e/oxc/oxc-real.ts: the real main process and
// database, a temp git repository, the stand-in claude on PATH; no fixture, no paid run). Linux only (the stand-in is a
// script). The real composer sits in the conversation column; its toolbar follows the window: full when wide, narrower when the window shrinks.
import { expect, test } from '@playwright/test'
import { conversationIn, launchOxeChat, openInOxeChat, send } from './oxc-real'

test.skip(process.platform === 'win32', 'the stand-in agent is a script; on Windows the app launches only a native .exe')

test('OXE-172 (A12, e2e): the composer is in the column and its toolbar narrows with the window', async () => {
  test.setTimeout(240_000)
  const chat = await launchOxeChat('oxc2b')
  try {
    const { id } = await conversationIn(chat, 'read-only')
    chat.scenario([])
    await send(chat, id, 'Hello composer')
    await chat.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
    await openInOxeChat(chat, 'Hello composer')
    const toolbar = chat.page.locator('[data-ui="chat-column"] [data-ui="composer"] [data-ui="composer-toolbar"]')
    await expect(toolbar).toHaveAttribute('data-width', 'full')
    await chat.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 900))
    await expect(toolbar).not.toHaveAttribute('data-width', 'full', { timeout: 10_000 })
    await expect(toolbar.getByRole('button', { name: 'Send' })).toBeVisible()
  } finally { await chat.close() }
})
