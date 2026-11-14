import type { TFunction } from 'i18next'

/** The reasoning efforts the three providers name today. A new one is shown as the provider spells it. */
const KNOWN = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

/** A reasoning effort in the person's language ("Low", "Baixo"), not the provider's identifier. */
export function effortLabel(t: TFunction<'thread'>, effort: string): string {
  const id = effort.toLowerCase()
  if (KNOWN.has(id)) return t(`config.effortLevel.${id}` as 'config.effortLevel.low')
  return effort ? effort[0].toUpperCase() + effort.slice(1) : effort
}
