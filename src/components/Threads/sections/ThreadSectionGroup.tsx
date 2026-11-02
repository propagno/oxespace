import type { ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, ChevronDown, FolderInput, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, EmptyState, Menu, cx, type MenuEntry } from '../../../ui'
import { i18n } from '../../../i18n'
import type { SectionedThread, ThreadSection } from './sectionsContract'
import type { SectionGroup } from './sectionsModel'
import type { DropTarget, DropZoneProps } from './useSectionDrag'
import type { ThreadSectionsController } from './useThreadSections'
import styles from './ThreadSections.module.css'

const NO_SECTION = '\u0000none'

/** One section of a project: a collapsible heading with a count and a menu, and its conversations. */
export function ThreadSectionGroup({ group, index, total, searching, controller, zoneProps, renderRow, rowsClassName }: {
  group: SectionGroup<SectionedThread>
  index: number
  total: number
  /** A search shows every section with a match, open. */
  searching: boolean
  controller: ThreadSectionsController
  zoneProps: (target: DropTarget) => DropZoneProps
  renderRow: (thread: SectionedThread) => ReactNode
  /** The list's own rows class, so rows inside a section look and behave like the others. */
  rowsClassName?: string
}): ReactElement | null {
  const { t } = useTranslation('thread')
  const { section, threads } = group
  if (searching && !threads.length) return null
  const open = searching || !section.collapsed
  return <section className={cx('thread-section', styles.section)} aria-label={section.name} data-section-id={section.id} {...zoneProps({ projectId: section.projectId, sectionId: section.id })}>
    <div className={styles.heading}>
      <Button variant="ghost" data-list-item className={cx('thread-section-toggle', styles.toggle)} aria-expanded={open}
        onClick={() => { if (!searching) void controller.setCollapsed(section, !section.collapsed) }}>
        <ChevronDown size={12} aria-hidden="true" /><span className={styles.name}>{section.name}</span>{' '}
        <small className={styles.count}><span aria-hidden="true">{threads.length}</span><span className="sr-only">{t('sections.count', { count: threads.length })}</span></small>
      </Button>
      <Menu label={t('sections.actionsFor', { name: section.name })} align="end"
        trigger={<Button variant="ghost" square data-list-action className={cx('thread-row-action', styles.action)} aria-label={t('sections.actionsFor', { name: section.name })} data-section-actions={section.id} icon={<MoreHorizontal size={14} aria-hidden="true" />} />}
        items={[
          { label: t('sections.rename'), icon: <Pencil size={14} />, onSelect: () => controller.setDialog({ kind: 'rename', section }) },
          { label: t('sections.moveUp'), icon: <ArrowUp size={14} />, disabled: index === 0, onSelect: () => void controller.shift(section, -1) },
          { label: t('sections.moveDown'), icon: <ArrowDown size={14} />, disabled: index === total - 1, onSelect: () => void controller.shift(section, 1) },
          { type: 'separator' },
          { label: t('sections.delete'), icon: <Trash2 size={14} />, danger: true, onSelect: () => controller.setDialog({ kind: 'delete', section, count: threads.length }) }
        ]} />
    </div>
    {open && <div className={cx('thread-section-rows', rowsClassName, styles.rows)}>
      {threads.length ? threads.map(renderRow) : <EmptyState compact title={t('sections.empty')} />}
    </div>}
  </section>
}

/** The conversation menu's "Move to section ›" entry: the same moves as dragging, from the keyboard. */
export function moveToSectionEntry(thread: SectionedThread, sections: readonly ThreadSection[], controller: ThreadSectionsController): MenuEntry {
  const t = i18n.t.bind(i18n)
  if (thread.parentThreadId) return { label: t('thread:sections.followsParent'), icon: <FolderInput size={14} />, disabled: true, onSelect: () => {} }
  const current = controller.sectionOf(thread)
  return { type: 'submenu', label: t('thread:sections.moveTo'), icon: <FolderInput size={14} />, testId: 'thread-move-to-section', items: [
    { type: 'radio', value: current ?? NO_SECTION, onValueChange: value => void controller.moveTo(thread, value === NO_SECTION ? null : value),
      options: [{ value: NO_SECTION, label: t('thread:sections.none') }, ...sections.map(section => ({ value: section.id, label: section.name }))] },
    { type: 'separator' },
    { label: t('thread:sections.newSection'), icon: <Plus size={14} />, onSelect: () => controller.setDialog({ kind: 'create', projectId: thread.projectId, threadId: thread.id }) }
  ] }
}
