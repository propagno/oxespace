// #858 (OXE-77): a returning user who restarts never lands on the first run. The first run starts only on a project
// catalog read as empty; a catalog still pending or that failed to read is not an empty profile.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { firstRunGate } from '../src/app/firstRunGate'

const base = { isLoading: false, firstRunOpen: true, started: false }

describe('first run gate (OXE-77)', () => {
  it('a fresh profile, its catalog read as empty, starts and shows the first run', () => {
    expect(firstRunGate({ ...base, projectsState: 'loaded', projectCount: 0 })).toEqual({ start: true, show: true, pending: false })
  })

  it('once started it stays when step 1 adds the folder\'s project', () => {
    expect(firstRunGate({ ...base, started: true, projectsState: 'loaded', projectCount: 1 })).toMatchObject({ show: true })
  })

  it('a returning user after a restart: pending catalog shows the loading state, then the project keeps the first run away', () => {
    expect(firstRunGate({ ...base, projectsState: 'pending', projectCount: 0 })).toEqual({ start: false, show: false, pending: true })
    expect(firstRunGate({ ...base, projectsState: 'loaded', projectCount: 1 })).toEqual({ start: false, show: false, pending: false })
  })

  it('a catalog that failed to read is not "no projects": no first run, no loading state forever', () => {
    expect(firstRunGate({ ...base, projectsState: 'failed', projectCount: 0 })).toEqual({ start: false, show: false, pending: false })
  })

  it('a saved workspace or the workspace store still loading rules the first run out', () => {
    expect(firstRunGate({ ...base, firstRunOpen: false, projectsState: 'loaded', projectCount: 0 })).toMatchObject({ start: false, show: false })
    expect(firstRunGate({ ...base, isLoading: true, projectsState: 'loaded', projectCount: 0 })).toMatchObject({ start: false, show: false, pending: false })
  })
})

describe('thread store projectsState (OXE-77)', () => {
  beforeEach(() => { vi.resetModules() })

  async function storeWith(projects: () => Promise<unknown>): Promise<typeof import('../src/store/thread.store')['useThreadStore']> {
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { projects } } })
    return (await import('../src/store/thread.store')).useThreadStore
  }

  it('starts pending and is loaded after a read', async () => {
    const store = await storeWith(async () => ({ projects: [], unavailable: [] }))
    expect(store.getState().projectsState).toBe('pending')
    await store.getState().loadProjects()
    expect(store.getState().projectsState).toBe('loaded')
  })

  it('is failed after a read that fails, and a failure never undoes a good read', async () => {
    let fail = true
    const store = await storeWith(async () => { if (fail) throw new Error('db locked'); return { projects: [], unavailable: [] } })
    await store.getState().loadProjects()
    expect(store.getState().projectsState).toBe('failed')
    fail = false
    await store.getState().loadProjects()
    expect(store.getState().projectsState).toBe('loaded')
    fail = true
    await store.getState().loadProjects()
    expect(store.getState().projectsState).toBe('loaded')
  })
})
