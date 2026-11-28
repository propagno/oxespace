import type { ThreadProvider } from './types/thread'

/**
 * Lightweight, fast default utility models per provider used for auxiliary tasks
 * (side-chat quick asks, lightweight summaries) when the user leaves utility model on Auto.
 * Callers MUST pair this with `runWithUtilityModelFallback` so an unavailable or
 * plan-restricted utility model gracefully falls back to the primary thread model.
 */
export const PROVIDER_DEFAULT_UTILITY_MODELS: Readonly<Record<ThreadProvider, string>> = {
  claude: 'claude-haiku-4-5',
  codex: 'gpt-4o-mini',
  antigravity: 'gemini-2.5-flash'
}

export const UTILITY_MODEL_MAX_CHARS = 120
const UTILITY_MODEL_ID_RE = /^[a-z0-9][a-z0-9._:/\[\]-]{0,119}$/i
const LIGHTWEIGHT_MODEL_HINT_RE = /(?:haiku|mini|flash|lite|small|nano)/i

export type UtilityModelConfigInput = string | Partial<Record<ThreadProvider, string>> | null | undefined

export type UtilityModelSource = 'configured' | 'provider-default' | 'primary' | 'default'

export interface UtilityModelResolution {
  /** Model ID to attempt first for the auxiliary task (undefined = provider's own default). */
  model: string | undefined
  /** Fallback model ID if the utility model is unavailable, rejected, or rate-limited. */
  fallbackModel: string | undefined
  /** Whether a distinct utility model was selected ahead of the fallback. */
  isUtilityOverride: boolean
  /** Where the selected model came from. */
  source: UtilityModelSource
}

export interface ResolveUtilityModelOptions {
  /** Known available model IDs from the provider catalog, used to validate/select a fast model when present. */
  availableModels?: readonly string[]
}

/** Sanitizes a user-supplied utility model preference (`''` = Auto, `'primary'` = always primary, or valid model id). */
export function normalizeUtilityModel(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim().slice(0, UTILITY_MODEL_MAX_CHARS)
  if (!trimmed) return ''
  const lower = trimmed.toLowerCase()
  if (lower === 'auto') return ''
  if (lower === 'primary') return 'primary'
  return UTILITY_MODEL_ID_RE.test(trimmed) ? trimmed : ''
}

export function isValidUtilityModelId(value: unknown): value is string {
  return typeof value === 'string' && UTILITY_MODEL_ID_RE.test(value.trim())
}

function extractConfiguredModel(provider: ThreadProvider, configured: UtilityModelConfigInput): string {
  if (!configured) return ''
  if (typeof configured === 'string') return normalizeUtilityModel(configured)
  if (typeof configured === 'object') return normalizeUtilityModel(configured[provider])
  return ''
}

/**
 * Resolves the best lightweight utility model for an auxiliary LLM task, along with
 * the primary fallback model to use if the utility model fails at runtime.
 */
export function resolveUtilityModel(
  provider: ThreadProvider,
  primaryModel?: string | null,
  configuredUtilityModel?: UtilityModelConfigInput,
  options: ResolveUtilityModelOptions = {}
): UtilityModelResolution {
  const primary = typeof primaryModel === 'string' && primaryModel.trim() ? primaryModel.trim() : undefined
  const configured = extractConfiguredModel(provider, configuredUtilityModel)
  const available = options.availableModels?.filter(id => isValidUtilityModelId(id)) ?? []

  // Explicit opt-out: always keep the primary conversation model.
  if (configured === 'primary') {
    return {
      model: primary,
      fallbackModel: undefined,
      isUtilityOverride: false,
      source: primary ? 'primary' : 'default'
    }
  }

  // User specified an explicit utility model ID.
  if (configured) {
    if (available.length > 0 && !available.includes(configured)) {
      return {
        model: primary,
        fallbackModel: undefined,
        isUtilityOverride: false,
        source: primary ? 'primary' : 'default'
      }
    }
    const differsFromPrimary = configured !== primary
    return {
      model: configured,
      fallbackModel: differsFromPrimary ? primary : undefined,
      isUtilityOverride: differsFromPrimary,
      source: 'configured'
    }
  }

  // Auto mode ('' or 'auto'): pick provider's lightweight default (or catalog match when available).
  let candidate: string | undefined = PROVIDER_DEFAULT_UTILITY_MODELS[provider]
  if (available.length > 0) {
    if (!candidate || !available.includes(candidate)) {
      candidate = available.find(id => LIGHTWEIGHT_MODEL_HINT_RE.test(id))
    }
  }

  if (!candidate || candidate === primary) {
    return {
      model: primary,
      fallbackModel: undefined,
      isUtilityOverride: false,
      source: primary ? 'primary' : 'default'
    }
  }

  return {
    model: candidate,
    fallbackModel: primary,
    isUtilityOverride: true,
    source: 'provider-default'
  }
}

/**
 * Returns true when an error from a utility model invocation should trigger a graceful fallback
 * to the primary thread model (never failing a user workflow due to model unavailability/rejection/rate-limit).
 */
export function isUtilityModelFallbackError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof Error) {
    if (error.name === 'AbortError') return false
    const code = (error as { code?: unknown }).code
    if (code === 'thread.side.closed' || code === 'thread.side.invalidInput') return false
  }
  return true
}

export interface UtilityFallbackResult<T> {
  value: T
  modelUsed: string | undefined
  usedFallback: boolean
}

/**
 * Executes an auxiliary LLM operation using the resolved utility model and gracefully
 * falls back to the primary conversation model if the utility model is unavailable,
 * rate-limited, or rejected by the provider.
 */
export async function runWithUtilityModelFallback<T>(
  resolution: UtilityModelResolution,
  execute: (model: string | undefined, attempt: 'utility' | 'fallback') => Promise<T>,
  options: {
    shouldFallback?: (error: unknown) => boolean
    onFallback?: (error: unknown, resolution: UtilityModelResolution) => void
  } = {}
): Promise<UtilityFallbackResult<T>> {
  try {
    const value = await execute(resolution.model, 'utility')
    return { value, modelUsed: resolution.model, usedFallback: false }
  } catch (error) {
    if (!resolution.isUtilityOverride) throw error
    const canFallback = options.shouldFallback ? options.shouldFallback(error) : isUtilityModelFallbackError(error)
    if (!canFallback) throw error
    options.onFallback?.(error, resolution)
    const value = await execute(resolution.fallbackModel, 'fallback')
    return { value, modelUsed: resolution.fallbackModel, usedFallback: true }
  }
}
