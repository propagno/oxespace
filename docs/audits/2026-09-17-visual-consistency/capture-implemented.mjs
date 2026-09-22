import { _electron as electron, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Read-only UI audit in an isolated Electron profile, with synthetic conversations.
const output = join(dirname(fileURLToPath(import.meta.url)), 'implemented'); mkdirSync(output, { recursive: true })
const root = mkdtempSync(join(tmpdir(), 'oxe-visual-audit-'))
const repo = join(root, 'audit-project'); mkdirSync(repo)
const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
  ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3')
} })
const records = []
try {
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1280, height: 720 })
  const capture = async (name, selectors) => {
    await page.mouse.move(1200, 300)
    await page.waitForTimeout(250) // settle shell transitions and late-loaded fonts
    const values = await page.evaluate(selectors => {
      const props = ['display','flexDirection','gridTemplateColumns','gap','padding','margin','fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','textTransform','color','backgroundColor','backgroundImage','borderRadius','borderTopColor','borderRightColor','boxShadow','outline','outlineOffset','overflowY','scrollbarWidth','scrollbarGutter','transitionDuration']
      const one = el => {
        const style = getComputedStyle(el), rect = el.getBoundingClientRect()
        const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        const color = css => { ctx.clearRect(0,0,1,1); ctx.fillStyle = css; ctx.fillRect(0,0,1,1); return Array.from(ctx.getImageData(0,0,1,1).data) }
        const chain = []; for (let p=el;p;p=p.parentElement) chain.unshift(p)
        let bg=[0,0,0]
        for(const p of chain) { const rgba = color(getComputedStyle(p).backgroundColor); bg=bg.map((c,i)=>c*(1-rgba[3]/255)+rgba[i]*rgba[3]/255) }
        const fg=color(style.color), text=bg.map((c,i)=>c*(1-fg[3]/255)+fg[i]*fg[3]/255)
        const lum = rgb => rgb.map(c => c/255).map(c => c<=.04045 ? c/12.92 : ((c+.055)/1.055)**2.4).reduce((total,c,i)=>total+c*[.2126,.7152,.0722][i],0)
        const l1=lum(text),l2=lum(bg)
        return { text: (el.textContent ?? '').trim().slice(0,100), ariaLabel:el.getAttribute('aria-label'), tag:el.tagName, role:el.getAttribute('role'), disabled:el.hasAttribute('disabled'), box:{ x:rect.x,y:rect.y,width:rect.width,height:rect.height }, css:Object.fromEntries(props.map(p=>[p,style[p]])), contrastFlat:Math.round((Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)*100)/100, backdrop:getComputedStyle(el,'::backdrop').backgroundColor, scroll:{client:el.clientHeight,total:el.scrollHeight}, icons:Array.from(el.querySelectorAll('svg')).map(icon=>({width:icon.getBoundingClientRect().width,height:icon.getBoundingClientRect().height})) }
      }
      return { theme:document.documentElement.dataset.theme, density:document.documentElement.dataset.density, viewport:{ width:innerWidth,height:innerHeight }, elements:Object.fromEntries(Object.entries(selectors).map(([key,selector])=>[key,Array.from(document.querySelectorAll(selector)).filter(el=>el.getBoundingClientRect().height>0).map(one)])) }
    }, selectors)
    records.push({ name,...values }); writeFileSync(join(output,'measurements.json'),JSON.stringify(records,null,2))
    await page.screenshot({path:join(output,`${name}.png`)})
    console.log(`Captured ${name}`)
  }
  const code = { sidebar:'.sidebar', brand:'.desktop-nav-brand', mode:'.desktop-mode-select', footer:'.sidebar-footer', footerButtons:'.sidebar-footer button', sectionCaption:'.sidebar-section-header > span', projectName:'.ws-group-name', branch:'.ws-group-branch-row', terminalRows:'.pane-session-row', search:'.sidebar .desktop-search', searchInput:'.sidebar-search-input', searchIcon:'.desktop-search>svg', modeButtons:'.desktop-mode-select button', caption:'.sidebar-section-header > span', quickSearch:'.sidebar-quick-nav button', scroll:'.ws-group-list', workspaceHeader:'.workspace-topbar', headerTitle:'.workspace-topbar-name', providerGlyph:'.pane-tab-agent'  }
  const thread = { sidebar:'.thread-navigation', brand:'.desktop-nav-brand', mode:'.desktop-mode-select', footer:'.thread-nav-footer', footerButtons:'.thread-nav-footer button', sectionCaption:'.thread-project-list h2', projectName:'.thread-project-toggle', threadRows:'.thread-navigation-item', search:'.thread-nav-search', searchIcon:'.thread-nav-search>svg', searchInput:'.thread-nav-search input', modeButtons:'.desktop-mode-select button', newAction:'.thread-new-action', scroll:'.thread-project-list', workspaceHeader:'.thread-heading', headerTitle:'.thread-heading h1', composer:'.thread-composer', providerGlyph:'.agent-provider-icon' }
  await page.getByTestId('btn-new-workspace').click()
  await page.getByTestId('wizard-dir-input').fill(repo)
  await page.getByTestId('wizard-layout-card-2').click()
  await page.getByTestId('wizard-launch-btn').click()
  await page.locator('.workspace-host:not(.workspace-host-hidden)').waitFor()
  let workspace = (await page.evaluate(() => window.oxe.workspace.list()))[0]
  await page.getByRole('button',{name:'Open settings',exact:true}).click()
  await page.getByLabel('Settings scope').selectOption(workspace.id)
  await page.getByRole('radio',{name:'One Dark',exact:true}).click()
  await page.getByRole('button',{name:'Save workspace settings',exact:true}).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme','one-dark')
  await page.getByRole('button',{name:'Close settings',exact:true}).click()
  await page.locator('.settings-center').waitFor({state:'hidden'})
  workspace = (await page.evaluate(() => window.oxe.workspace.list()))[0]
  // The synthetic timeline is intentionally independent of providers and credentials.
  await app.evaluate(({ipcMain}, ws) => {
    const t={id:'audit-thread',workspaceId:ws.id,projectId:'audit-project',rootPath:ws.rootPath,provider:'claude',nativeSessionId:null,title:'Review application navigation',pinned:false,status:'idle',createdAt:Date.now(),updatedAt:Date.now()}
    const other=[{...t,id:'audit-failed',title:'Expired account recovery',status:'failed',updatedAt:Date.now()-60000},{...t,id:'audit-running',title:'Review changes',status:'running',updatedAt:Date.now()-120000}]
    for(const name of ['list','read','projects'])ipcMain.removeHandler(`thread:${name}`)
    ipcMain.handle('thread:list',()=>[t,...other])
    ipcMain.handle('thread:projects',()=>({projects:[{projectId:'audit-project',displayName:'audit-project',identityLabel:ws.rootPath,contexts:[{workspaceId:ws.id,rootPath:ws.rootPath,label:'main'}]}],unavailable:[]}))
    ipcMain.handle('thread:read',(_event,id)=>({thread:[t,...other].find(x=>x.id===id),events:[{type:'message',id:'user',role:'user',text:'Review the visual structure of this application.'},{type:'message',id:'assistant',role:'assistant',text:'The navigation should preserve a predictable structure when switching modes.\n\n- Use a consistent sidebar width.\n- Keep Settings in the same position.\n- Preserve distinct project and conversation content.'},{type:'completed',status:'completed'}]}))
    ipcMain.removeHandler('agent-account:read')
    ipcMain.handle('agent-account:read',(_event,context)=>({scopeId:context.provider,provider:context.provider,state:'disconnected',method:'unknown',checkedAt:Date.now()}))
    for(const channel of ['rtk:get-status','rtk:check-for-update']){ipcMain.removeHandler(channel);ipcMain.handle(channel,()=>({installed:true,version:'v0.49.0',latestVersion:'v0.49.0',updateAvailable:false,binDir:null,error:null,checking:false,updating:false,lastCheckedAt:Date.now()}))}
  },workspace)
  const theme = () => page.evaluate(() => { document.documentElement.dataset.theme='one-dark' })
  await theme(); await capture('code-expanded',code)
  await page.getByTestId('btn-new-workspace').click()
  await page.getByTestId('wizard-dir-input').waitFor()
  await capture('code-new-workspace', {dialog:'.new-workspace-modal-v2', title:'.new-workspace-modal-v2 h2', buttons:'.new-workspace-modal-v2 .modal-actions button', overlay:'[data-slot="dialog-overlay"]'})
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click()
  await capture('code-collapsed',code)
  await page.getByRole('button',{name:'Expand sidebar',exact:true}).click()
  await page.getByTestId('btn-open-tools').click()
  await page.getByTestId('tools-modal').waitFor()
  await capture('code-tools', {dialog:'[data-testid="tools-modal"]', title:'[data-testid="tools-modal"] h2', cards:'.tools-modal-featured', overlay:'[data-slot="dialog-overlay"]'})
  await page.keyboard.press('Escape')
  await page.getByRole('navigation',{name:'Application view'}).getByRole('button',{name:'Thread',exact:true}).click()
  await page.getByRole('textbox',{name:'Message',exact:true}).waitFor()
  await theme();await capture('thread-expanded',thread)
  await page.getByRole('button',{name:'Agent accounts',exact:true}).click()
  await capture('thread-accounts', {dialog:'.thread-accounts-dialog', title:'.thread-accounts-dialog h2', buttons:'.thread-account-actions button', footer:'.thread-accounts-dialog>footer', glyph:'.thread-accounts-dialog .agent-provider-icon'})
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'New thread',exact:true}).click()
  await capture('thread-new', {dialog:'.thread-create-dialog', title:'.thread-create-dialog h2', buttons:'.thread-create-dialog footer button'})
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click()
  await capture('thread-collapsed',thread)
  await page.getByRole('button',{name:'Expand sidebar',exact:true}).click()
  await page.getByRole('button',{name:'Open settings',exact:true}).click()
  const settings={ sidebar:'.settings-center-nav', footer:'.settings-nav-footer', footerButtons:'.settings-nav-footer button', nav:'.settings-center-nav>nav button', search:'.settings-search', searchIcon:'.settings-search>svg', searchInput:'.settings-search input', description:'.settings-content-description', kicker:'.settings-content-kicker', header:'.settings-center-toolbar', title:'.settings-content-header h2', primary:'.settings-center .settings-btn.primary', pill:'.settings-status-pill', scroll:'.settings-center-content' }
  await page.getByLabel('Settings scope').selectOption('application')
  await page.getByRole('navigation',{name:'Settings categories'}).getByRole('button',{name:/^Updates/}).click()
  await capture('settings-updates',settings)
  await page.getByRole('navigation',{name:'Settings categories'}).getByRole('button',{name:/^Terminal/}).click()
  await capture('settings-terminal',settings)
  await page.getByLabel('Settings scope').selectOption(workspace.id)
  await capture('settings-workspace',{...settings,primary:'.modal-actions .primary-action', title:'.ws-settings-page-heading h3', theme:'.theme-card', sectionHeading:'.ws-settings-section-header h3'})
  // Capture how the unchanged theme responds to comfortable density.
  await page.getByRole('button',{name:'Close settings',exact:true}).click()
  await page.evaluate(()=>{document.documentElement.dataset.density='comfortable'})
  await capture('thread-comfortable',thread)
  await page.getByRole('navigation',{name:'Application view'}).getByRole('button',{name:'Code',exact:true}).click()
  await capture('code-comfortable',code)
  await page.evaluate(()=>{document.documentElement.dataset.density='compact'})
  await page.getByRole('navigation',{name:'Application view'}).getByRole('button',{name:'Thread',exact:true}).click()
  for(const width of [960,900,600]) {
    await page.setViewportSize({width,height:width===960 ? 640 : 600})
    await capture(`thread-${width}`,thread)
    await page.getByRole('navigation',{name:'Application view'}).getByRole('button',{name:'Code',exact:true}).click()
    await theme();await capture(`code-${width}`,code)
    await page.getByRole('button',{name:'Open settings',exact:true}).click()
    await page.getByLabel('Settings scope').selectOption('application')
    if(width>=899)await page.getByRole('navigation',{name:'Settings categories'}).getByRole('button',{name:/^Updates/}).click()
    else await page.getByLabel('Settings category').selectOption('updates')
    await capture(`settings-${width}`,settings)
    await page.getByRole('button',{name:'Close settings',exact:true}).click()
    await page.getByRole('navigation',{name:'Application view'}).getByRole('button',{name:'Thread',exact:true}).click()
  }
  await page.setViewportSize({width:1280,height:720})
  const footer = page.locator('.thread-nav-footer').getByRole('button',{name:'Open settings',exact:true})
  await footer.press('Tab'); await page.keyboard.press('Shift+Tab')
  await capture('thread-footer-focus',{footerButtons:'.thread-nav-footer button'})
  await page.getByRole('navigation',{name:'Application view'}).getByRole('button',{name:'Code',exact:true}).click()
  const codeFooter = page.locator('.sidebar-footer').getByRole('button',{name:'Open settings',exact:true})
  await codeFooter.focus(); await codeFooter.press('Tab'); await page.keyboard.press('Shift+Tab')
  await capture('code-footer-focus',{footerButtons:'.sidebar-footer button'})
  await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click()
  const tools = page.getByTestId('btn-open-tools'); await tools.focus(); await tools.press('Tab'); await page.keyboard.press('Shift+Tab')
  await capture('code-collapsed-focus',{footerButtons:'.sidebar-footer button'})
} finally { await app.close() }
