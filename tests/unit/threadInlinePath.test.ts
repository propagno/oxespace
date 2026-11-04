import { describe, expect, it } from 'vitest'
import type { ThreadEvent, ThreadRequest } from '../../shared/types/thread'
import { inlinePathPlaces, inlinePathRoots, resolveInlinePath, turnWorkingDirectory, type InlinePathContext } from '../../src/components/Threads/threadInlinePath'

/**
 * T70, from the user: the agent wrote gravar-poc-prd.js in ~/rebate-137526/prd-0311, and clicking `gravar-poc-prd.js`
 * in its answer said the file did not exist: inline paths were looked up in the project root only.
 */
const project = '/home/u/rebate-137526'
const worktree = '/home/u/rebate-137526-wt'
const thread = (moved = false): InlinePathContext['thread'] => ({
  rootPath: project,
  ...(moved ? { observedLocation: { cwd: worktree, checkoutRoot: worktree, sameRepository: true } as never } : {})
})
const on = (...files: string[]) => async (place: { root: string; relativePath: string }) => files.includes(`${place.root}/${place.relativePath}`)

describe('T70 · inline path lookup order', () => {
  it('1. an absolute path opens as is, from the root it is under', async () => {
    const result = await resolveInlinePath(`${worktree}/src/a.ts:12`, { cwd: `${project}/prd-0311`, thread: thread(true) }, on(`${worktree}/src/a.ts`, `${project}/prd-0311/src/a.ts`))
    expect(result).toEqual({ found: { fullPath: `${worktree}/src/a.ts`, root: worktree, relativePath: 'src/a.ts' } })
  })

  it("2. a relative path opens from the turn's folder first", async () => {
    const result = await resolveInlinePath('gravar-poc-prd.js', { cwd: `${project}/prd-0311`, thread: thread() }, on(`${project}/prd-0311/gravar-poc-prd.js`, `${project}/gravar-poc-prd.js`))
    expect(result).toEqual({ found: { fullPath: `${project}/prd-0311/gravar-poc-prd.js`, root: project, relativePath: 'prd-0311/gravar-poc-prd.js' } })
  })

  it('3. then from the worktree the conversation moved into', async () => {
    const result = await resolveInlinePath('./src/b.ts', { cwd: `${project}/prd-0311`, thread: thread(true) }, on(`${worktree}/src/b.ts`, `${project}/src/b.ts`))
    expect(result).toEqual({ found: { fullPath: `${worktree}/src/b.ts`, root: worktree, relativePath: 'src/b.ts' } })
  })

  it('4. then from the project root', async () => {
    const result = await resolveInlinePath('src/c.ts', { cwd: `${project}/prd-0311`, thread: thread(true) }, on(`${project}/src/c.ts`))
    expect(result).toEqual({ found: { fullPath: `${project}/src/c.ts`, root: project, relativePath: 'src/c.ts' } })
  })

  it('names every place it looked in when none has the file', async () => {
    const result = await resolveInlinePath('missing.js', { cwd: `${project}/prd-0311`, thread: thread(true) }, on())
    expect(result).toEqual({ looked: [`${project}/prd-0311/missing.js`, `${worktree}/missing.js`, `${project}/missing.js`] })
  })

  it('a check that fails counts as not there, and the next place is tried', async () => {
    const result = await resolveInlinePath('d.ts', { thread: thread() }, async () => { throw new Error('refused') })
    expect(result).toEqual({ looked: [`${project}/d.ts`] })
  })

  it('a folder under neither root is named but never opened', async () => {
    let asked = 0
    const result = await resolveInlinePath('e.ts', { cwd: '/tmp/elsewhere', thread: thread() }, async () => { asked += 1; return false })
    expect(result).toEqual({ looked: ['/tmp/elsewhere/e.ts', `${project}/e.ts`] })
    expect(asked).toBe(1)
  })

  it('Windows paths compare without case and keep one place per folder', () => {
    const places = inlinePathPlaces('src\\f.ts', { cwd: 'C:\\Repo\\', thread: { rootPath: 'c:\\repo' } })
    // It opens from the thread's own root, spelled as the thread has it: that is the root main accepts.
    expect(places).toEqual([{ fullPath: 'c:/repo/src/f.ts', root: 'c:/repo', relativePath: 'src/f.ts' }])
  })
})

describe('T70 · where the turn worked and which roots open', () => {
  const request = (cwd?: string): ThreadEvent => ({ type: 'request', id: `r${cwd}`, request: { id: 'r', nativeId: 'n', nativeMethod: 'm', kind: 'approval', title: 't', generation: 1, createdAt: 1, state: 'resolved', ...(cwd ? { cwd } : {}) } as ThreadRequest })
  it("the turn's folder is its last request's cwd", () => {
    expect(turnWorkingDirectory([request('/a'), request(), request('/b'), { type: 'delta', id: 'd', text: 'x' }])).toBe('/b')
    expect(turnWorkingDirectory([{ type: 'delta', id: 'd', text: 'x' }])).toBeUndefined()
  })
  it('the roots are the worktree, then the project root, once each', () => {
    expect(inlinePathRoots(thread(true))).toEqual([worktree, project])
    expect(inlinePathRoots(thread())).toEqual([project])
  })
})
