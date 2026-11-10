// @vitest-environment node
// Frozen acceptance test for 1.5.0 A67 (OXE program, phase F10). Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-a67-workspace-color.md (#693). Runs under Electron's Node ABI, like the other gateway tests.
import { afterEach, describe, expect, test } from 'vitest'
import type { Harness } from '../../helpers/remote-gateway-harness'
import { collect, ended, phoneWithDesktop, signIn, subscribe, type Frame } from '../../helpers/remote-session'
import { workspaceColorIndex } from '../../../shared/workspace-color'

const harnesses: Harness[] = []
afterEach(async () => { await Promise.all(harnesses.splice(0).map(value => value.close())) })

type Listed = { workspaces: Array<{ id: string; color?: number }> }
const workspaces = (frame: Frame) => (frame.data as Listed).workspaces

describe('A67 · the workspace colour reaches the phone (gateway)', () => {
  test('the workspaces topic carries the colour, and a change or a reset arrives as an event', async () => {
    const phone = await phoneWithDesktop(harnesses)
    const socket = await signIn(phone)
    const derived = workspaceColorIndex({ id: 'ws1', color: null })

    const first = await subscribe(socket, 'workspaces')
    expect(workspaces(first.frames[0])).toEqual([expect.objectContaining({ id: 'ws1', color: derived })])
    const order = workspaces(first.frames[0]).map(workspace => workspace.id)

    phone.h.db.prepare('UPDATE workspaces SET color = 5 WHERE id = ?').run('ws1')
    const [changed] = await collect(socket, ended)
    expect(changed).toMatchObject({ type: 'event' })
    expect(workspaces(changed).find(workspace => workspace.id === 'ws1')?.color).toBe(5)
    expect(workspaces(changed).map(workspace => workspace.id)).toEqual(order)

    // Back to "not chosen": the derived slot, never nothing.
    phone.h.db.prepare('UPDATE workspaces SET color = NULL WHERE id = ?').run('ws1')
    const [reset] = await collect(socket, ended)
    expect(workspaces(reset).find(workspace => workspace.id === 'ws1')?.color).toBe(derived)
    expect(workspaces(reset).map(workspace => workspace.id)).toEqual(order)
  })
})
