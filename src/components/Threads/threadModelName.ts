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
 * its last turn; failing that, the model the alias itself names in the catalog ("Default (recommended)" with
 * "Fable 5.2 · …" under it), unless settings may override the default. `null` means not known yet: the caller says
 * "Provider default".
 */
export function modelChipName({ chosen, catalog, reported }: { chosen?: string; catalog: ThreadModelCatalog; reported?: string }): string | null {
  const label = (id: string) => catalog.models.find(model => model.id === id)?.label ?? modelDisplayName(id)
  if (chosen && chosen !== DEFAULT_ALIAS) return label(chosen)
  const fallback = catalog.defaultKnown === false ? undefined : catalog.defaultModel
  if (fallback && fallback !== DEFAULT_ALIAS) return label(fallback)
  if (reported && reported !== DEFAULT_ALIAS) return label(reported)
  return catalog.defaultKnown === false ? null : aliasModelName(catalog)
}

/** The model Claude's "default" entry says it stands for, read from the words the picker already shows for it. */
function aliasModelName(catalog: ThreadModelCatalog): string | null {
  const alias = catalog.models.find(model => model.id === DEFAULT_ALIAS)
  const named = alias ? /\b(opus|sonnet|haiku|fable)\s+\d+(?:\.\d+)?/i.exec(`${alias.description} ${alias.label}`) : null
  return named ? named[0][0].toUpperCase() + named[0].slice(1) : null
}
