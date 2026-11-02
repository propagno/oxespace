import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * F34 + B21 · #344 + #453 · OXEVoice is gone, and what it leaves behind is not touched. REAL app, black box:
 * - `<userData>/models` with an OXEVoice model (ggml-*) and a semantic model file: every file keeps its size and time
 *   across two launches;
 * - the one-time notice about voice: logged at the first launch after, not shown again at the next;
 * - semantic search still answers for the project (status, turn on, reindex).
 */
const oxe = <T>(page: Page, expression: string) => page.evaluate(expression) as Promise<T>
const toasts = (page: Page) => page.locator('[data-toast]').allInnerTexts().catch(() => [] as string[])

test('F34+B21: the models folder stays as it is; semantic search still works; the voice notice shows once', async () => {
  test.setTimeout(240_000)
  const profile = realProfile('f34b21', { OXESPACE_LOCALE: 'en-US' })
  let { app } = await launchReal(profile)
  let page: Page
  const out: Record<string, unknown> = {}
  const userData = await app.evaluate(({ app }) => app.getPath('userData'))
  await quitReal(app)
  const models = join(userData, 'models'); mkdirSync(join(models, 'semantic'), { recursive: true })
  const files = [join(models, 'ggml-base.bin'), join(models, 'ggml-small.en.bin'), join(models, 'semantic', 'model.onnx')]
  for (const f of files) writeFileSync(f, Buffer.alloc(4096, 7))
  const stamp = () => files.map(f => { try { const s = statSync(f); return `${s.size}@${Math.round(s.mtimeMs)}` } catch { return 'missing' } })
  out.before = stamp()
  try {
    for (const launch of [1, 2]) {
      ;({ app, page } = await launchReal(profile))
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
        dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
      })
      await page.waitForTimeout(4_000)
      out[`toasts${launch}`] = (await toasts(page)).filter(t => /voice|OXEVoice|dictation|ditado/i.test(t))
      if (launch === 1) {
        await openRepo(page, profile.repo)
        writeFileSync(join(profile.repo, 'hello.ts'), 'export function greetTheHomologation() { return 1 }\n')
        const workspaceId = await oxe<string>(page, 'window.oxe.workspace.list().then(l => l[0].id)')
        out.semanticStatus = await oxe(page, `window.oxe.semantic.getStatus(${JSON.stringify(workspaceId)}).then(s => JSON.stringify(s).slice(0, 300), e => 'error: ' + e.message)`)
        out.semanticOn = await oxe(page, `window.oxe.semantic.setProjectEnabled({ rootPath: ${JSON.stringify(profile.repo)}, enabled: true }).then(s => JSON.stringify(s).slice(0, 300), e => 'error: ' + e.message)`)
        out.reindex = await oxe(page, `window.oxe.semantic.reindex(${JSON.stringify(workspaceId)}).then(s => JSON.stringify(s).slice(0, 300), e => 'error: ' + e.message)`)
        out.vector = await oxe(page, 'window.oxe.semantic.getVectorStatus().then(s => JSON.stringify(s).slice(0, 300), e => "error: " + e.message)')
      }
      await quitReal(app)
      out[`after${launch}`] = stamp()
    }
  } finally {
    console.log('F34B21', JSON.stringify(out).slice(0, 4000))
  }
  expect.soft(out.after1, 'the models folder is unchanged after the first launch').toEqual(out.before)
  expect.soft(out.after2, 'and after the second').toEqual(out.before)
  for (const key of ['semanticStatus', 'semanticOn', 'reindex', 'vector']) expect.soft(String(out[key]), `semantic ${key} answers`).not.toMatch(/^error/)
  expect.soft((out.toasts2 as string[]).length, 'the voice notice does not come back at the next launch').toBe(0)
})
