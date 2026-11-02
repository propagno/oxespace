import { i18n } from '../i18n'
import { SCOPE_LABELS, type Keybinding, type KeybindingScope } from './keybindings'

/** A shortcut's name in the interface language: `keys.bindings.<id>` in the common catalog. */
export function bindingLabel(binding: Pick<Keybinding, 'id'>): string {
  return (i18n.t as unknown as (key: string) => string)(`keys.bindings.${binding.id}`)
}

/** Where a shortcut works: a product name, or "Everywhere". */
export function scopeLabel(scope: KeybindingScope): string {
  return scope === 'global' ? i18n.t('keys.everywhere') : SCOPE_LABELS[scope]
}
