import { modeButton } from './helpers/modes'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from './helpers/launch'
import { installThreadFixtures, registerThreadProject } from './helpers/thread-fixtures'

/**
 * The conversation must stay still while the person types and when a turn
 * finishes. Every frame records how far the end of the conversation is from
 * the bottom of the visible area; while following the conversation it must
 * stay at the bottom (a jump away and back is the "tremble").
 */

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0)
const code = '```ts\n' + Array.from({ length: 8 }, (_, line) => `const value${line} = compute(${line}) // ${'x'.repeat(30)}`).join('\n') + '\n```'

function history(turns: number): unknown[] {
  const events: unknown[] = []
  for (let turn = 0; turn < turns; turn++) {
    events.push({ type: 'message', id: `u${turn}`, role: 'user', text: `Question ${turn}: how should the module ${turn} handle retries?` })
    events.push({ type: 'tool', id: `t${turn}`, name: 'commandExecution', state: 'completed', detail: 'npm test', output: 'ok', exitCode: 0 })
    events.push({ type: 'message', id: `a${turn}`, role: 'assistant', text: `Answer ${turn}.\n\n- First point about retries.\n- Second point with more words so the line wraps on narrower windows.\n\n${code}` })
    events.push({ type: 'completed', status: 'completed' })
  }
  return events
}

async function apply(app: ElectronApplication, state: { status: string; events: unknown[]; extra?: Record<string, unknown> }): Promise<void> {
  await app.evaluate((_context, payload) => { (globalThis as Record<string, (s: unknown) => void>).applyThreadState(payload) }, { title: 'Retries', provider: 'claude', ...state })
}

async function startSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    const timeline = document.querySelector<HTMLElement>('.thread-timeline')!
    const samples: number[] = []
    const w = window as unknown as { __jitter: { samples: number[]; stop: boolean } }
    w.__jitter = { samples, stop: false }
    const tick = () => {
      if (w.__jitter.stop) return
      samples.push(Math.round(timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight))
      ;(w.__jitter as unknown as { detail: string[] }).detail ??= []
      ;(w.__jitter as unknown as { detail: string[] }).detail.push(`${Math.round(timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight)}|h${timeline.clientHeight}|sh${timeline.scrollHeight}|st${Math.round(timeline.scrollTop)}|ta${document.querySelector('textarea[data-thread-composer]')?.clientHeight}`)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

async function stopSampling(page: Page): Promise<number[]> {
  const { samples, detail } = await page.evaluate(() => { const w = window as unknown as { __jitter: { samples: number[]; stop: boolean; detail?: string[] } }; w.__jitter.stop = true; return { samples: w.__jitter.samples, detail: w.__jitter.detail ?? [] } })
  if (process.env.JITTER_DEBUG) console.log(detail.join(' '))
  return samples
}

test('the conversation stays at the bottom while typing and when a turn finishes', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'dark' })
  try {
    await resizeWindow(app, 1280, 800)
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)
    await modeButton(page, 'thread').click()
    await page.getByRole('button', { name: 'New conversation in repo' }).click()
    await page.getByRole('button', { name: 'Create conversation', exact: true }).click()
    await page.locator('.thread-timeline').waitFor()
    const base = history(30)
    await apply(app, { status: 'idle', events: base })
    await expect(page.locator('.thread-view')).toContainText('Answer 29.')
    await page.waitForTimeout(800)

    // Typing, including new lines that grow the composer.
    const composer = page.locator('textarea[data-thread-composer="true"]')
    await composer.click()
    await startSampling(page)
    for (const word of ['Please', 'check', 'the', 'retry', 'logic', 'again']) {
      await composer.pressSequentially(`${word} `, { delay: 25 })
      await page.keyboard.press('Shift+Enter')
    }
    await page.waitForTimeout(400)
    const typing = await stopSampling(page)
    await composer.fill('')

    // A running turn, streaming text, then the final answer and the turn folding.
    const prompt = { type: 'message', id: 'u-live', role: 'user', text: 'Add jitter to the retries.' }
    const turns = [{ id: 'turn-live', nativeId: 'n', sequence: 1, startedAt: NOW, status: 'running', configuration: {} }]
    await apply(app, { status: 'running', events: [...base, prompt], extra: { turns, connection: { state: 'connected', attempt: 0, changedAt: NOW, lastNativeSignalAt: NOW } } })
    await page.waitForTimeout(500)
    await startSampling(page)
    const live: unknown[] = [prompt]
    for (let step = 0; step < 6; step++) {
      live.push({ type: 'tool', id: `live-tool-${step}`, name: 'commandExecution', state: 'completed', detail: `npm test -- part ${step}`, output: 'ok', exitCode: 0 })
      await apply(app, { status: 'running', events: [...base, ...live], extra: { turns } })
      await page.waitForTimeout(120)
    }
    await apply(app, { status: 'idle', events: [...base, ...live, { type: 'message', id: 'a-live', role: 'assistant', text: `Done: retries now back off with jitter.\n\n${code}` }, { type: 'completed', status: 'completed' }], extra: { turns: [{ ...turns[0], status: 'completed' }], lastTurnStatus: 'completed' } })
    await page.waitForTimeout(800)
    const finishing = await stopSampling(page)

    // At rest, with the composer at its tallest, nothing may keep moving: the virtual rows once fed back a new
    // size on every frame and the conversation shook forever.
    await page.locator('textarea[data-thread-composer="true"]').fill(Array.from({ length: 12 }, (_, line) => `line ${line}`).join('\n'))
    await page.waitForTimeout(500)
    const heights = await page.locator('.thread-timeline').evaluate(async element => {
      const values = new Set<number>()
      for (let frame = 0; frame < 60; frame++) { await new Promise(resolve => requestAnimationFrame(resolve)); values.add(element.scrollHeight * 100000 + Math.round(element.scrollTop)) }
      return values.size
    })
    expect(heights).toBe(1)

    const away = (samples: number[]) => samples.filter(distance => distance > 1)
    console.log('jitter', { typing: { frames: typing.length, away: away(typing) }, finishing: { frames: finishing.length, away: away(finishing) } })
    expect(away(typing)).toEqual([])
    expect(away(finishing)).toEqual([])
  } finally {
    await app.close()
  }
})
