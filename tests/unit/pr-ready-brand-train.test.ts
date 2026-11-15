// @vitest-environment node
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain ES module script without type declarations
import { brandEvidenceAcross } from '../../scripts/pr-ready.mjs'
// @ts-expect-error -- a plain ES module script without type declarations
import { isTrainUpdate, SKIP_CI_NOTE } from '../../scripts/merge-train.mjs'

const APPROVED = 'a'.repeat(40)
const MERGE = 'b'.repeat(40)
const status = (context: string, state: string) => ({ context, state, description: '' })

describe('pr:ready\'s brand gate across the train\'s merge of main (OXE-276)', () => {
  it('a train merge head over an approved head passes, citing it', () => {
    // The train's update is recognised the same way the train itself skips it.
    expect(isTrainUpdate({ parents: [APPROVED, 'c'.repeat(40)], message: `Merge branch 'main' into oxe-182-scope-badge\n\n${SKIP_CI_NOTE}` })).toBe(true)
    const chain = [
      // CI posts marca/conformidade on the merge head; MARCA's fidelidade stays on the head she approved.
      { sha: MERGE, statuses: [status('marca/conformidade', 'success')] },
      { sha: APPROVED, statuses: [status('marca/fidelidade', 'success'), status('marca/conformidade', 'success')] }
    ]
    expect(brandEvidenceAcross(chain, ['marca/conformidade', 'marca/fidelidade'])).toEqual({ ok: true, missing: [], from: [MERGE, APPROVED] })
  })

  it('an interface change after the approved head fails: the chain stops at the author\'s commit', () => {
    // The author's own commit is not a train update, so brandStep never reaches the approved head behind it.
    expect(isTrainUpdate({ parents: [APPROVED], message: 'fix(ui): the badge moves left' })).toBe(false)
    const chain = [{ sha: MERGE, statuses: [status('marca/conformidade', 'success')] }]
    const evidence = brandEvidenceAcross(chain, ['marca/conformidade', 'marca/fidelidade'])
    expect(evidence.ok).toBe(false)
    expect(evidence.missing).toEqual(['marca/fidelidade has not been posted'])
  })

  it('the newest status of a context wins, along the chain too: a failure on the head is not hidden by an older success', () => {
    const chain = [
      { sha: MERGE, statuses: [status('marca/conformidade', 'failure')] },
      { sha: APPROVED, statuses: [status('marca/fidelidade', 'success'), status('marca/conformidade', 'success')] }
    ]
    const evidence = brandEvidenceAcross(chain, ['marca/conformidade', 'marca/fidelidade'])
    expect(evidence.ok).toBe(false)
    expect(evidence.missing).toEqual(['marca/conformidade is failure'])
  })
})
