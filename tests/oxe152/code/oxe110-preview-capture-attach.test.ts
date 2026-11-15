// @vitest-environment node
// Frozen acceptance test for 1.5.2 OxeCode F3 (OXE program oxespace-152-code, phase F3, Jira OXE-110).
// Written by the planner; the executor must not edit it.
// Defect (real use, 13/11): an element picked in the Web Preview is saved to <userData>/web-preview-captures/<owner>/
// (electron/main/services/browser-preview.service.ts:372) and an agent in an OxeCode terminal is handed that path
// (shared/types/design-mode.ts:94 "Screenshot of the element: <path>"), which it cannot read: the folder is outside its
// workspace. The folder also grows without limit. (In OxeChat the captures already travel as attachments,
// WebPreviewPanel sendGrabToAgent.)
// Contract:
// - formatDesignGrab/formatDesignGrabs: with a context.screenshotPath, the prompt names the capture by its file name and
//   tells the agent to fetch it with oxespace_capture_web_preview { "element": "<file name>" }; it never prints the
//   folder (no AppData, no web-preview-captures, no directory part).
// - oxespace_capture_web_preview (handlers.captureWebPreview) accepts `element`: a capture file name (same rule as
//   fileName, a short PNG basename). It reads ctx.captureRoot/<owner>/<element>, where owner is the calling execution's
//   (thread id for a Thread, workspace id for a Code pane), and returns it as an image content item. It needs no live
//   preview, writes nothing, and never reads another owner's capture.
// - savePreviewCapture (electron/main/services/browser-preview/preview-capture-store.ts): after writing, the whole capture
//   root keeps only the 50 most recent .png files, across every owner folder (RT-2).
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/user-data', getAppPath: () => '/app', isPackaged: false, getVersion: () => '1.5.2' } }))

await import('../../../electron/main/mcp-internal/tool-registry')
const { handlers } = await import('../../../electron/main/mcp-internal/tool-handlers')
const { ExecutionRegistry } = await import('../../../electron/main/services/execution-registry')
const { savePreviewCapture } = await import('../../../electron/main/services/browser-preview/preview-capture-store')
const { formatDesignGrabs } = await import('../../../shared/types/design-mode')

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7])
const NAME = 'element-mf3k2a-1a2b3c4d.png'
type Result = { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean }

let base = ''
let workspaceRoot = ''
let captureRoot = ''

/** Every file below a folder, relative, sorted. */
function filesUnder(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath ?? (entry as unknown as { path: string }).path, entry.name).slice(root.length + 1)).sort()
}

function paneContext() {
  const executions = new ExecutionRegistry()
  const env = executions.register({ owner: { kind: 'pane', id: 'p1' }, workspaceId: 'w1', cwd: workspaceRoot })
  return {
    workspaceId: 'w1', executionId: env.OXESPACE_EXECUTION_ID, executionToken: env.OXESPACE_EXECUTION_TOKEN, executions, captureRoot,
    workspaceServ: { get: (id: string) => id === 'w1' ? { id: 'w1', name: 'site', rootPath: workspaceRoot, panes: [{ id: 'p1', type: 'terminal' }] } : undefined, list: () => [] }
  } as never
}

const payload = {
  selector: 'main > button.buy', pageUrl: 'http://127.0.0.1:5180/', pageTitle: 'Shop', rect: { x: 10, y: 20, width: 120, height: 40 },
  text: 'Buy', html: '<button class="buy">Buy</button>', styles: []
}

describe('OXE-110 · the agent gets the element capture, and nothing lands in the workspace', () => {
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'oxe110-'))
    workspaceRoot = join(base, 'workspace')
    captureRoot = join(base, 'user-data', 'web-preview-captures')
    mkdirSync(workspaceRoot, { recursive: true })
    writeFileSync(join(workspaceRoot, 'index.html'), '<p>é</p>')
    mkdirSync(join(captureRoot, 'w1'), { recursive: true })
    writeFileSync(join(captureRoot, 'w1', NAME), PNG)
  })
  afterEach(() => { rmSync(base, { recursive: true, force: true }) })

  it('CA-1 · the capture goes with the message as something the agent can open, never as a path into AppData', () => {
    for (const screenshotPath of [`C:\\Users\\person\\AppData\\Roaming\\oxespace\\web-preview-captures\\w1\\${NAME}`, `/home/person/.config/oxespace/web-preview-captures/w1/${NAME}`]) {
      const prompt = formatDesignGrabs([{ payload: payload as never, context: { screenshotPath } }], 'make it green')
      expect(prompt).toContain(NAME)
      expect(prompt).toContain('oxespace_capture_web_preview')
      expect(prompt).toMatch(/"?element"?/)
      expect(prompt).not.toMatch(/AppData|web-preview-captures|\.config|[\\/]w1[\\/]/)
    }
  })

  it('CA-2 · the MCP tool returns the image of the capture', async () => {
    const result = await handlers.captureWebPreview({ element: NAME }, paneContext()) as Result
    expect(result.isError).toBeFalsy()
    expect(result.content).toContainEqual({ type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' })
    // Another owner's capture, or a name that is not a plain capture file name, is never read.
    mkdirSync(join(captureRoot, 'w2'), { recursive: true })
    writeFileSync(join(captureRoot, 'w2', 'element-other-00000000.png'), PNG)
    for (const element of ['element-other-00000000.png', `../w2/element-other-00000000.png`, '..\\w2\\x.png', 'notes.txt']) {
      const refused = await handlers.captureWebPreview({ element }, paneContext()).catch((error: Error) => ({ content: [{ type: 'text', text: error.message }], isError: true })) as Result
      expect(refused.isError, element).toBe(true)
      expect(refused.content.some(item => item.type === 'image'), element).toBe(false)
    }
  })

  it('CA-3 · sending the capture writes nothing in the workspace', async () => {
    const workspaceBefore = filesUnder(workspaceRoot)
    const capturesBefore = filesUnder(captureRoot)
    const result = await handlers.captureWebPreview({ element: NAME }, paneContext()) as Result
    expect(result.content.some(item => item.type === 'image')).toBe(true)
    expect(filesUnder(workspaceRoot)).toEqual(workspaceBefore)
    expect(filesUnder(captureRoot)).toEqual(capturesBefore)
    expect(readdirSync(workspaceRoot)).not.toContain('.oxespace')
  })

  it('CA-4 · with more than 50 captures, a new one leaves only the 50 most recent', async () => {
    rmSync(join(captureRoot, 'w1', NAME))
    mkdirSync(join(captureRoot, 'thread-1'), { recursive: true })
    const old = Date.now() / 1000 - 10_000
    const names: string[] = []
    for (let i = 0; i < 55; i++) {
      const owner = i % 2 === 0 ? 'w1' : 'thread-1'
      const name = `element-old${String(i).padStart(2, '0')}-00000000.png`
      writeFileSync(join(captureRoot, owner, name), PNG)
      utimesSync(join(captureRoot, owner, name), old + i, old + i)
      names.push(`${owner}/${name}`)
    }
    await savePreviewCapture(captureRoot, 'w1', 'element-newest-00000000.png', PNG)
    const left = filesUnder(captureRoot).map(path => path.replace(/\\/g, '/'))
    expect(left).toHaveLength(50)
    expect(left).toContain('w1/element-newest-00000000.png')
    // 55 + 1 - 50: the six oldest go, whichever owner they belong to.
    for (const gone of names.slice(0, 6)) expect(left, gone).not.toContain(gone)
    for (const kept of names.slice(6)) expect(left, kept).toContain(kept)
  })
})
