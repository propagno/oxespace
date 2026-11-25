// Frozen acceptance test for 1.6.0 program 160-152 (Jira OXE-152, A7: CA-1 and CA-2 of the card). Written by the
// planner; the executor must not edit it. src/components/Threads on main b3491f620 writes 119 raw <button> tags in 37
// files, and BRD-04.raw-button.count (main button:not([data-ui]) in the chat-conversation scene) is pending. Contract:
// no file of the folder writes a raw button (the folder's ratchet is zero, and this test keeps it there), and the measure
// expects 0, is enforced, and is in enforced.lock.json.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT, rawButtons, threadsSources } from './raw-buttons'

describe('OXE-152 · A7 src/components/Threads at zero', () => {
  it('no file in src/components/Threads has a raw button', () => {
    const files = threadsSources()
    expect(files.length).toBeGreaterThan(30)
    expect(files.flatMap(rel => { const count = rawButtons(rel); return count ? [`${rel}: ${count}`] : [] })).toEqual([])
  })

  it('BRD-04 raw-button count is enforced at zero', () => {
    const brd04 = JSON.parse(readFileSync(join(ROOT, 'src/design/targets/brd-04.json'), 'utf8')) as { measures: Array<{ id: string; expect: unknown; state: string }> }
    const measure = brd04.measures.find(item => item.id === 'BRD-04.raw-button.count')
    expect(measure, 'BRD-04.raw-button.count is a measure of BRD-04').toBeDefined()
    expect(measure!.expect).toEqual({ eq: 0 })
    expect(measure!.state).toBe('enforced')
    const lock = JSON.parse(readFileSync(join(ROOT, 'src/design/targets/enforced.lock.json'), 'utf8')) as { enforced: string[] }
    expect(lock.enforced).toContain('BRD-04.raw-button.count')
  })
})
