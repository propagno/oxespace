import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace } from './helpers/launch'

/**
 * B18 "Abrir em…" through the window's real bridge: main's real path checks, with fake editors (the E2E double in
 * electron/main/e2e/open-in-mock.ts) that record the argument list instead of starting anything.
 */
type OpenedIn = { kind: 'launch' | 'reveal'; file: string; args: string[]; cwd?: string }
const recorded = (app: ElectronApplication): Promise<OpenedIn[]> =>
  app.evaluate(() => (globalThis as typeof globalThis & { __oxeOpenedIn?: OpenedIn[] }).__oxeOpenedIn ?? [])

type Input = { path: string; target: string; line?: number; column?: number }

/** Calls app.openIn for the first workspace; resolves to 'opened' or to the rejection's text. */
async function openIn(page: Page, input: Input): Promise<string> {
  return page.evaluate(async request => {
    const workspace = (await window.oxe.workspace.list())[0]
    try {
      await window.oxe.app.openIn!({ workspaceId: workspace.id, rootPath: workspace.rootPath, ...request } as never)
      return 'opened'
    } catch (error) { return String((error as Error).message) }
  }, input)
}

test('a project file opens in a detected editor at its line; anything outside the project is refused', async () => {
  test.setTimeout(120_000)
  const { app, page, root, workspaceRoot, consoleErrors } = await launchApp()
  try {
    mkdirSync(join(workspaceRoot, 'src'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'src', 'app.ts'), 'export {}\n')
    mkdirSync(join(root, 'outside'))
    writeFileSync(join(root, 'outside', 'secret.txt'), 'secret')
    symlinkSync(join(root, 'outside'), join(workspaceRoot, 'linked'), 'junction')
    await openDemoWorkspace(page, workspaceRoot)

    const targets = await page.evaluate(() => window.oxe.app.openInTargets!())
    expect(targets).toEqual({ editors: [{ id: 'vscode', name: 'VS Code' }, { id: 'cursor', name: 'Cursor' }, { id: 'zed', name: 'Zed' }], preferred: 'auto' })

    const file = realpathSync.native(join(workspaceRoot, 'src', 'app.ts'))
    expect(await openIn(page, { path: 'src/app.ts', target: 'vscode', line: 42, column: 3 })).toBe('opened')
    expect(await openIn(page, { path: 'src/app.ts', target: 'reveal' })).toBe('opened')
    expect((await recorded(app)).map(({ kind, args }) => ({ kind, args }))).toEqual([
      { kind: 'launch', args: ['--goto', `${file}:42:3`] },
      { kind: 'reveal', args: [] }
    ])

    // Refusals arrive as C3 codes, and nothing more is started.
    const refusals: Array<[Input, string]> = [
      [{ path: '../outside/secret.txt', target: 'vscode' }, 'app.openIn.outsideRoot'],
      [{ path: 'linked/secret.txt', target: 'vscode' }, 'app.openIn.outsideRoot'],
      [{ path: 'src/app.ts', target: 'notepad' }, 'app.openIn.unknownTarget'],
      [{ path: 'src/gone.ts', target: 'zed' }, 'app.openIn.notFound']
    ]
    for (const [input, code] of refusals) expect(await openIn(page, input)).toContain(`"code":"${code}"`)
    expect(await recorded(app)).toHaveLength(2)

    // The preferred editor is kept by main.
    expect((await page.evaluate(() => window.oxe.app.setOpenInPreference!('zed'))).preferred).toBe('zed')
    expect((await page.evaluate(() => window.oxe.app.openInTargets!())).preferred).toBe('zed')
    expect(consoleErrors).toEqual([])
  } finally {
    await app.close()
  }
})
