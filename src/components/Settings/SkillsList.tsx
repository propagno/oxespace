import { useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useSkillStore } from '../../store/skill.store'
import { Badge, EmptyState, ErrorState, LoadingState, Panel } from '../../ui'
import styles from './ToolsSettings.module.css'

/**
 * Settings › Tools, "MCP servers and skills" (R12, DESIGN M5 08/11): the skills agents can run, read only. Each is a
 * Markdown file in ~/.oxe/skills (user) or the project's .oxe/skills (workspace), and is run from the command bar.
 */
export function SkillsList(): ReactElement {
  const { t } = useTranslation('settings')
  const skills = useSkillStore((s) => s.skills)
  const loaded = useSkillStore((s) => s.loaded)
  const loading = useSkillStore((s) => s.loading)
  const error = useSkillStore((s) => s.error)
  const refresh = useSkillStore((s) => s.refresh)
  // The app keeps the list current (startup, workspace switch, file changes); it is read here only if nothing has been yet.
  const canRead = typeof window.oxe?.skill?.list === 'function'
  useEffect(() => { if (!loaded && canRead) void refresh() }, [loaded, canRead, refresh])
  const title = t('tools.skillsList.title')
  return <Panel className={styles.group} label={title} title={title}>
    <p className={styles.hint}>{t('tools.skillsList.intro')}</p>
    {error ? <ErrorState compact title={t('tools.skillsList.loadFailed')} message={error} onRetry={canRead ? () => void refresh() : undefined} />
      : !loaded && loading ? <LoadingState label={t('tools.skillsList.loading')} />
        : skills.length ? <ul className={styles.list} aria-label={title}>
          {skills.map((skill) => <li key={`${skill.source}:${skill.name}`} className={styles.rule}>
            <code className={styles.toolName} title={skill.filePath}>{skill.name}</code>
            <Badge>{t(`tools.skillsList.scope.${skill.source}`)}</Badge>
            <span className={styles.ruleNote}>{skill.description || t('tools.skillsList.noDescription')}</span>
          </li>)}
        </ul>
          : <EmptyState compact title={t('tools.skillsList.empty')} />}
  </Panel>
}
