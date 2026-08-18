import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * #10 · Rich previews: rendered Markdown, image viewer and PDF inside the editor pane.
 * Uses the E2E mock native so it does not need the node-pty/sqlite ABI.
 */
test('preview: markdown, image and pdf render in the editor pane', async () => {
  test.setTimeout(60_000)
  const testRoot = join(tmpdir(), `oxespace-preview-${Date.now()}`)
  const workspaceRoot = join(testRoot, 'repo')
  mkdirSync(workspaceRoot, { recursive: true })

  writeFileSync(
    join(workspaceRoot, 'NOTES.md'),
    ['# Preview heading', '', 'Some **bold** text and a `code span`.', '', '| a | b |', '| - | - |', '| 1 | 2 |', ''].join('\n')
  )
  // 1x1 red PNG.
  writeFileSync(
    join(workspaceRoot, 'dot.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
  )

  // Minimal one-page PDF with a text run.
  writeFileSync(
    join(workspaceRoot, 'sample.pdf'),
    Buffer.from(
      'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNTEgPj4Kc3RyZWFtCkJUIC9GMSAzNiBUZiA2MCA3MDAgVGQgKE9YRVNwYWNlIFBERiBwcmV2aWV3KSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwMzExIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDEyCiUlRU9GCg==',
      'base64'
    )
  )

  const electronApp = await electron.launch({
    args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: {
      ...process.env,
      OXESPACE_DISABLE_SINGLE_INSTANCE: '1',
      OXESPACE_E2E_MOCK_NATIVE: '1',
      OXESPACE_DB_PATH: join(testRoot, 'oxespace.sqlite3')
    }
  })

  try {
    const page = await electronApp.firstWindow()
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(workspaceRoot)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await expect(
      page.locator('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]').first()
    ).toBeVisible()

    // Blur the terminal before using an app-level shortcut.
    await page.mouse.click(400, 12)
    await page.keyboard.press('Control+e')
    await expect(page.getByTestId('workspace-editor-panel')).toBeVisible({ timeout: 15_000 })

    // --- Markdown -------------------------------------------------------
    await page.locator('.editor-browser-file', { hasText: 'NOTES.md' }).click()
    const markdown = page.getByTestId('markdown-preview')
    await expect(markdown).toBeVisible()
    await expect(markdown.getByRole('heading', { name: 'Preview heading' })).toBeVisible()
    await expect(markdown.locator('table')).toBeVisible()

    // Toggling shows the raw source instead.
    await page.getByTestId('markdown-toggle').click()
    await expect(markdown).toHaveCount(0)
    await expect(page.locator('.editor-monaco-host')).toBeVisible()
    await page.getByTestId('markdown-toggle').click()
    await expect(page.getByTestId('markdown-preview')).toBeVisible()

    // --- Image ----------------------------------------------------------
    await page.locator('.editor-browser-file', { hasText: 'dot.png' }).click()
    const image = page.getByTestId('image-preview')
    await expect(image).toBeVisible()
    // The data: URI must actually have decoded — a broken img reports 0 width.
    await expect
      .poll(async () => image.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0)
    await expect(image.getByText('image/png')).toBeVisible()

    // --- PDF ------------------------------------------------------------
    await page.locator('.editor-browser-file', { hasText: 'sample.pdf' }).click()
    await expect(page.getByTestId('pdf-preview')).toBeVisible()

    // --- Tabs -----------------------------------------------------------
    // Every file opened above is a tab; switching back must restore the viewer.
    const tabs = page.getByTestId('editor-tabs')
    await expect(tabs.locator('.editor-tab')).toHaveCount(3)
    await tabs.locator('.editor-tab', { hasText: 'NOTES.md' }).click()
    await expect(page.getByTestId('markdown-preview')).toBeVisible()

    await tabs.locator('.editor-tab', { hasText: 'dot.png' }).getByRole('button').click()
    await expect(tabs.locator('.editor-tab')).toHaveCount(2)
  } finally {
    await electronApp.close()
  }
})
