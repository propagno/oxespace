/**
 * The agents whose subscription usage is read, in the order they are shown. Kept apart from the usage chip so the
 * status bar and the app shell can name them without loading the chip's chunk (usageChunk.ts).
 */
export const USAGE_PROVIDERS = ['claude', 'codex', 'antigravity'] as const
export type UsageProvider = typeof USAGE_PROVIDERS[number]
export const isUsageProvider = (provider: unknown): provider is UsageProvider => (USAGE_PROVIDERS as readonly unknown[]).includes(provider)
