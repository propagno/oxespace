FILES = {
 'src/components/OxeQuery/EngineBar.tsx': [
  ("import { ErrorState } from '../../ui/Display'\n", ""),
  ("{failure && <ErrorState compact title={t('engineBar.switchFailed')} message={failure} />}", "{failure && <p role=\"alert\" className=\"oq-error\">{failure}</p>}"),
 ],
 'src/components/OxeQuery/ResourcesPanel.tsx': [
  ("import { EmptyState, ErrorState } from '../../ui/Display'\n", ""),
  ("{error && <ErrorState compact title={t('resources.failed')} message={error} onRetry={() => void load()} retryLabel={t('common.tryAgain')} />}", "{error && <p role=\"alert\" className=\"oq-error\">{error}</p>}"),
  ("      {count[tab] === 0 && !error ? <EmptyState compact title={t(`resources.empty.${tab}`)} /> : <>\n", ""),
  ("<td>{['bridge', 'host', 'none'].includes(item.name) ? null : <button type=\"button\" aria-label={t('resources.removeNamed.network', { name: item.name })} onClick={() => ask('network', item.name, item.name)}><Trash2 size={12} aria-hidden=\"true\" /></button>}</td></tr>)}</tbody></table>}\n      </>}\n",
   "<td>{['bridge', 'host', 'none'].includes(item.name) ? null : <button type=\"button\" aria-label={t('resources.removeNamed.network', { name: item.name })} onClick={() => ask('network', item.name, item.name)}><Trash2 size={12} aria-hidden=\"true\" /></button>}</td></tr>)}</tbody></table>}\n"),
  ("{error && <ErrorState compact title={t('newDatabase.failed')} message={error} />}", "{error && <p role=\"alert\" className=\"oq-error\">{error}</p>}"),
 ],
 'src/components/OxeQuery/ActivityPanel.tsx': [
  ("import { EmptyState, ErrorState } from '../../ui/Display'", "import { EmptyState } from '../../ui/Display'"),
  ("<div role=\"radiogroup\" aria-label={t('activity.filter')} className=\"oq-segment\">", "<div role=\"group\" aria-label={t('activity.filter')} className=\"oq-segment\">"),
  ("{error && <ErrorState compact title={t('activity.loadFailed')} message={error} onRetry={() => void load()} retryLabel={t('common.tryAgain')} />}", "{error && <p role=\"alert\" className=\"oq-error\">{error}</p>}"),
  ("{shown.length === 0 && !error ? <div className=\"oq-placeholder\">{entries.length > 0\n      ? <EmptyState compact title={t('activity.noneForFilter')} />\n      : <EmptyState icon={<ShieldCheck size={20} />} title={t('activity.emptyTitle')}>{t('activity.emptyText')}</EmptyState>}</div>\n      : shown.length > 0 && <table",
   "{shown.length === 0 && !error ? <div className=\"oq-empty\"><EmptyState icon={<ShieldCheck size={20} />} title={t('activity.emptyTitle')}>{t('activity.emptyText')}</EmptyState></div>\n      : <table"),
 ],
}
for path, R in FILES.items():
    s = open(path, encoding='utf8', newline='').read()
    nl = '\r\n' if '\r\n' in s else '\n'
    s = s.replace('\r\n', '\n')
    for old, new in R:
        if old not in s: print('MISSING', path, old[:80]); continue
        s = s.replace(old, new)
    open(path, 'w', encoding='utf8', newline='').write(s.replace('\n', nl))
print('done')
