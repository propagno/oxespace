import { i18n } from '../i18n'
import { SCOPE_LABELS, type Keybinding, type KeybindingScope } from './keybindings'

/**
 * A shortcut's name in the interface language. The registry keeps the English
 * label as the fallback, so a binding added without a translation still reads.
 */
export function bindingLabel(binding: Pick<Keybinding, 'id' | 'label'>): string {
  return (i18n.t as unknown as (key: string, options: object) => string)(`keys.bindings.${binding.id}`, { defaultValue: binding.label })
}

/** Where a shortcut works: a product name, or "Everywhere". */
export function scopeLabel(scope: KeybindingScope): string {
  return scope === 'global' ? i18n.t('keys.everywhere') : SCOPE_LABELS[scope]
}
