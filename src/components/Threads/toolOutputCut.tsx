import { i18n } from '../../i18n'

function formatBytes(bytes: number, lang: string): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  if (bytes < 1024) return `${bytes} B`
  let unitIndex = 0
  let val = bytes
  while (val >= 1024 && unitIndex < units.length - 1) {
    val /= 1024
    unitIndex++
  }
  const formatted = val.toLocaleString(lang === 'pt-BR' ? 'pt-BR' : 'en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })
  return `${formatted} ${units[unitIndex]}`
}

export function cutNote(keptBytes: number, totalBytes?: number): string {
  const lang = i18n.language === 'pt-BR' ? 'pt-BR' : 'en'
  const kept = formatBytes(keptBytes, lang)
  if (totalBytes !== undefined && totalBytes > 0) {
    const total = formatBytes(totalBytes, lang)
    return i18n.t('thread:toolOutputCut.withTotal', { kept, total })
  }
  return i18n.t('thread:toolOutputCut.keptOnly', { kept })
}
