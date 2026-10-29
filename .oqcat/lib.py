PATH = 'src/components/OxeQuery/LibraryMenu.tsx'
R = [
("import { useEffect, useState, type ReactElement } from 'react'\n", "import { useEffect, useState, type ReactElement } from 'react'\nimport { useTranslation } from 'react-i18next'\nimport { EmptyState, ErrorState } from '../../ui/Display'\nimport { formatMs } from './catalog'\nimport { formatNumber } from '../../utils/formatTime'\n"),
("}): ReactElement {\n  const [open, setOpen] = useState(false)", "}): ReactElement {\n  const { t } = useTranslation('oxequery')\n  const [open, setOpen] = useState(false)"),
("toast({ title: 'Query saved', description: created.name,", "toast({ title: t('library.saved'), description: created.name,"),
("label=\"Saved queries and history\"", "label={t('library.label')}"),
("icon={<BookMarked size={13} aria-hidden=\"true\" />}>Library</Button>}>", "icon={<BookMarked size={13} aria-hidden=\"true\" />}>{t('library.title')}</Button>}>"),
("<BookMarked size={12} aria-hidden=\"true\" />Saved ({saved.length})</button>", "<BookMarked size={12} aria-hidden=\"true\" />{t('library.savedTab', { count: saved.length })}</button>"),
("<History size={12} aria-hidden=\"true\" />History ({history.length})</button>", "<History size={12} aria-hidden=\"true\" />{t('library.historyTab', { count: history.length })}</button>"),
("{error && <p role=\"alert\" className=\"oq-error\">{error}</p>}", "{error && <ErrorState compact title={t('library.failed')} message={error} />}"),
("aria-label=\"Name for the current query\" placeholder=\"Save as… (Folder/Name)\"", "aria-label={t('library.nameLabel')} placeholder={t('library.namePlaceholder')}"),
("onClick={() => void save()}>Save</Button>", "onClick={() => void save()}>{t('common.save')}</Button>"),
("label={`Delete ${item.name}`}", "label={t('connections.deleteNamed', { name: item.name })}"),
("{saved.length === 0 && <p className=\"oq-muted\">Nothing saved yet.</p>}", "{saved.length === 0 && <EmptyState compact title={t('library.noneSaved')} />}"),
("<small>{item.ok ? `${item.rows ?? '–'} rows · ${item.durationMs ?? '–'} ms` : 'failed'} · {formatDateTime(item.ranAt)}</small>",
 "<small>{item.ok ? [item.rows === null || item.rows === undefined ? t('activity.rowsUnknown') : t('common.rows', { count: item.rows, formatted: formatNumber(item.rows) }), item.durationMs === null || item.durationMs === undefined ? '' : formatMs(item.durationMs)].filter(Boolean).join(' · ') : t('common.failed')} · {formatDateTime(item.ranAt)}</small>"),
("{history.length === 0 ? <p className=\"oq-muted\">Statements you run appear here.</p> : <Button size=\"sm\" onClick={() => void clear()}>Clear history</Button>}",
 "{history.length === 0 ? <EmptyState compact title={t('library.noHistory')} /> : <Button size=\"sm\" onClick={() => void clear()}>{t('library.clearHistory')}</Button>}"),
]
