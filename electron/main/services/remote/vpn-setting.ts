import type { AppDatabase } from '../../db'

/**
 * OXE-383: Settings › Phone › "Also reach this computer over a VPN (Tailscale, WireGuard)". Off until the person turns
 * it on: only a stored '1' turns it on, so nothing stored, a value this version does not know or an unreadable table all
 * mean off. Kept in main and changed only by the window's own channel; no phone command or MCP tool reaches it.
 */
const KEY = 'remote_allow_vpn'

export function remoteVpnAllowed(db: AppDatabase): boolean {
  try {
    const row = db.prepare('SELECT value FROM thread_settings WHERE key = ?').get(KEY) as { value: string } | undefined
    return row?.value === '1'
  } catch { return false }
}

export function setRemoteVpnAllowed(db: AppDatabase, allowed: boolean): void {
  db.prepare('INSERT INTO thread_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(KEY, allowed ? '1' : '0', Date.now())
}

/** Exactly `{ allowed: boolean }`; anything else is refused before the setting is touched. */
export function parseAllowVpnInput(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid VPN setting')
  const keys = Object.keys(value)
  const allowed = (value as { allowed?: unknown }).allowed
  if (keys.length !== 1 || keys[0] !== 'allowed' || typeof allowed !== 'boolean') throw new Error('Invalid VPN setting')
  return allowed
}
