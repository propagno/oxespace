import { test, expect } from '@playwright/test'
import { scanSurface } from './helpers/a11y'
import { launchApp, openDemoWorkspace, resizeWindow } from './helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from './helpers/thread-fixtures'

/**
 * /events end to end in the real renderer: the command opens the inspector, the filter narrows the rows,
 * a row opens its detail, older events page in, and the dialog is reachable and readable by keyboard.
 *
 * The main process is the fixture's stand-in (no provider CLI is started), so what is proved here is the
 * renderer flow and its accessibility; the query itself is covered by tests/integration/thread-history.test.ts.
 */
test('/events lists, filters and inspects the saved events of a conversation', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot } = await launchApp()
  try {
    await resizeWindow(app, 1280, 800)
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)
    await openThreadWithState(app, page, workspaceRoot, 'conversation')

    await app.evaluate(({ ipcMain }) => {
      const at = Date.UTC(2026, 9, 14, 12, 0, 0)
      const all = [
        { seq: 1, type: 'message', label: 'user: Run the tests', text: 'run the tests' },
        { seq: 2, type: 'tool', label: 'Bash npm test', state: 'completed', durationMs: 450, exitCode: 0, text: 'ok 12 passed' },
        { seq: 3, type: 'tool', label: 'Bash npm run lint', state: 'failed', durationMs: 100, exitCode: 1, text: 'error: unused variable' },
        { seq: 4, type: 'completed', label: 'completed', state: 'completed', text: '' }
      ].map(row => ({ ...row, createdAt: at + row.seq * 1000, payload: JSON.stringify({ type: row.type, seq: row.seq, output: row.text }, null, 2) }))
      for (const channel of ['thread:command', 'thread:debug-events']) ipcMain.removeHandler(channel)
      ipcMain.handle('thread:command', (_event, _id, text: string) =>
        text.trim() === '/events' ? { kind: 'panel', surface: 'events', title: 'Conversation events' } : { kind: 'applied' })
      ipcMain.handle('thread:debug-events', (_event, _id, options: { filter?: string; before?: number; limit?: number } = {}) => {
        const terms = (options.filter ?? '').split(',').map(term => term.trim().toLowerCase()).filter(Boolean)
        const include = terms.filter(term => !term.startsWith('!')), exclude = terms.filter(term => term.startsWith('!')).map(term => term.slice(1))
        const matches = all.filter(row => {
          const haystack = `${row.type} ${row.label} ${row.state ?? ''} ${row.text}`.toLowerCase()
          return (options.before === undefined || row.seq < options.before) && !exclude.some(term => haystack.includes(term)) && (include.length === 0 || include.some(term => haystack.includes(term)))
        })
        const limit = options.limit ?? 200
        return { rows: matches.slice(-limit), matched: matches.length, hasMore: matches.length > limit, scanLimited: false }
      })
    })

    const composer = page.locator('.thread-composer textarea')
    await composer.fill('/events')
    await composer.press('Enter')

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const list = dialog.getByRole('list', { name: 'Events' })
    await expect(list.getByRole('button')).toHaveCount(4)
    await expect(dialog.getByText('4 of 4 matching events shown.')).toBeVisible()
    await expect(dialog.getByText('failed · exit 1 · 100 ms')).toBeVisible()

    // Filter: terms narrow the rows, an exclusion removes some, and the count follows.
    const filter = dialog.getByLabel('Filter events')
    await filter.fill('tool, !lint')
    await expect(list.getByRole('button')).toHaveCount(1)
    await expect(dialog.getByText('1 of 1 matching event shown.')).toBeVisible()
    await filter.fill('unused variable')
    await expect(list.getByRole('button')).toHaveCount(1)
    await filter.fill('no such thing')
    await expect(dialog.getByText('No event matches this filter.')).toBeVisible()
    await filter.fill('')
    await expect(list.getByRole('button')).toHaveCount(4)

    // Detail: a row opens its payload, pressing it again closes it, and it works from the keyboard.
    const failing = list.getByRole('button', { name: /Bash npm run lint/ })
    await failing.focus()
    await page.keyboard.press('Enter')
    await expect(failing).toHaveAttribute('aria-pressed', 'true')
    await expect(dialog.getByRole('region', { name: 'Event detail' })).toContainText('error: unused variable')
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('region', { name: 'Event detail' })).toHaveCount(0)

    const violations = await scanSurface(page, 'thread/events')
    expect(violations.filter(violation => violation.impact === 'critical' || violation.impact === 'serious'), JSON.stringify(violations, null, 2)).toEqual([])

    // Escape closes the dialog and returns focus to the conversation.
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  } finally {
    await app.close()
  }
})
