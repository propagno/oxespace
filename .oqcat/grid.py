PATH = 'src/components/OxeQuery/ResultGrid.tsx'
R = [
("import { displayCell as plainCell, formatRows, normalizeRange, sliceRange, sortedOrder, type CellRange, type CopyFormat } from './grid-format'\n",
 "import { useTranslation } from 'react-i18next'\nimport { SQL_NULL, displayCell as plainCell, formatRows, normalizeRange, sliceRange, sortedOrder, type CellRange, type CopyFormat } from './grid-format'\n"),
("  if (value === null || value === undefined) return 'NULL'\n  return value === 'NULL' ? '\"NULL\"' : plainCell(value)", "  if (value === null || value === undefined) return SQL_NULL\n  return value === SQL_NULL ? `\"${SQL_NULL}\"` : plainCell(value)"),
("export function ResultGrid({ columns, types, rows, onCopy, onSelect, selected, onOpenCell, onSort, sort: controlledSort, tableName, label = 'Result' }: {",
 "export function ResultGrid({ columns, types, rows, onCopy, onSelect, selected, onOpenCell, onSort, sort: controlledSort, tableName, label: labelProp }: {"),
("}): ReactElement {\n  const scroller = useRef<HTMLDivElement | null>(null)", "}): ReactElement {\n  const { t } = useTranslation('oxequery')\n  const label = labelProp ?? t('grid.label')\n  const scroller = useRef<HTMLDivElement | null>(null)"),
("title={`${hidden.size} hidden — show all`} aria-label={`Show ${hidden.size} hidden columns`}", "title={t('grid.hiddenTitle', { count: hidden.size })} aria-label={t('grid.showHidden', { count: hidden.size })}"),
("title={types?.[index] ? `${columns[index]} · ${types[index]} — click to sort` : `${columns[index]} — click to sort`}", "title={t('grid.sortTitle', { column: types?.[index] ? `${columns[index]} · ${types[index]}` : columns[index] })}"),
("aria-label={`Hide column ${columns[index]}`} title=\"Hide column\"", "aria-label={t('grid.hideNamed', { name: columns[index] })} title={t('grid.hide')}"),
("aria-label={`Resize column ${columns[index]}`}", "aria-label={t('grid.resize', { name: columns[index] })}"),
("role=\"rowheader\" title=\"Open this row\"", "role=\"rowheader\" title={t('grid.openRow')}"),
("title={value === null || value === undefined ? 'NULL (no value)' : plainCell(value).slice(0, 500)}", "title={value === null || value === undefined ? t('grid.nullTitle') : plainCell(value).slice(0, 500)}"),
]
