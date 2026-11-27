import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ExecutionBindingStore } from '../../../electron/main/services/execution-binding-store'
import { ExecutionRegistry, executionSignal } from '../../../electron/main/services/execution-registry'
import { createSecretCipher, type SafeStorageLike } from '../../../electron/main/services/oxequery/secret-cipher'

function fakeSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${Buffer.from(value, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (value: Buffer) => {
      const text = value.toString('utf8')
      if (!text.startsWith('enc:')) throw new Error('Invalid ciphertext')
      return Buffer.from(text.slice(4), 'base64').toString('utf8')
    }
  }
}

describe('OXE-447 A3 — ExecutionRegistry persistence and daemon live-session reconciliation', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('re-hydrates ONLY bindings confirmed live in the daemon and purges dead sessions on restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oxe447-a3-'))
    dirs.push(dir)
    const filePath = join(dir, 'execution-bindings.json')
    const cipher = createSecretCipher(fakeSafeStorage(), 'win32', {})

    // App run #1: register two panes + one thread execution.
    const store1 = new ExecutionBindingStore({ filePath, cipher })
    const registry1 = new ExecutionRegistry({ store: store1 })

    const liveEnv = registry1.register({ paneId: 'pane-live', workspaceId: 'ws-1', cwd: dir, access: 'workspace' })
    const deadEnv = registry1.register({ paneId: 'pane-dead', workspaceId: 'ws-1', cwd: dir, access: 'read-only' })
    const threadEnv = registry1.register({ owner: { kind: 'thread', id: 'thr-1' }, workspaceId: 'ws-1', cwd: dir })

    // Raw file on disk must never contain plaintext execution tokens.
    const rawOnDisk = readFileSync(filePath, 'utf8')
    expect(rawOnDisk).not.toContain(liveEnv.OXESPACE_EXECUTION_TOKEN)
    expect(rawOnDisk).not.toContain(deadEnv.OXESPACE_EXECUTION_TOKEN)

    // Simulate app restart: fresh ExecutionRegistry instance backed by the same persisted store.
    const store2 = new ExecutionBindingStore({ filePath, cipher })
    const registry2 = new ExecutionRegistry({ store: store2 })

    // Before reconciliation, nothing is trusted yet.
    expect(registry2.isLive(liveEnv.OXESPACE_EXECUTION_ID)).toBe(false)
    expect(registry2.isLive(deadEnv.OXESPACE_EXECUTION_ID)).toBe(false)

    // Daemon reports ONLY pane-live as alive; pane-dead exited while app was closed.
    const first = await registry2.reconcileWithLiveSessions(['pane-live'])
    expect(first.restored).toEqual(['pane-live'])
    expect(first.purged).toContain('pane-dead')

    // pane-live authenticates with its original execution ID + token and has an active AbortSignal.
    const restored = registry2.authenticate(
      liveEnv.OXESPACE_EXECUTION_ID,
      liveEnv.OXESPACE_EXECUTION_TOKEN,
      'ws-1'
    )
    expect(restored.paneId).toBe('pane-live')
    expect(restored.access).toBe('workspace')
    expect(executionSignal(restored.owner)?.aborted).toBe(false)

    // pane-dead and non-pane thread binding are refused immediately.
    expect(() => registry2.authenticate(deadEnv.OXESPACE_EXECUTION_ID, deadEnv.OXESPACE_EXECUTION_TOKEN, 'ws-1')).toThrow()
    expect(() => registry2.authenticate(threadEnv.OXESPACE_EXECUTION_ID, threadEnv.OXESPACE_EXECUTION_TOKEN, 'ws-1')).toThrow()

    // Persisted store now holds ONLY pane-live; dead entry was purged from disk.
    const remaining = store2.load()
    expect(remaining.map(b => b.paneId)).toEqual(['pane-live'])

    // Reconciling a second time with the same live set is idempotent and preserves the signal.
    const second = await registry2.reconcileWithLiveSessions(['pane-live'])
    expect(second.purged).toEqual([])
    expect(registry2.isLive(liveEnv.OXESPACE_EXECUTION_ID)).toBe(true)
    expect(executionSignal(restored.owner)?.aborted).toBe(false)

    // Ending pane-live aborts its signal and clears it from the persisted store.
    registry2.end('pane-live')
    expect(executionSignal(restored.owner)?.aborted).toBe(true)
    expect(store2.load()).toEqual([])
  })
})
