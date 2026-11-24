import { describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain ES module script without type declarations
import { loadInput, step } from '../../scripts/merge-train.mjs'

// OXE-404 (23/11): the train dropped #1130, labelled by an admin, as "no write access" because the permission lookup
// failed. A lookup that fails for GitHub's or the network's sake says nothing about the labeler: the car stays in the
// queue and the next step asks again. A role GitHub does answer, without write, still takes the car out, and so does
// a refusal that is not transient (the L3 case in merge-train.test.ts).

const NOW = Date.parse('2026-11-23T21:00:00Z')
const HEAD = 'a'.repeat(40)
const entry = { number: 7, labeledAt: '2026-11-23T20:00:00Z', labeledBy: 'maintainer' }
const green = [
  { name: 'CI result', headSha: HEAD, status: 'completed', conclusion: 'success' },
  { name: 'Changed paths', headSha: HEAD, status: 'completed', conclusion: 'success' },
]

function api(collaboratorRole: () => Promise<string | null>) {
  return {
    async getPull(number: number) {
      return {
        number, state: 'open', draft: false, isFork: false, headSha: HEAD, headRef: 'feat/x', mergeable: true,
        mergeableState: 'clean',
      }
    },
    async behindBy() { return 0 },
    async changesRequested() { return false },
    async listRuns() {
      return [{ name: 'CI and Release', path: '.github/workflows/ci.yml', headSha: HEAD, status: 'completed', conclusion: 'success', createdAt: '2026-11-23T20:10:00Z' }]
    },
    async listChecks() { return green },
    async requiredChecks() { return [] },
    async listComments() { return [] },
    async docsOnlySince() { return false },
    collaboratorRole,
  }
}

const httpError = (status: number, text: string) => Object.assign(new Error(`GET /repos/o/r/collaborators/maintainer/permission: ${status} ${text}`), { status })

async function decide(collaboratorRole: () => Promise<string | null>) {
  return step(await loadInput(api(collaboratorRole), entry, { now: NOW, timeoutMinutes: 60 }))
}

describe('OXE-404 · the labeler role lookup in the merge train', () => {
  it('keeps the car and retries when the lookup fails for GitHub or the network', async () => {
    const transient = [
      () => Promise.reject(httpError(502, 'Bad Gateway')),
      () => Promise.reject(httpError(500, 'Internal Server Error')),
      () => Promise.reject(httpError(429, 'Too Many Requests')),
      () => Promise.reject(httpError(403, '{"message":"You have exceeded a secondary rate limit"}')),
      () => Promise.reject(new TypeError('fetch failed')),
    ]
    for (const lookup of transient) {
      const action = await decide(lookup)
      expect(action.type).toBe('wait')
      expect(action.message).toMatch(/role of maintainer could not be read/)
      expect(action.message).not.toMatch(/no write access/)
    }
  })

  it('still takes the car out when GitHub answers a role without write, or refuses the lookup', async () => {
    for (const role of ['read', 'triage', null]) {
      const action = await decide(async () => role)
      expect(action.type).toBe('unlabel')
      expect(action.message).toMatch(/maintainer, who has no write access/)
    }
    expect((await decide(() => Promise.reject(httpError(403, 'Resource not accessible by integration')))).type).toBe('unlabel')
    expect((await decide(() => Promise.reject(httpError(404, 'Not Found')))).type).toBe('unlabel')
  })

  it('merges once the lookup answers write again', async () => {
    expect((await decide(async () => 'admin')).type).toBe('merge')
  })
})
