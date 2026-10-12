import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openInMemoryDatabase } from '../../electron/main/db'
import { DocumentationService } from '../../electron/main/services/documentation/documentation.service'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for(const fn of cleanup.splice(0)) await fn() })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(),'oxe-docs-'))
  const db = openInMemoryDatabase()
  cleanup.push(async()=>{db.close();await rm(directory,{recursive:true,force:true,maxRetries:5})})
  const service = new DocumentationService(db,directory)
  const job=service.create('project-A','Authentication manual','manual-key')
  const planned=service.checkpoint('project-A',job.id,0,[{id:'login',title:'Login',instruction:'Click Sign in',state:'pending'}],'JWT HttpOnly; continue with the dashboard.')
  const shot=vi.fn(async()=>({png:Buffer.from('test-png-data'),pageUrl:'http://localhost/login',width:800,height:600,redactionCount:1}))
  return {service,db,job:planned,directory,shot}
}
describe('durable documentation workflow',()=>{
  test('isolates projects and retains checkpoints for another session',async()=>{
    const f=await fixture()
    expect(f.service.create('project-A','Authentication manual','manual-key').id).toBe(f.job.id)
    expect(()=>f.service.get('project-B',f.job.id)).toThrow('not found')
    expect(f.service.create('project-B','Authentication manual','manual-key').id).not.toBe(f.job.id)
    const nextSession=new DocumentationService(f.db,f.directory)
    expect(nextSession.get('project-A',f.job.id).notes).toContain('JWT HttpOnly')
    expect(nextSession.history('project-A',f.job.id)).toHaveLength(1)
    expect(()=>nextSession.checkpoint('project-A',f.job.id,0,[])).toThrow('Revision conflict')
  })
  test('concurrent capture retries share an operation and never duplicate a screenshot',async()=>{
    const f=await fixture()
    const [a,b]=await Promise.all([f.service.capture('project-A',f.job.id,1,'login','shot-1',{},f.shot),f.service.capture('project-A',f.job.id,1,'login','shot-1',{},f.shot)])
    expect(a.id).toBe(b.id);expect(f.shot).toHaveBeenCalledTimes(1)
    const retried=await f.service.capture('project-A',f.job.id,1,'login','shot-1',{},f.shot)
    expect(retried.state).toBe('succeeded');expect(f.shot).toHaveBeenCalledTimes(1)
    expect(f.service.get('project-A',f.job.id).artifacts).toHaveLength(1)
    await expect(f.service.capture('project-A',f.job.id,2,'login','shot-1',{mode:'full'},f.shot)).rejects.toThrow('key conflict')
  })
  test('capture failure is recoverable without repeating any click and exports flag review',async()=>{
    const f=await fixture();f.shot.mockRejectedValueOnce(new Error('Preview unavailable'))
    expect((await f.service.capture('project-A',f.job.id,1,'login','shot-1',{},f.shot)).state).toBe('failed')
    expect((await f.service.capture('project-A',f.job.id,1,'login','shot-1',{},f.shot)).state).toBe('succeeded')
    const exported=await f.service.export('project-A',f.job.id,2,'export-1')
    const result=exported.result as {markdown:string;html:string;warnings:string[]}
    expect(exported.state).toBe('succeeded');expect(result.warnings).toContain('Step 1 needs review')
    expect(await readFile(result.markdown,'utf8')).toContain('Click Sign in')
    expect(await readFile(result.html,'utf8')).toContain('default-src')
  })
  test('restart marks unfinished operations interrupted and corrupt screenshots block export',async()=>{
    const f=await fixture()
    const captured=await f.service.capture('project-A',f.job.id,1,'login','shot-1',{},f.shot)
    const job=f.service.get('project-A',f.job.id)
    await writeFile(join(f.directory,job.id,job.artifacts[0].filename),'changed')
    expect((await f.service.export('project-A',job.id,2,'export-1')).state).toBe('failed')
    f.db.prepare('UPDATE documentation_operations SET payload=? WHERE id=?').run(JSON.stringify({...captured,state:'running'}),captured.id)
    new DocumentationService(f.db,f.directory)
    expect(f.service.operations('project-A',job.id).find(o=>o.id===captured.id)?.state).toBe('interrupted')
  })
  test('manual HTML escapes agent content instead of executing it',async()=>{
    const f=await fixture()
    f.service.checkpoint('project-A',f.job.id,1,[{id:'x',title:'<script>alert(1)</script>',instruction:'<img src=https://example.invalid>',state:'pending'}])
    const op=await f.service.export('project-A',f.job.id,2,'html')
    const source=await readFile((op.result as {html:string}).html,'utf8')
    expect(source).toContain('&lt;script&gt;');expect(source).not.toContain('<script>')
  })
})
