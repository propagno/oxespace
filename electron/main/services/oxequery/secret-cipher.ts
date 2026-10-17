import type { SecretCipher } from './connection-store'

/** The slice of Electron's `safeStorage` this needs; a fake stands in for it in tests. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
  getSelectedStorageBackend?: () => string
}

/**
 * On Linux, `isEncryptionAvailable()` is true even when no keyring is running: Chromium then
 * falls back to `basic_text`, a fixed key that anyone with the file can reverse. Treating that as
 * "secure storage" would store database passwords, SSH keys and certificates as if protected.
 * They are refused instead, with the way to fix it, unless the person opts in explicitly.
 */
export function createSecretCipher(storage: SafeStorageLike, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): SecretCipher & { problem(): string | null } {
  const backend = platform === 'linux' ? storage.getSelectedStorageBackend?.() ?? 'unknown' : null
  const weak = backend === 'basic_text' || backend === 'unknown'
  const optedIn = env.OXESPACE_ALLOW_WEAK_SECRETS === '1'
  const problem = (): string | null => {
    if (!storage.isEncryptionAvailable()) return 'Secure storage is unavailable on this system, so passwords, keys and certificates cannot be saved. Use a connection that does not need them.'
    if (weak && !optedIn) {
      return 'No system keyring was found (Linux), so secrets would only be obfuscated, not protected. Start GNOME Keyring or KWallet and restart OXESpace, or set OXESPACE_ALLOW_WEAK_SECRETS=1 to store them without real protection.'
    }
    return null
  }
  return {
    available: () => problem() === null,
    problem,
    encrypt: value => storage.encryptString(value),
    decrypt: value => storage.decryptString(value)
  }
}
