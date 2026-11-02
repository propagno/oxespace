import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { REMOTE_APPROVAL_RISKS, type RemoteApprovalRisk, type RemotePendingRequest } from '../shared/remote/protocol'
import { APPROVAL_RISKS } from '../shared/types/approvals'

describe('C5 · the phone reads the desktop\'s four risk words (CCR #364)', () => {
  it('uses one list, equal to the desktop approval modal\'s, in the same order', () => {
    expect([...REMOTE_APPROVAL_RISKS]).toEqual([...APPROVAL_RISKS])
  })

  it('types a pending request\'s risk with exactly those words, no colours', () => {
    // tests/ is not type-checked by tsc, so read the field from the source too.
    const source = readFileSync(join('shared', 'remote', 'protocol.ts'), 'utf8')
    const block = source.slice(source.indexOf('export interface RemotePendingRequest {'), source.indexOf('export interface RemotePendingRequestsData'))
    const field = /\n\s*risk\?: ([^\n]+)\n/.exec(block)?.[1] ?? ''
    expect([...field.matchAll(/'([a-z]+)'/g)].map(match => match[1])).toEqual([...REMOTE_APPROVAL_RISKS])
    expect(field).not.toMatch(/green|orange|red/)
    expectTypeOf<NonNullable<RemotePendingRequest['risk']>>().toEqualTypeOf<RemoteApprovalRisk>()
  })
})
