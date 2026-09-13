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
  const servicePath=join(root,'preview.cjs')
  await build({entryPoints:['electron/main/services/documentation/preview-automation.ts'],outfile:servicePath,bundle:true,platform:'node',format:'cjs',external:['electron']})
  const server=createServer((_,res)=>{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><body style="margin:20px;background:white"><h1>Customer guide</h1><input id="name" value="PRIVATE" style="width:200px;height:40px;background:red"><button id="save" onclick="document.querySelector('h1').textContent='Saved '+document.querySelector('input').value">Save</button><div id="panel" style="height:1200px">Details</div></body></html>`)})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const address=server.address();const url=`http://127.0.0.1:${typeof address==='object' && address ? address.port : 0}/`
  const app=await electron.launch({args:[join(process.cwd(),'e2e/electron-main.cjs')],env:{...process.env,OXESPACE_E2E_PREVIEW_SERVICE:servicePath,OXESPACE_DISABLE_SINGLE_INSTANCE:'1',OXESPACE_E2E_MOCK_NATIVE:'1',OXESPACE_DB_PATH:join(root,'db.sqlite3')}})
  try {
    const page=await app.firstWindow()
    await page.getByTestId('btn-new-workspace').click();await page.getByTestId('wizard-dir-input').fill(repo);await page.getByTestId('wizard-launch-btn').click()
    await page.getByTestId('btn-open-tools').click();await page.getByText('Web Preview',{exact:true}).click()
    await page.locator('.web-preview-address-input').fill(url);await page.locator('.web-preview-address-input').press('Enter')
    const view=page.getByTestId('web-preview-webview');await expect(view).toBeVisible()
    const workspaceId=(await view.getAttribute('data-workspace-id'))!
    const run=(input:PreviewRequest,ws=workspaceId)=>app.evaluate(async (_,{input,ws})=>{
      try {return {result:await (globalThis as unknown as {preview:PreviewAutomation}).preview.run(ws,input,()=>{})}}
      catch(e){return {error:(e as Error).message}}
    },{input,ws})
    expect((await run({action:'inspect'})).error).toContain('enable Agent documentation access')
    page.once('dialog',dialog=>dialog.accept());await page.getByLabel('Agent documentation access').check()
    await expect.poll(async()=> (await run({action:'inspect'})).error).toBeUndefined()
    const inspected=await run({action:'inspect'})
    expect(JSON.stringify(inspected)).toContain('Customer guide');expect(JSON.stringify(inspected)).not.toContain('PRIVATE')
    expect((await run({action:'inspect'},'foreign-workspace')).error).toBeTruthy()
    // Native confirmation is controlled only inside the isolated test process.
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false})})
    expect((await run({action:'click',selector:'#save',expectedUrl:url})).error).toContain('declined')
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false})})
    expect((await run({action:'fill',selector:'#name',text:'Example',expectedUrl:url})).error).toBeUndefined()
    expect((await run({action:'click',selector:'#save',expectedUrl:url})).error).toBeUndefined()
    await expect.poll(async()=>JSON.stringify(await run({action:'inspect'}))).toContain('Saved Example')
    // Font metrics differ across Windows/Linux runners. Sample the actual
    // input center rather than a fixed coordinate that may hit white space.
    const maskPoint = await app.evaluate(({webContents}) => webContents.getAllWebContents().find(c=>c.getType()==='webview')!.executeJavaScript("(() => { const r=document.querySelector('#name').getBoundingClientRect(); return {x:Math.floor(r.left+r.width/2),y:Math.floor(r.top+r.height/2)} })()")) as {x:number;y:number}
    const shot=await app.evaluate(async (_,{workspaceId,options})=>{
      const s=await (globalThis as unknown as {preview:PreviewAutomation}).preview.capture(workspaceId,options,()=>{})
      return {...s,png:s.png.toString('base64')}
    },{workspaceId,options:{mode:'viewport',highlight:['#save']} as ScreenshotOptions})
    expect(shot.height).toBeGreaterThan(100);expect(shot.redactionCount).toBeGreaterThan(0)
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
    await page.screenshot({path:test.info().outputPath('documentation-preview-ui.png')})
    const guestClean=await app.evaluate(({webContents})=>webContents.getAllWebContents().find(c=>c.getType()==='webview')!.executeJavaScript("document.querySelectorAll('[data-oxe-capture]').length"))
    expect(guestClean).toBe(0)
    await page.getByLabel('Agent documentation access').uncheck()
    expect((await run({action:'inspect'})).error).toContain('enable Agent documentation access')
  } finally {await app.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
})
