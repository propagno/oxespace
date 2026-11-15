// Frozen end-to-end acceptance spec of OxeChat F4 (OXE program oxespace-152-chat, phase F4, Jira OXE-168), written by the
// planner; the executor does not edit it. User rule of 15/11: "o design está sendo melhorado 100% o backend deve
// acompanhar": each card has one CA in the BUILT app with real services (e2e/oxc/oxc-real.ts: the real main process and
// database, a temp git repository, the stand-in claude on PATH; no fixture, no paid run). Linux only (the stand-in is a
// script). Nova conversa opens the in-place screen (no dialog); the first message creates a real conversation in the project, whose row appears in the sidebar; the person's checkout keeps its branch and HEAD.
import { expect, test } from '@playwright/test'
import { git, launchOxeChat, oxe } from './oxc-real'

test.skip(process.platform === 'win32', 'the stand-in agent is a script; on Windows the app launches only a native .exe')

test('OXE-168 (A13, e2e): a new conversation starts in place and the first message creates it, the checkout untouched', async () => {
  test.setTimeout(240_000)
  const chat = await launchOxeChat('oxc3')
  try {
    await oxe(chat.page, 'thread.addProject', chat.root)
    const before = [git(chat.root, 'rev-parse', 'HEAD'), git(chat.root, 'symbolic-ref', 'HEAD')]
    const page = chat.page
    await page.locator('button[data-app-mode="thread"]').first().click()
    await page.locator('[aria-label="OxeChat sidebar"] [data-ui="sidebar-header"]').getByRole('button', { name: /^New conversation/ }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('[data-ui="new-conversation-title"]')).toBeVisible()
    await expect(page.locator('[data-ui="starter"]')).toHaveCount(4)
    const box = page.getByRole('textbox', { name: 'Message' })
    await box.fill('Explain the repository')
    await box.press('Enter')
    await expect(page.locator('[aria-label="OxeChat sidebar"] [data-ui="sidebar-row"]').filter({ hasText: 'Explain the repository' })).toBeVisible({ timeout: 30_000 })
    const threads = await oxe<Array<{ title: string; rootPath: string }>>(page, 'thread.list')
    expect(threads.some(thread => thread.rootPath === chat.root)).toBe(true)
    expect([git(chat.root, 'rev-parse', 'HEAD'), git(chat.root, 'symbolic-ref', 'HEAD')]).toEqual(before)
  } finally { await chat.close() }
})
