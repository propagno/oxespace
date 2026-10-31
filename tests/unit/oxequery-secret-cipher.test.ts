import { describe, expect, it } from 'vitest'
import { createSecretCipher, type SafeStorageLike } from '../../electron/main/services/oxequery/secret-cipher'

const storage = (backend: string | undefined, available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: value => Buffer.from(value),
  decryptString: value => value.toString(),
  ...(backend ? { getSelectedStorageBackend: () => backend } : {})
})

describe('createSecretCipher', () => {
  it('accepts a real keyring on Linux and the OS store elsewhere', () => {
    expect(createSecretCipher(storage('gnome_libsecret'), 'linux', {}).available()).toBe(true)
    expect(createSecretCipher(storage('kwallet5'), 'linux', {}).available()).toBe(true)
    expect(createSecretCipher(storage(undefined), 'win32', {}).available()).toBe(true)
    expect(createSecretCipher(storage(undefined), 'darwin', {}).available()).toBe(true)
  })

  it('refuses the fixed-key fallback on Linux and says how to fix it', () => {
    for (const backend of ['basic_text', 'unknown', undefined]) {
      const cipher = createSecretCipher(storage(backend), 'linux', {})
      expect(cipher.available()).toBe(false)
      expect(cipher.problem()).toMatch(/keyring/)
    }
  })

  it('allows it only when the person opts in, and reports unavailable storage', () => {
    expect(createSecretCipher(storage('basic_text'), 'linux', { OXESPACE_ALLOW_WEAK_SECRETS: '1' }).available()).toBe(true)
    expect(createSecretCipher(storage('gnome_libsecret', false), 'linux', {}).problem()).toMatch(/unavailable/)
  })
})
