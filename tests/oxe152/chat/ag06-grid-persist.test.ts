// Frozen acceptance test for 1.5.2 Polimento 2 (Jira OXE-188, AG-06, CA-5; A21). Written by the planner; the executor must
// not edit it. The side-by-side layout comes back after a restart: src/store/thread.store.ts already keeps selectedId and
// secondaryId in the persisted "oxe.thread-navigation" entry; on main f65fa5374 neither the share between the columns
// nor the active column survives.
// Contract: the persisted entry also keeps splitRatio and activeCell. When read back (merge): a number splitRatio is
// clampSplitRatio'd (src/components/Threads/threadGridLayout.ts), anything else is 50; activeCell is "secondary" only
// when a secondaryId came back with it, else "primary". The app has one main window, whose renderer owns this entry.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { SPLIT_RATIO_DEFAULT, SPLIT_RATIO_MAX, SPLIT_RATIO_MIN, clampSplitRatio } from '../../../src/components/Threads/threadGridLayout'
import { useThreadStore } from '../../../src/store/thread.store'

const KEY = 'oxe.thread-navigation'
const saved = (): Record<string, unknown> => (JSON.parse(localStorage.getItem(KEY) ?? '{}') as { state?: Record<string, unknown> }).state ?? {}
async function restore(state: Record<string, unknown>): Promise<void> {
  localStorage.setItem(KEY, JSON.stringify({ state, version: 0 }))
  await useThreadStore.persist.rehydrate()
}

beforeEach(() => { localStorage.clear(); useThreadStore.setState({ selectedId: null, secondaryId: null, activeCell: 'primary' } as never) })
afterEach(() => { localStorage.clear() })

describe('OXE-188 · AG-06 the side-by-side layout survives a restart', () => {
  test('splitRatio and activeCell persist and rehydrate per window across reloads', async () => {
    expect([SPLIT_RATIO_MIN, SPLIT_RATIO_MAX, SPLIT_RATIO_DEFAULT, clampSplitRatio(99), clampSplitRatio(12), clampSplitRatio(57.4)]).toEqual([35, 65, 50, 65, 35, 57])
    useThreadStore.setState({ selectedId: 'conv-a', secondaryId: 'conv-b' } as never)
    useThreadStore.getState().setSplitRatio(65)
    useThreadStore.getState().setActiveCell('secondary')
    expect(saved()).toMatchObject({ selectedId: 'conv-a', secondaryId: 'conv-b', splitRatio: 65, activeCell: 'secondary' })

    useThreadStore.setState({ selectedId: null, secondaryId: null, activeCell: 'primary' } as never)
    useThreadStore.getState().setSplitRatio(50)
    await restore({ selectedId: 'conv-a', secondaryId: 'conv-b', splitRatio: 65, activeCell: 'secondary' })
    expect(useThreadStore.getState()).toMatchObject({ selectedId: 'conv-a', secondaryId: 'conv-b', splitRatio: 65, activeCell: 'secondary' })

    // Whatever was saved, the layout read back is one the screen can show.
    await restore({ selectedId: 'conv-a', secondaryId: null, splitRatio: 99, activeCell: 'secondary' })
    expect(useThreadStore.getState()).toMatchObject({ secondaryId: null, splitRatio: 65, activeCell: 'primary' })
    await restore({ selectedId: 'conv-a', secondaryId: 'conv-b', splitRatio: 'wide', activeCell: 'left' })
    expect(useThreadStore.getState()).toMatchObject({ splitRatio: 50, activeCell: 'primary' })
    await restore({ selectedId: 'conv-a', secondaryId: 'conv-b', splitRatio: 12 })
    expect(useThreadStore.getState().splitRatio).toBe(35)
  })
})
