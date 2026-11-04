import type { ThreadModelCatalog } from '../../../shared/types/thread'

/** The id Claude Code gives "whatever the account's default is": a choice, never a model's name (T57). */
const DEFAULT_ALIAS = 'default'

/**
 * A provider's model id as people say it: "claude-opus-5-5" is "Opus 5.5", "claude-3-5-sonnet-20241022" is
 * "Sonnet 3.5", "opus" is "Opus". Any other id is shown as it is.
 */
export function modelDisplayName(id: string): string {
  const bare = id.replace(/\[[^\]]*\]$/, '')
  const family = '(opus|sonnet|haiku|fable)'
  const version = (major: string, minor?: string) => minor && minor.length <= 2 ? `${major}.${minor}` : major
  const name = (value: string) => value[0].toUpperCase() + value.slice(1)
  let match = new RegExp(`^claude-${family}-(\\d+)(?:-(\\d+))?(?:-\\d{8})?$`, 'i').exec(bare)
  if (match) return `${name(match[1].toLowerCase())} ${version(match[2], match[3])}`
  match = new RegExp(`^claude-(\\d+)(?:-(\\d+))?-${family}(?:-\\d{8})?$`, 'i').exec(bare)
  if (match) return `${name(match[3].toLowerCase())} ${version(match[1], match[2])}`
  if (new RegExp(`^${family}$`, 'i').test(bare)) return name(bare.toLowerCase())
  return id
}

/**
 * The model chip's name (T58 §4.1): the model the conversation runs, never "default". A model picked by name shows
 * its catalog label. Otherwise it is the provider's default when the catalog names a real model; when the default
 * is Claude's alias, or the provider doesn't say (`defaultKnown: false`), it is the model the session reported on
 * its last turn. `null` means not known yet: the caller says "Provider default".
 */
export function modelChipName({ chosen, catalog, reported }: { chosen?: string; catalog: ThreadModelCatalog; reported?: string }): string | null {
  const label = (id: string) => catalog.models.find(model => model.id === id)?.label ?? modelDisplayName(id)
  if (chosen && chosen !== DEFAULT_ALIAS) return label(chosen)
  const fallback = catalog.defaultKnown === false ? undefined : catalog.defaultModel
  if (fallback && fallback !== DEFAULT_ALIAS) return label(fallback)
  return reported && reported !== DEFAULT_ALIAS ? label(reported) : null
}
