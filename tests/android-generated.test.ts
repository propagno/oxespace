import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as protocol from '../shared/remote/protocol'
// @ts-expect-error plain ESM script without types
import { constantName, PROTOCOL_KOTLIN_PATH, protocolKotlin } from '../scripts/android/protocol-kotlin.mjs'

const root = join(__dirname, '..')
const protocolSource = readFileSync(join(root, 'shared', 'remote', 'protocol.ts'), 'utf8')

describe('Android sources generated from the contracts', () => {
  it('match the committed Kotlin of the C5 protocol (run npm run android:generate after a contract change)', () => {
    const committed = readFileSync(join(root, PROTOCOL_KOTLIN_PATH), 'utf8').replace(/\r\n/g, '\n')
    expect(committed).toBe(protocolKotlin(protocolSource, protocol))
  })

  it('carries every frame, command, subscription and error code to Kotlin', () => {
    const kotlin: string = protocolKotlin(protocolSource, protocol)
    for (const type of protocol.REMOTE_FRAME_TYPES) expect(kotlin).toContain(`@SerialName("${type}")\ndata class`)
    for (const wire of [...protocol.REMOTE_COMMANDS, ...protocol.REMOTE_SUBSCRIPTIONS, ...protocol.REMOTE_ERROR_CODES]) {
      expect(kotlin).toContain(`@SerialName("${wire}") ${constantName(wire)}("${wire}")`)
    }
    expect(kotlin).toContain(`const val MAX_FRAME_BYTES: Int = ${protocol.REMOTE_LIMITS.maxFrameBytes}`)
  })

  it('keeps the forbidden capabilities out of every Kotlin enum', () => {
    const kotlin: string = protocolKotlin(protocolSource, protocol)
    for (const forbidden of protocol.REMOTE_FORBIDDEN) expect(kotlin).not.toContain(`@SerialName("${forbidden}")`)
  })

  it('fails on a field type it has no mapping for, instead of dropping the field', () => {
    const changed = protocolSource.replace('desktopName?: string', 'desktopName?: Date')
    expect(() => protocolKotlin(changed, protocol)).toThrow(/no Kotlin mapping for `Date` in RemoteHelloFrame.desktopName/)
  })

  it('names enum entries after their wire value', () => {
    expect(constantName('thread.respondRequest')).toBe('THREAD_RESPOND_REQUEST')
    expect(constantName('too-many-subscriptions')).toBe('TOO_MANY_SUBSCRIPTIONS')
    expect(constantName('pendingRequests')).toBe('PENDING_REQUESTS')
    expect(constantName('maxFrameBytes')).toBe('MAX_FRAME_BYTES')
  })
})
