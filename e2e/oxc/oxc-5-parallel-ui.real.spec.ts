// Frozen end-to-end acceptance spec of OxeChat F4 (OXE program oxespace-152-chat, phase F4, Jira OXE-170), written by the
// planner; the executor does not edit it. User rule of 15/11: "o design está sendo melhorado 100% o backend deve
// acompanhar": each card has one CA in the BUILT app with real services (e2e/oxc/oxc-real.ts: the real main process and
// database, a temp git repository, the stand-in claude on PATH; no fixture, no paid run). Linux only (the stand-in is a
// script). A real parallel chat (createChat) is a one-line child row under its conversation, and it is still there, in its place, after the app restarts.
import { expect, test } from '@playwright/test'
import { conversationIn, launchOxeChat, openInOxeChat, oxe, send } from './oxc-real'

test.skip(process.platform === 'win32', 'the stand-in agent is a script; on Windows the app launches only a native .exe')

test('OXE-170 (A15, e2e): a real parallel chat is a one-line child row and survives a restart', async () => {
  test.setTimeout(300_000)
  const chat = await launchOxeChat('oxc5')
  try {
    const { id } = await conversationIn(chat, 'read-only')
    chat.scenario([])
    await send(chat, id, 'Main conversation')
    const child = (await oxe<{ thread: { id: string } }>(chat.page, 'thread.createChat', id, { provider: 'claude' })).thread.id
    await send(chat, child, 'Parallel attempt')
    const check = async (): Promise<void> => {
      await openInOxeChat(chat, 'Main conversation')
      const rows = chat.page.locator('[aria-label="OxeChat sidebar"] [data-ui="sidebar-row"]')
      const parent = rows.filter({ hasText: 'Main conversation' }).first()
      const childRow = rows.filter({ hasText: 'Parallel attempt' }).first()
      await expect(childRow).toHaveAttribute('data-lines', '1', { timeout: 30_000 })
      await expect(parent).toHaveAttribute('data-lines', '2')
      const order = await rows.evaluateAll(list => list.map(row => row.textContent ?? ''))
      const at = order.findIndex(text => text.includes('Main conversation'))
      expect(order[at + 1] ?? '', 'the child comes right after its parent').toContain('Parallel attempt')
    }
    await check()
    await chat.restart()
    await check()
  } finally { await chat.close() }
})
