import type { ProviderCompatibility } from '../../../shared/providerCompatibility'

/** Published each night by .github/workflows/provider-contract.yml on the `provider-contract` branch. */
export const COMPATIBILITY_URL = 'https://raw.githubusercontent.com/propagno/oxespace/provider-contract/compatibility.json'
const CACHE_MS = 6 * 60 * 60 * 1000

let cached: { at: number; value: ProviderCompatibility | null } | null = null

export function parseCompatibility(value: unknown): ProviderCompatibility | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Partial<ProviderCompatibility>
  if (typeof input.ok !== 'boolean' || !input.providers || typeof input.providers !== 'object') return null
  const providers: ProviderCompatibility['providers'] = {}
  for (const [name, entry] of Object.entries(input.providers)) {
    if (!entry || typeof entry !== 'object' || typeof entry.ok !== 'boolean' || !entry.versions || typeof entry.versions !== 'object') continue
    providers[name] = { ok: entry.ok, versions: Object.fromEntries(Object.entries(entry.versions).map(([os, version]) => [os, typeof version === 'string' ? version : null])) }
  }
  return { checkedAt: typeof input.checkedAt === 'string' ? input.checkedAt : null, ok: input.ok, providers }
}

/** The last nightly result, or null when it cannot be read (offline, not published yet). Never throws. */
export async function providerCompatibility(fetcher: typeof fetch = fetch, now = Date.now()): Promise<ProviderCompatibility | null> {
  if (cached && now - cached.at < CACHE_MS) return cached.value
  let value: ProviderCompatibility | null = null
  try {
    const response = await fetcher(COMPATIBILITY_URL, { headers: { Accept: 'application/json', 'User-Agent': 'OXESpace' }, signal: AbortSignal.timeout(10_000) })
    if (response.ok) value = parseCompatibility(await response.json())
  } catch { /* offline or blocked: no badge */ }
  cached = { at: now, value }
  return value
}

export function resetProviderCompatibilityCache(): void { cached = null }
