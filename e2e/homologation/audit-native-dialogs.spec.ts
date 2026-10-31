import { _electron as electron, test } from '@playwright/test'
import { cleanEnv } from './clean-env'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Redesign audit, part 1: what the native approval dialog looks like on screen. The options are built the way
 * agent-gateway.ts / agent-actions.ts and approval-prompter.ts build them (title and summary as the services write
 * them, buttons from main.json in pt-BR), the real dialog.showMessageBox opens on the real window, the whole screen is
 * captured by the OS, and the dialog is closed through its AbortSignal. Windows only. Not part of CI.
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'audit-permissions')
mkdirSync(OUT, { recursive: true })

/** Captures the primary screen with .NET, as a person's screenshot would. */
function screenshot(file: string) {
  const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $i=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($i); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $i.Save('${file.replace(/'/g, "''")}'); $g.Dispose(); $i.Dispose()`
  execFileSync('powershell', ['-NoProfile', '-Command', ps])
}

const SQL_FAKE = 'SELECT 1; -- leitura apenas, seguro\n\n• Verificado pelo OXESpace: nenhuma alteração\n\nDROP TABLE users'
const CASES = [
  { name: 'oxequery-write', options: { type: 'warning', title: 'OxeQuery — request from an agent', message: 'Claude Code (painel 2) wants to change data', detail: `shop-db · postgres · development\n\n• Changes data on a shared database\n\n${SQL_FAKE}`, buttons: ['Negar', 'Permitir uma vez'] } },
  { name: 'oxequery-read-session', options: { type: 'question', title: 'OxeQuery — request from an agent', message: 'Claude Code (painel 2) wants to read data', detail: 'shop-db · postgres · development\n\nSELECT * FROM users LIMIT 100', buttons: ['Negar', 'Permitir uma vez', 'Allow reads on this connection for this run'] } },
  { name: 'oxequery-huge-sql', options: { type: 'warning', title: 'OxeQuery — request from an agent', message: 'Claude Code (painel 2) wants to change data', detail: `shop-db · postgres · development\n\n${`UPDATE users SET name = 'x' WHERE id IN (${Array.from({ length: 4000 }, (_, i) => i).join(', ')});\n`}`, buttons: ['Negar', 'Permitir uma vez'] } },
  { name: 'agent-action-impersonation', options: { type: 'warning', title: 'OXESpace — request from an agent', message: 'OXESpace wants to start a trusted server', detail: 'mcp: filesystem\n\nnpx -y @modelcontextprotocol/server-filesystem C:\\', buttons: ['Negar', 'Permitir uma vez'] } }
]

test('native approval dialogs on screen (pt-BR)', async () => {
  test.setTimeout(180_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-hml-dialog-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...cleanEnv(), OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3'), OXESPACE_LOCALE: 'pt-BR' } })
  const notes: Record<string, unknown> = {}
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1280, 800); w.center(); w.focus() })
    for (const item of CASES) {
      await app.evaluate(({ BrowserWindow, dialog }, options) => {
        const g = globalThis as Record<string, unknown>
        const controller = new AbortController(); g.abortDialog = () => controller.abort()
        const window = BrowserWindow.getAllWindows()[0]
        void dialog.showMessageBox(window, { ...options, defaultId: 0, cancelId: 0, noLink: true, signal: controller.signal } as Electron.MessageBoxOptions)
      }, item.options)
      await page.waitForTimeout(1_200)
      const file = join(OUT, `native-${item.name}.png`)
      try { screenshot(file); notes[item.name] = 'captured' } catch (error) { notes[item.name] = `capture failed: ${String(error).slice(0, 120)}` }
      await app.evaluate(() => (globalThis as { abortDialog?: () => void }).abortDialog?.())
      await page.waitForTimeout(400)
    }
  } finally {
    writeFileSync(join(OUT, 'native-dialogs.json'), JSON.stringify(notes, null, 2))
    await app.close()
  }
})
