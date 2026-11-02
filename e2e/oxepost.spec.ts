import { expect, test, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace } from './helpers/launch'
import { openView } from './helpers/oxepod'

/**
 * The OxePost mode in the real renderer and the real main process: a request is created, saved as a file of the
 * workspace, sent to a local server through an environment variable, and read back; cURL is imported; a production
 * environment asks first. The server runs in this process, so nothing leaves the machine.
 */
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'OxePost sidebar' })
const pageErrors = (lines: string[]): string[] => lines.filter(line => line.startsWith('pageerror:'))

let server: Server
let base = ''
const received: Array<{ method: string; url: string; body: string; headers: Record<string, string | string[] | undefined> }> = []

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      received.push({ method: request.method ?? '', url: request.url ?? '', body: Buffer.concat(chunks).toString(), headers: request.headers })
      response.writeHead(201, { 'content-type': 'application/json', 'x-served-by': 'oxepost-e2e', 'set-cookie': 'sid=abc; HttpOnly' })
      response.end(JSON.stringify({ pong: true, path: request.url }))
    })
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(() => { server.closeAllConnections(); server.close() })

test('creates a request, saves it as a file, sends it through an environment and shows the response', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp()
  const requests = join(workspaceRoot, '.oxespace', 'requests')
  try {
    await openDemoWorkspace(page, workspaceRoot)
    // Costs nothing until opened; Ctrl+5 opens it.
    expect(await page.locator('.post-host').count()).toBe(0)
    await page.keyboard.press('Control+5')
    await expect(page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxePost' })).toHaveAttribute('aria-pressed', 'true')
    await expect(sidebar(page)).toContainText('No requests yet')
    await expect(page.getByRole('region', { name: 'Response' })).toContainText('No response yet')

    // An environment with a variable (a file in the workspace) ...
    await sidebar(page).getByRole('navigation', { name: 'More' }).getByRole('button', { name: 'Environments' }).click()
    const dialog = page.getByRole('dialog', { name: 'Environments' })
    await dialog.getByLabel('Name', { exact: true }).fill('local')
    await dialog.getByRole('button', { name: 'Add variable' }).click()
    await dialog.getByLabel('Name, row 1').fill('baseUrl')
    await dialog.getByLabel('Value, row 1').fill(base)
    await dialog.getByRole('button', { name: 'Save environment' }).click()
    await expect(dialog.getByRole('navigation', { name: 'Environments' }).getByRole('button', { name: 'local' })).toHaveAttribute('aria-current', 'page')
    expect(JSON.parse(readFileSync(join(requests, 'environments', 'local.json'), 'utf8'))).toEqual({ name: 'local', production: false, variables: { baseUrl: base }, secrets: [] })
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click()
    await expect(dialog).toHaveCount(0)

    // ... a request that uses it ...
    await page.getByLabel('Request name').fill('Ping the server')
    await page.getByLabel('URL', { exact: true }).fill('{{baseUrl}}/ping?x=1')
    await expect(page.getByRole('note').filter({ hasText: 'No value in this environment for: {{baseUrl}}' })).toBeVisible()
    await page.getByLabel('Environment', { exact: true }).selectOption({ label: 'local' })
    await expect(page.getByRole('note').filter({ hasText: 'No value in this environment' })).toHaveCount(0)
    await page.getByRole('tab', { name: /^Params/ }).click()
    await expect(page.getByLabel('Name, row 1')).toHaveValue('x')
    await page.getByRole('tab', { name: 'Headers' }).click()
    await page.getByRole('button', { name: 'Add header' }).click()
    await page.getByLabel('Name, row 1').fill('X-Demo')
    await page.getByLabel('Value, row 1').fill('yes')

    // ... saved as a readable file, versioned with the code.
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible()
    await expect(sidebar(page).getByRole('button', { name: /GET\s*Ping the server/ })).toHaveAttribute('aria-current', 'page')
    expect(readFileSync(join(requests, 'ping-the-server.http'), 'utf8').replace(/\r\n/g, '\n')).toBe('# name: Ping the server\nGET {{baseUrl}}/ping?x=1\nX-Demo: yes\n')

    // Send: status, time, size, the body formatted, headers and cookies.
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const response = page.getByRole('region', { name: 'Response' })
    await expect(response.getByRole('status', { name: 'Response summary' })).toContainText('201')
    await expect(response.getByRole('status', { name: 'Response summary' })).toContainText(/\d+ ms|\d+(\.\d+)? s/)
    await expect(response.getByRole('status', { name: 'Response summary' })).toContainText(/\d+ B/)
    await expect(response.getByLabel('Response body')).toContainText('"pong": true')
    await expect(response.getByLabel('Response body')).toContainText('"path": "/ping?x=1"')
    expect(received.at(-1)).toMatchObject({ method: 'GET', url: '/ping?x=1' })
    expect(received.at(-1)!.headers['x-demo']).toBe('yes')
    await response.getByRole('tab', { name: /^Headers/ }).click()
    await expect(response.getByRole('list', { name: 'Response headers' }).or(response.getByLabel('Response headers', { exact: true }))).toContainText('oxepost-e2e')
    await response.getByRole('tab', { name: /^Cookies/ }).click()
    await expect(response.getByLabel('Cookies', { exact: true })).toContainText('sid')

    // Ctrl+Enter sends again.
    const count = received.length
    await page.getByLabel('URL', { exact: true }).focus()
    await page.keyboard.press('Control+Enter')
    await expect.poll(() => received.length).toBe(count + 1)

    // A variable with no value stops the send and says which, instead of sending the braces.
    await page.getByLabel('Environment', { exact: true }).selectOption({ label: 'No environment' })
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(response.getByText('A variable has no value')).toBeVisible()
    expect(received.length).toBe(count + 1)

    // Nothing is lost silently: another request asks before discarding changes.
    await page.getByLabel('URL', { exact: true }).fill('{{baseUrl}}/changed')
    await sidebar(page).getByRole('button', { name: 'New request' }).first().click()
    const discard = page.getByRole('dialog', { name: 'Discard changes?' })
    await expect(discard).toContainText('Ping the server')
    await discard.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByLabel('URL', { exact: true })).toHaveValue('{{baseUrl}}/changed')

    expect(pageErrors(consoleErrors)).toEqual([])
  } finally {
    await app.close()
  }
})

test('imports a cURL command as a request file, and a production environment asks before sending', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp()
  const requests = join(workspaceRoot, '.oxespace', 'requests')
  try {
    await openDemoWorkspace(page, workspaceRoot)
    await openView(page, 'post')

    await sidebar(page).getByRole('button', { name: 'Import cURL or OpenAPI' }).click()
    const dialog = page.getByRole('dialog', { name: 'Import requests' })
    await dialog.getByLabel('Text to import').fill(`curl '${base}/orders?limit=5' -X POST -H 'Content-Type: application/json' -H 'Authorization: Bearer {{token}}' --data-raw '{"item":1}'`)
    await expect(dialog.getByRole('region', { name: 'What will be imported' })).toContainText('POST /orders')
    await dialog.getByRole('button', { name: 'Import (1)' }).click()
    await expect(sidebar(page).getByRole('button', { name: /POST\s*POST \/orders/ })).toBeVisible()
    const files = readdirSync(requests).filter(name => name.endsWith('.http'))
    expect(files).toHaveLength(1)
    expect(readFileSync(join(requests, files[0]!), 'utf8').replace(/\r\n/g, '\n')).toBe(`# name: POST /orders\n# auth: bearer {{token}}\nPOST ${base}/orders?limit=5\nContent-Type: application/json\n\n{"item":1}\n`)

    // OpenAPI becomes one file per operation, grouped in a folder by tag.
    await sidebar(page).getByRole('button', { name: 'Import cURL or OpenAPI' }).click()
    const second = page.getByRole('dialog', { name: 'Import requests' })
    await second.getByRole('radio', { name: 'OpenAPI 3' }).click()
    await second.getByLabel('Text to import').fill(JSON.stringify({ openapi: '3.0.0', info: { title: 'Tiny' }, servers: [{ url: base }], paths: { '/ping': { get: { tags: ['health'], summary: 'Ping' } } } }))
    await second.getByRole('button', { name: 'Import (1)' }).click()
    await expect(sidebar(page).getByRole('region', { name: 'Folder health' })).toContainText('Ping')
    expect(existsSync(join(requests, 'health', 'ping.http'))).toBe(true)
    expect(JSON.parse(readFileSync(join(requests, 'environments', 'api.json'), 'utf8')).variables).toEqual({ baseUrl: base })

    // Production: marked, and the send waits for the person.
    await sidebar(page).getByRole('navigation', { name: 'More' }).getByRole('button', { name: 'Environments' }).click()
    const environments = page.getByRole('dialog', { name: 'Environments' })
    await environments.getByRole('button', { name: 'New environment' }).click()
    await environments.getByLabel('Name', { exact: true }).fill('prod')
    await environments.getByRole('switch', { name: 'Production' }).click()
    await environments.getByRole('button', { name: 'Add variable' }).click()
    await environments.getByLabel('Name, row 1').fill('baseUrl')
    await environments.getByLabel('Value, row 1').fill(base)
    await environments.getByRole('button', { name: 'Save environment' }).click()
    await expect(environments.getByText('Environment saved').or(environments.getByRole('button', { name: 'Delete environment' }))).toBeVisible()
    await environments.getByRole('button', { name: 'Close', exact: true }).last().click()

    await sidebar(page).getByRole('button', { name: /GET\s*Ping/ }).click()
    await page.getByLabel('Environment', { exact: true }).selectOption({ label: 'prod (production)' })
    const before = received.length
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: 'Send to prod?' })
    await expect(confirm).toContainText('production environment')
    expect(received.length).toBe(before)
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await page.getByRole('dialog', { name: 'Send to prod?' }).getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Response' }).getByRole('status', { name: 'Response summary' })).toContainText('201')
    expect(received.length).toBe(before + 1)
    expect(pageErrors(consoleErrors)).toEqual([])
  } finally {
    await app.close()
  }
})
