import { expect, test } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace } from '../helpers/launch'

/**
 * F34 + B21 (S6) · OXEVoice is gone from the screen, from main and from the package (user decision, 31/10).
 * Roadmap acceptance: no voice control anywhere in the interface; no voice IPC; no whisper binary, model download or
 * packaging; offer-audit stays green.
 */
test('F34: no voice control in panes, composer, Settings or the palette', async () => {
  const { app, page, workspaceRoot } = await launchApp({ locale: 'en-US' })
  try {
    await openDemoWorkspace(page, workspaceRoot)
    const voice = /microphone|dictat|voice|OXEVoice/i
    expect(await page.getByRole('button', { name: voice }).count(), 'no voice button in the workspace').toBe(0)
    expect(await page.evaluate(() => 'voice' in ((window as unknown as { oxe: Record<string, unknown> }).oxe)), 'no voice API in the preload').toBe(false)
    await page.keyboard.press('Control+,')
    expect(await page.getByRole('button', { name: /^Voice$/ }).or(page.getByRole('link', { name: /^Voice$/ })).count(), 'no Settings › Voice').toBe(0)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+k')
    await page.keyboard.type('voice')
    expect(await page.getByRole('option', { name: voice }).count(), 'no voice command in the palette').toBe(0)
  } finally { await app.close() }
})

test('B21: no whisper, voice IPC or model download in the build and the packaging', () => {
  const pkg = readFileSync(join(process.cwd(), 'package.json'), 'utf8')
  expect(pkg, 'package.json neither packs nor depends on whisper').not.toMatch(/whisper/i)
  const builder = ['electron-builder.yml', 'electron-builder.json', 'electron-builder.config.cjs'].map(f => join(process.cwd(), f)).filter(existsSync)
  for (const f of builder) expect(readFileSync(f, 'utf8'), `${f} packs no whisper`).not.toMatch(/whisper/i)
  const ipc = readFileSync(join(process.cwd(), 'shared', 'types', 'ipc.ts'), 'utf8')
  expect(ipc, 'no voice channel').not.toMatch(/['"]voice:/)
  // The built main and renderer (electron-vite build output) carry no whisper or Hugging Face model URL.
  const out = join(process.cwd(), 'out')
  test.skip(!existsSync(out), 'run after a build (npx electron-vite build)')
  const offenders: string[] = []
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else if (/\.(c?js|mjs|html)$/.test(name) && /whisper|huggingface\.co\/.*ggml/i.test(readFileSync(p, 'utf8'))) offenders.push(p) } }
  walk(out)
  expect(offenders, 'built files mentioning whisper or its model').toEqual([])
})
