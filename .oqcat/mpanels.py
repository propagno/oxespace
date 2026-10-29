PATH = 'src/components/OxeQuery/MongoPanels.tsx'
R = [
("import type { ReactElement } from 'react'\n", "import type { ReactElement } from 'react'\nimport { useTranslation } from 'react-i18next'\n"),
("import styles from './MongoPanels.module.css'\n", "import styles from './MongoPanels.module.css'\nimport { formatMs } from './catalog'\nimport { formatNumber } from '../../utils/formatTime'\n"),
("export function DocumentTree({ text, open = 1 }: { text: string; open?: number }): ReactElement {\n  let value", "export function DocumentTree({ text, open = 1 }: { text: string; open?: number }): ReactElement {\n  const { t } = useTranslation('oxequery')\n  let value"),
('role="tree" aria-label="Document">', "role=\"tree\" aria-label={t('explainCard.document')}>"),
("export function ExplainCard({ explain, onClose }: { explain: MongoExplainSummary; onClose: () => void }): ReactElement {\n", "export function ExplainCard({ explain, onClose }: { explain: MongoExplainSummary; onClose: () => void }): ReactElement {\n  const { t } = useTranslation('oxequery')\n"),
('<section className={styles.explain} aria-label="Query plan">\n    <header><strong>Query plan</strong><Button size="sm" variant="ghost" onClick={onClose}>Close</Button></header>',
 "<section className={styles.explain} aria-label={t('explainCard.title')}>\n    <header><strong>{t('explainCard.title')}</strong><Button size=\"sm\" variant=\"ghost\" onClick={onClose}>{t('common.close')}</Button></header>"),
("<div><dt>Access</dt><dd data-warn={scan || undefined}>{explain.stage}{explain.index ? ` on ${explain.index}` : ''}</dd></div>", "<div><dt>{t('explainCard.access')}</dt><dd data-warn={scan || undefined}>{explain.index ? t('explainCard.stageOn', { stage: explain.stage, index: explain.index }) : explain.stage}</dd></div>"),
("<div><dt>Documents read</dt><dd>{explain.docsExamined}</dd></div>", "<div><dt>{t('explainCard.docsRead')}</dt><dd>{formatNumber(explain.docsExamined)}</dd></div>"),
("<div><dt>Index keys read</dt><dd>{explain.keysExamined}</dd></div>", "<div><dt>{t('explainCard.keysRead')}</dt><dd>{formatNumber(explain.keysExamined)}</dd></div>"),
("<div><dt>Returned</dt><dd>{explain.returned}</dd></div>", "<div><dt>{t('explainCard.returned')}</dt><dd>{formatNumber(explain.returned)}</dd></div>"),
("<div><dt>Server time</dt><dd>{explain.timeMs} ms</dd></div>", "<div><dt>{t('explainCard.serverTime')}</dt><dd>{formatMs(explain.timeMs)}</dd></div>"),
("<details><summary>Full plan</summary>", "<details><summary>{t('explainCard.full')}</summary>"),
]
