import { currentLanguage } from '../../i18n'
import { formatNumber } from '../../utils/formatTime'

const UNITS: Array<[unit: string, size: number]> = [['terabyte', 1024 ** 4], ['gigabyte', 1024 ** 3], ['megabyte', 1024 ** 2], ['kilobyte', 1024]]

/** A size in the interface language: "1.4 GB", "143 MB", "1,4 GB". */
export function formatBytes(bytes: number): string {
  const value = Math.max(0, bytes)
  const [unit, size] = UNITS.find(([, step]) => value >= step) ?? ['byte', 1]
  const scaled = value / size
  return formatNumber(scaled, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: scaled >= 10 || unit === 'byte' ? 0 : 1 })
}

/** Items joined the way the interface language writes a list: "CPU, Memory and Disk". */
export function formatList(items: string[]): string {
  return new Intl.ListFormat(currentLanguage(), { style: 'long', type: 'conjunction' }).format(items)
}
