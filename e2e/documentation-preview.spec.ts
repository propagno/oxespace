import { _electron as electron, expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PreviewAutomation, PreviewRequest, ScreenshotOptions } from '../electron/main/services/documentation/preview-automation'

test('documentation uses the real guest, confirms actions and masks capture inputs', async () => {
  test.setTimeout(90000)
  const root=mkdtempSync(join(tmpdir(),'oxe-doc-preview-')), repo=join(root,'repo');mkdirSync(repo)
  const handlersPath=join(root,'handlers.mjs')
  await build({entryPoints:['electron/main/mcp-internal/tool-registry.ts'],outfile:handlersPath,bundle:true,platform:'node',format:'esm',external:['electron']})
  let failPreview = false
  const server=createServer((req,res)=>{if(failPreview && req.url?.startsWith('/failure')) {res.destroy();return}res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><body style="margin:20px;background:white"><h1>Customer guide</h1><input id="name" value="PRIVATE" style="width:200px;height:40px;background:red"><button id="save" onclick="document.querySelector('h1').textContent='Saved '+document.querySelector('input').value">Save</button><a id="next" href="/next">Next page</a><div id="panel" style="height:1200px">Details</div></body></html>`)})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const address=server.address();const url=`http://127.0.0.1:${typeof address==='object' && address ? address.port : 0}/`
  const app=await electron.launch({args:[join(process.cwd(),'e2e/electron-main.cjs')],env:{...process.env,OXESPACE_E2E_PREVIEW_HANDLERS:handlersPath,OXESPACE_E2E_PREVIEW_SERVICE:'1',OXESPACE_DISABLE_SINGLE_INSTANCE:'1',OXESPACE_E2E_MOCK_NATIVE:'1',OXESPACE_DB_PATH:join(root,'db.sqlite3')}})
  try {
    const page=await app.firstWindow()
    await page.getByTestId('btn-new-workspace').click();await page.getByTestId('wizard-dir-input').fill(repo);await page.getByTestId('wizard-launch-btn').click()
    await page.getByTestId('btn-open-tools').click();await page.getByText('Web Preview',{exact:true}).click()
    await page.locator('.web-preview-address-input').fill(url);await page.locator('.web-preview-address-input').press('Enter')
    const view=page.getByTestId('browser-preview-native');await expect(view).toBeVisible()
    const workspaceId=(await page.locator('.web-preview-panel').getAttribute('data-browser-owner'))!
    await expect.poll(() => app.evaluate(({webContents},baseUrl) => webContents.getAllWebContents().some(contents => contents.getURL().startsWith(baseUrl)),url)).toBe(true)
    const popupBlocked = await app.evaluate(({webContents},baseUrl) => webContents.getAllWebContents().find(contents => contents.getURL().startsWith(baseUrl))!.executeJavaScript("window.open('https://example.com/') === null"),url)
    expect(popupBlocked).toBe(true)
    const run=(input:PreviewRequest,ws=workspaceId,owner?: {kind:'thread'|'pane';id:string})=>app.evaluate(async (_,{input,ws,owner})=>{
      try {return {result:await (globalThis as unknown as {preview:PreviewAutomation}).preview.run(ws,input,()=>{},owner)}}
      catch(e){return {error:(e as Error).message}}
    },{input,ws,owner})
    expect((await run({action:'inspect'})).error).toContain('enable Agent documentation access')
    page.once('dialog',dialog=>dialog.accept());await page.getByLabel('Agent documentation access').check()
    await expect.poll(async()=> (await run({action:'inspect'})).error).toBeUndefined()
    const inspected=await run({action:'inspect'})
    expect(JSON.stringify(inspected)).toContain('Customer guide');expect(JSON.stringify(inspected)).not.toContain('PRIVATE')
    await view.evaluate(element => element.setAttribute('data-thread-id','isolated-thread'))
    expect((await run({action:'inspect'},workspaceId,{kind:'pane',id:'test-pane'})).error).toBeUndefined()
    expect((await run({action:'inspect'},workspaceId,{kind:'thread',id:'isolated-thread'})).error).toContain('enable Agent documentation access')
    expect((await run({action:'inspect'},workspaceId,{kind:'thread',id:'other-thread'})).error).toContain('enable Agent documentation access')
    await view.evaluate(element => element.removeAttribute('data-thread-id'))
    // The legacy MCP capture must use the same opt-in, scoped and redacted path.
    const legacyCapture = () => app.evaluate(async (_, workspaceId) => {
      const { findTool } = await (globalThis as unknown as {previewHandlers: Promise<typeof import('../electron/main/mcp-internal/tool-registry')>}).previewHandlers
      const execution = { workspaceId, owner: {kind:'pane',id:'test-pane'} }
      return findTool('oxespace_capture_web_preview')!.handler({}, {
        workspaceId, executionId:'test', executionToken:'test',
        executions:{authenticate:()=>execution},
        workspaceServ:{get:()=>({id:workspaceId,panes:[{id:'test-pane'}]})},
        documentation:async()=>({preview:(globalThis as unknown as {preview:PreviewAutomation}).preview})
      } as never)
    }, workspaceId)
    const legacy = await legacyCapture()
    expect(legacy.isError).toBe(false)
    expect(legacy.content[0]).toMatchObject({type:'image',mimeType:'image/png'})
    expect((await run({action:'inspect'},'foreign-workspace')).error).toBeTruthy()
    // Native confirmation is controlled only inside the isolated test process.
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false})})
    expect((await run({action:'click',selector:'#save',expectedUrl:url})).error).toContain('declined')
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false})})
    expect((await run({action:'fill',selector:'#name',text:'Example',expectedUrl:url})).error).toBeUndefined()
    expect((await run({action:'click',selector:'#save',expectedUrl:url})).error).toBeUndefined()
    await expect.poll(async()=>JSON.stringify(await run({action:'inspect'}))).toContain('Saved Example')
    await app.evaluate(({webContents},baseUrl) => webContents.getAllWebContents().find(c=>c.getURL().startsWith(baseUrl))!.executeJavaScript("document.querySelector('#name').value='Blocked'"),url)
    await app.evaluate(({dialog}) => {dialog.showMessageBox=async()=>new Promise(resolve => { (globalThis as unknown as {approvePreview?:()=>void}).approvePreview=()=>resolve({response:1,checkboxChecked:false}) })})
    const pendingClick = run({action:'click',selector:'#save',expectedUrl:url})
    await expect.poll(() => app.evaluate(() => typeof (globalThis as unknown as {approvePreview?:()=>void}).approvePreview)).toBe('function')
    await page.getByLabel('Agent documentation access').uncheck()
    await expect.poll(async () => (await run({action:'tabs'})).error).toContain('enable Agent documentation access')
    await app.evaluate(() => (globalThis as unknown as {approvePreview?:()=>void}).approvePreview?.())
    expect((await pendingClick).error).toContain('enable Agent documentation access')
    expect(await app.evaluate(({webContents},baseUrl) => webContents.getAllWebContents().find(c=>c.getURL().startsWith(baseUrl))!.executeJavaScript("document.querySelector('h1').textContent"),url)).toBe('Saved Example')
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false})})
    await page.evaluate(() => {window.confirm = () => true})
    await page.getByLabel('Agent documentation access').check()
    await expect.poll(async()=> (await run({action:'inspect'})).error).toBeUndefined()
    // Font metrics differ across Windows/Linux runners. Sample the actual
    // input center rather than a fixed coordinate that may hit white space.
    const maskPoint = await app.evaluate(({webContents},baseUrl) => webContents.getAllWebContents().find(c=>c.getURL().startsWith(baseUrl))!.executeJavaScript("(() => { const r=document.querySelector('#name').getBoundingClientRect(); return {x:Math.floor(r.left+r.width/2),y:Math.floor(r.top+r.height/2)} })()"),url) as {x:number;y:number}
    const shot=await app.evaluate(async (_,{workspaceId,options})=>{
      const s=await (globalThis as unknown as {preview:PreviewAutomation}).preview.capture(workspaceId,options,()=>{})
      return {...s,png:s.png.toString('base64')}
    },{workspaceId,options:{mode:'viewport',highlight:['#save']} as ScreenshotOptions})
    expect(shot.height).toBeGreaterThan(100);expect(shot.redactionCount).toBeGreaterThan(0)
    expect((legacy.content[0] as {data:string}).data).toBeTruthy()
    writeFileSync(test.info().outputPath('redacted-viewport.png'),Buffer.from(shot.png,'base64'))
    const pixels = await app.evaluate(({nativeImage},{base64,maskPoint}) => {
      const img = nativeImage.createFromBuffer(Buffer.from(base64,'base64'))
      const size = img.getSize(), bytes = img.toBitmap()
      const at = (x:number,y:number) => [...bytes.subarray((y*size.width+x)*4,(y*size.width+x)*4+3)]
      return {size,mask:at(maskPoint.x,maskPoint.y),blank:at(Math.floor(size.width/2),size.height-25)}
    },{base64:shot.png,maskPoint})
    expect(pixels.size.width).toBe(shot.width)
    expect(pixels.size.height).toBe(shot.height)
    expect(pixels.mask).toEqual([17,17,17])
    expect(pixels.blank).toEqual([255,255,255])
    const status = (await run({action:'status'})).result as {sessionId:string;tabId:string;url:string}
    expect(status.sessionId).toMatch(/^[\da-f-]{36}$/)
    expect((await run({action:'status'})).result).toMatchObject({sessionId:status.sessionId,tabId:status.tabId,url})
    await app.evaluate(({webContents},baseUrl)=>webContents.getAllWebContents().find(c=>c.getURL().startsWith(baseUrl))!.executeJavaScript("console.warn('DO_NOT_EXPOSE'); fetch('/asset?secret=DO_NOT_EXPOSE')"),url)
    const diagnostics = (await run({action:'console'})).result as {counts:{warning:number};note:string}
    expect(diagnostics.counts.warning).toBeGreaterThan(0)
    expect(JSON.stringify(diagnostics)).not.toContain('DO_NOT_EXPOSE')
    await expect.poll(async()=>JSON.stringify((await run({action:'network'})).result)).toContain('/asset?route=')
    expect(JSON.stringify((await run({action:'network'})).result)).not.toContain('DO_NOT_EXPOSE')
    expect((await run({action:'scroll',selector:'#panel',deltaY:450,expectedUrl:url})).error).toBeUndefined()
    await expect.poll(async () => app.evaluate(({webContents},baseUrl) => webContents.getAllWebContents().find(c=>c.getURL().startsWith(baseUrl))!.executeJavaScript('document.scrollingElement.scrollTop'),url)).toBeGreaterThan(0)
    expect((await run({action:'newTab'})).error).toBeUndefined()
    await app.evaluate(({BrowserWindow},{workspaceId,url}) => BrowserWindow.getAllWindows()[0].webContents.send('mcp-internal:on-web-preview',{workspaceId,url,requestedAt:Date.now()}),{workspaceId,url})
    await expect(page.getByTestId('browser-preview-native')).toHaveCount(2)
    await expect.poll(async () => (await run({action:'status'})).result).toMatchObject({sessionId:status.sessionId,url})
    const secondTab = (await run({action:'status'})).result as {tabId:string}
    expect(secondTab.tabId).not.toBe(status.tabId)
    const browserTabs = (await run({action:'tabs'})).result as {sessionId:string;tabs:Array<{id:string;active:boolean}>}
    expect(browserTabs.sessionId).toBe(status.sessionId)
    expect(browserTabs.tabs).toHaveLength(2)
    expect((await run({action:'selectTab',tabId:browserTabs.tabs[0].id})).error).toBeUndefined()
    await expect.poll(async () => JSON.stringify((await run({action:'inspect'})).result)).toContain('Saved Example')
    await expect(page.getByTestId('design-mode-toggle')).toBeEnabled()
    expect((await run({action:'closeTab',tabId:browserTabs.tabs[0].id})).error).toBeUndefined()
    await expect(page.getByTestId('browser-preview-native')).toHaveCount(1)
    await expect.poll(async () => app.evaluate(({webContents},baseUrl) => webContents.getAllWebContents().filter(contents => contents.getURL().startsWith(baseUrl)).length,url)).toBe(1)
    await expect.poll(async () => (await run({action:'status'})).result).toMatchObject({sessionId:status.sessionId,tabId:secondTab.tabId})
    await app.evaluate(async ({webContents},nextUrl) => {
      await webContents.getAllWebContents().find(contents=>contents.getURL().startsWith(nextUrl.split('?')[0]))!.loadURL(nextUrl)
    },`${url}?token=DO_NOT_EXPOSE`)
    const privateRoute = (await run({action:'status'})).result as {url:string}
    expect(privateRoute.url).toContain('?route=')
    expect(privateRoute.url).not.toContain('DO_NOT_EXPOSE')
    expect((await run({action:'wait',selector:'body',expectedUrl:url})).error).toContain('exact reported URL')
    await app.evaluate(({webContents},baseUrl) => webContents.getAllWebContents().find(c=>c.getURL().startsWith(baseUrl))!.executeJavaScript("document.querySelector('#next').click()"),url)
    await expect(page.locator('.web-preview-address-input')).toHaveValue(`${url}next`)
    await expect(page.getByRole('button',{name:'Back',exact:true})).toBeEnabled()
    await page.getByRole('button',{name:'Back',exact:true}).click()
    await expect(page.locator('.web-preview-address-input')).toHaveValue(url)
    await expect(page.getByRole('button',{name:'Forward',exact:true})).toBeEnabled()
    await page.getByRole('button',{name:'Forward',exact:true}).click()
    await expect(page.locator('.web-preview-address-input')).toHaveValue(`${url}next`)
    await page.screenshot({path:test.info().outputPath('documentation-preview-ui.png')})
    const guestClean=await app.evaluate(({webContents},baseUrl)=>webContents.getAllWebContents().find(c=>c.getURL().startsWith(baseUrl))!.executeJavaScript("document.querySelectorAll('[data-oxe-capture]').length"),url)
    expect(guestClean).toBe(0)
    await page.getByLabel('Agent documentation access').uncheck()
    expect((await run({action:'inspect'})).error).toContain('enable Agent documentation access')
    expect((await run({action:'tabs'})).error).toContain('enable Agent documentation access')
    await expect(legacyCapture()).rejects.toThrow('enable Agent documentation access')
    const nativeBounds = () => app.evaluate(({BrowserWindow},baseUrl) => {
      const views = BrowserWindow.getAllWindows()[0].contentView.children
      const view = views.find(item => {
        const guest = (item as unknown as {webContents?:{getURL():string}}).webContents
        return guest?.getURL().startsWith(baseUrl)
      })
      return view?.getBounds() ?? null
    },url)
    const boundDifference = async (): Promise<number> => {
      const rect = await page.getByTestId('browser-preview-native').boundingBox()
      const bounds = await nativeBounds()
      if (!rect || !bounds) return 1000
      return Math.max(Math.abs(rect.x-bounds.x),Math.abs(rect.y-bounds.y),Math.abs(rect.width-bounds.width),Math.abs(rect.height-bounds.height))
    }
    await expect.poll(boundDifference).toBeLessThan(3)
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(1180,800))
    await expect.poll(boundDifference).toBeLessThan(3)
    const frame = await page.getByTestId('browser-preview-native').boundingBox()
    await page.mouse.click(frame!.x+25,frame!.y+25)
    await expect.poll(() => app.evaluate(({webContents},baseUrl) => webContents.getFocusedWebContents()?.getURL().startsWith(baseUrl) ?? false,url)).toBe(true)
    await page.getByTestId('workspace-web-preview-panel').getByRole('button',{name:'Collapse panel'}).click()
    await expect(page.getByTestId('browser-preview-native')).toHaveCount(0)
    await expect.poll(async () => app.evaluate(({webContents},baseUrl) => webContents.getAllWebContents().filter(contents => contents.getURL().startsWith(baseUrl)).length,url)).toBe(0)
    await page.getByTestId('btn-open-tools').click();await page.getByText('Web Preview',{exact:true}).click()
    await expect(page.locator('.web-preview-address-input')).toHaveValue(`${url}next`)
    await expect(page.getByTestId('browser-preview-native')).toHaveCount(1)
    await expect(page.getByLabel('Agent documentation access')).not.toBeChecked()
    expect((await run({action:'inspect'})).error).toContain('enable Agent documentation access')
    await page.getByRole('button',{name:'Close tab 1'}).click()
    await expect.poll(async () => app.evaluate(({webContents},baseUrl) => webContents.getAllWebContents().filter(contents => contents.getURL().startsWith(baseUrl)).length,url)).toBe(0)
    failPreview = true
    await page.locator('.web-preview-address-input').fill(`${url}failure`)
    await page.locator('.web-preview-address-input').press('Enter')
    await expect(page.getByText('Page unavailable')).toBeVisible()
    await expect(page.getByTestId('browser-preview-native')).toHaveCount(0)
    failPreview = false
    await page.getByRole('button',{name:'Retry'}).click()
    await expect(page.getByTestId('browser-preview-native')).toHaveCount(1)
    await expect(page.getByText('Page unavailable')).toHaveCount(0)
    await expect.poll(async () => app.evaluate(({webContents},baseUrl) => webContents.getAllWebContents().filter(contents => contents.getURL() === `${baseUrl}failure`).length,url)).toBe(1)
    const externalUrl = url.replace('127.0.0.1','localhost.')
    await page.locator('.web-preview-address-input').fill(externalUrl)
    await expect(page.getByRole('button',{name:'Go',exact:true})).toBeDisabled()
    await page.getByLabel('External',{exact:true}).check()
    await page.locator('.web-preview-address-input').press('Enter')
    await expect(page.locator('.web-preview-address-input')).toHaveValue(externalUrl)
    await expect.poll(() => app.evaluate(({webContents},baseUrl) => webContents.getAllWebContents().some(contents => contents.getURL().startsWith(baseUrl)),externalUrl)).toBe(true)
    await page.getByLabel('External',{exact:true}).uncheck()
    await expect(page.getByText('External access required')).toBeVisible()
    await expect(page.getByTestId('browser-preview-native')).toHaveCount(0)
  } finally {await app.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
})
