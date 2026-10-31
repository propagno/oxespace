import { useState, type ReactElement, type ReactNode } from 'react'
import { Check, ChevronDown, FolderGit2, GitBranch, GitCommitHorizontal, Search } from 'lucide-react'
import type { GitHubWorktree } from '../../../shared/types/github'
import { EmptyState, Popover, TextField } from '../../ui'
import { useTranslation } from 'react-i18next'
import { isValidRef } from './changesModel'
import './ChangesPanel.css'

export interface RefPickerBranch { name: string; remote: boolean }

/**
 * Searchable picker for one side of a comparison: worktrees (work tree, uncommitted changes included),
 * local and remote branches, or a ref typed by hand (tag, SHA, `HEAD~3`).
 */
export function RefPicker({ label, value, icon, branches, worktrees, selected, disabled, onPickRef, onPickWorktree }: {
  /** Accessible name of the trigger and of the popover, e.g. "Base (side A)". */
  label: string
  /** Text shown on the trigger. */
  value: string
  icon?: ReactNode
  branches: RefPickerBranch[]
  /** Offered only when the side accepts a work tree (side B). */
  worktrees?: GitHubWorktree[]
  /** `ref:<name>` or `tree:<path>` of the current choice. */
  selected: string
  disabled?: boolean
  onPickRef(ref: string): void
  onPickWorktree?(worktree: GitHubWorktree): void
}): ReactElement {
  const { t } = useTranslation('code')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const matches = (text: string): boolean => text.toLowerCase().includes(needle)
  const local = branches.filter(branch => !branch.remote && matches(branch.name)).map(branch => branch.name)
  const remote = branches.filter(branch => branch.remote && matches(branch.name)).map(branch => branch.name)
  const trees = (worktrees ?? []).filter(tree => matches(tree.branch ?? '') || matches(tree.path))
  const typed = query.trim()
  const offerTyped = typed !== '' && isValidRef(typed) && !branches.some(branch => branch.name === typed)
  const nothing = !local.length && !remote.length && !trees.length && !offerTyped
  const changeOpen = (next: boolean): void => { setOpen(next); if (!next) setQuery('') }

  const item = (key: string, content: ReactNode, onSelect: () => void, title?: string): ReactElement =>
    <li key={key}><button type="button" className="changes-menu-item" title={title} onClick={() => { changeOpen(false); onSelect() }}>
      {content}{selected === key && <Check size={14} aria-hidden="true" />}
    </button></li>

  return <Popover open={open} onOpenChange={changeOpen} label={label} trigger={
    <button type="button" className="changes-pill changes-ref" aria-label={`${label}: ${value}`} title={`${label}: ${value}`} disabled={disabled}>
      {icon ?? <GitBranch size={14} aria-hidden="true" />}<span>{value}</span><ChevronDown size={12} aria-hidden="true" />
    </button>
  }>
    <div className="changes-ref-menu">
      <label className="changes-menu-search"><Search size={14} aria-hidden="true" /><TextField autoFocus aria-label={t('changes.ref.search')} placeholder={t('changes.ref.placeholder')} value={query} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && offerTyped) { changeOpen(false); onPickRef(typed) } }} /></label>
      <ul>
        {trees.length > 0 && <li className="changes-menu-heading" role="presentation">{t('changes.ref.worktrees')}</li>}
        {trees.map(tree => item(`tree:${tree.path}`, <><FolderGit2 size={14} aria-hidden="true" /><span>{tree.branch ?? t('changes.detached')}{tree.isMain ? '' : ` · ${t('changes.ref.worktree')}`}</span></>, () => onPickWorktree?.(tree), tree.path))}
        {local.length > 0 && <li className="changes-menu-heading" role="presentation">{t('changes.ref.branches')}</li>}
        {local.map(name => item(`ref:${name}`, <><GitBranch size={14} aria-hidden="true" /><span>{name}</span></>, () => onPickRef(name)))}
        {remote.length > 0 && <li className="changes-menu-heading" role="presentation">{t('changes.ref.remote')}</li>}
        {remote.map(name => item(`ref:${name}`, <><GitBranch size={14} aria-hidden="true" /><span>{name}</span></>, () => onPickRef(name)))}
        {offerTyped && item(`ref:${typed}`, <><GitCommitHorizontal size={14} aria-hidden="true" /><span>{t('changes.ref.use', { ref: typed })}</span></>, () => onPickRef(typed))}
        {nothing && <li role="presentation"><EmptyState compact title={typed && !isValidRef(typed) ? t('changes.ref.invalid') : t('changes.ref.none')} /></li>}
      </ul>
    </div>
  </Popover>
}
