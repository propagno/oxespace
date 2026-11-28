import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { MessageSquarePlus, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, cx, IconButton, TextArea } from '../../ui'
import { ThreadMarkdown } from './ThreadMarkdown'
import { parsePlanSections, type PlanInlineComment, type PlanSectionBlock } from './planReviewModel'
import styles from './ThreadPlanReview.module.css'

export interface ThreadPlanReviewProps {
  plan: string
  comments: PlanInlineComment[]
  generalNote: string
  disabled?: boolean
  embedded?: boolean
  headerAction?: ReactNode
  statusText?: string
  testId?: string
  ariaLabel?: string
  onAddComment: (section: PlanSectionBlock, text: string) => void
  onUpdateComment: (id: string, text: string) => void
  onDeleteComment: (id: string) => void
  onChangeGeneralNote: (text: string) => void
}

const MAX_COMMENT_LENGTH = 2000

/**
 * Interactive Markdown plan viewer for ExitPlanMode review cards.
 * Parses the plan into logical sections, allows attaching structured inline comments
 * per section plus an optional general note, and preserves full Markdown readability.
 */
export function ThreadPlanReview({
  plan,
  comments,
  generalNote,
  disabled = false,
  embedded = false,
  headerAction,
  statusText,
  testId,
  ariaLabel,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  onChangeGeneralNote
}: ThreadPlanReviewProps) {
  const { t } = useTranslation('thread')
  const sections = useMemo(() => parsePlanSections(plan), [plan])
  const [composingSection, setComposingSection] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [generalExpanded, setGeneralExpanded] = useState(false)

  const commentsBySection = useMemo(() => {
    const map = new Map<number, PlanInlineComment[]>()
    for (const item of comments) {
      const list = map.get(item.sectionIndex) ?? []
      list.push(item)
      map.set(item.sectionIndex, list)
    }
    return map
  }, [comments])

  const openComposer = (sectionIndex: number) => {
    setEditingId(null)
    setEditDraft('')
    if (composingSection === sectionIndex) {
      setComposingSection(null)
      setDraft('')
      return
    }
    setComposingSection(sectionIndex)
    setDraft('')
  }

  const submitNewComment = (section: PlanSectionBlock) => {
    const trimmed = draft.trim()
    if (!trimmed || disabled) return
    onAddComment(section, trimmed)
    setComposingSection(null)
    setDraft('')
  }

  const startEdit = (item: PlanInlineComment) => {
    setComposingSection(null)
    setDraft('')
    setEditingId(item.id)
    setEditDraft(item.comment)
  }

  const submitEdit = (id: string) => {
    const trimmed = editDraft.trim()
    if (!trimmed || disabled) return
    onUpdateComment(id, trimmed)
    setEditingId(null)
    setEditDraft('')
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, onSave: () => void, onCancel: () => void) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onCancel()
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      onSave()
    }
  }

  const showGeneralInput = generalExpanded || generalNote.length > 0
  const showHeader = comments.length > 0 || Boolean(headerAction)

  return <div
    className={cx(styles.root, embedded && styles.embedded)}
    tabIndex={embedded ? undefined : 0}
    role={ariaLabel ? 'region' : undefined}
    aria-label={ariaLabel}
    data-testid={testId}
    data-ui="plan-review"
  >
    {showHeader && <div className={styles.header}>
      {comments.length > 0 && (
        <span className={styles.counter} data-ui="plan-comment-count">
          {t('planReview.commentsCount', { count: comments.length })}
        </span>
      )}
      {headerAction ? <span className={styles.headerAction}>{headerAction}</span> : null}
    </div>}

    <div className={styles.sections}>
      {sections.map(section => {
        const attached = commentsBySection.get(section.index) ?? []
        const isComposing = composingSection === section.index
        return <div
          key={section.index}
          className={cx(
            styles.section,
            attached.length > 0 && styles.sectionCommented,
            isComposing && styles.sectionComposing
          )}
          data-ui="plan-section"
          data-section-index={section.index}
          data-has-comments={attached.length > 0 ? 'true' : undefined}
        >
          <div className={styles.sectionRow}>
            <div className={styles.sectionBody}>
              <ThreadMarkdown text={section.markdown} />
            </div>
            <IconButton
              size="sm"
              variant="ghost"
              className={styles.sectionAction}
              data-action="add-plan-comment"
              aria-expanded={isComposing}
              disabled={disabled}
              label={t('planReview.addCommentOn', { excerpt: section.excerpt })}
              title={t('planReview.addComment')}
              icon={<MessageSquarePlus size={14} aria-hidden="true" />}
              onClick={() => openComposer(section.index)}
            />
          </div>

          {attached.length > 0 && <div className={styles.comments}>
            {attached.map(item => (
              <div key={item.id} className={styles.commentCard} data-ui="plan-comment">
                {editingId === item.id ? (
                  <form
                    onSubmit={event => {
                      event.preventDefault()
                      submitEdit(item.id)
                    }}
                  >
                    <TextArea
                      className={styles.textarea}
                      data-testid="plan-comment-editor"
                      aria-label={t('planReview.editCommentLabel')}
                      value={editDraft}
                      rows={2}
                      maxLength={MAX_COMMENT_LENGTH}
                      disabled={disabled}
                      autoFocus
                      onChange={event => setEditDraft(event.target.value)}
                      onKeyDown={event => onComposerKeyDown(
                        event,
                        () => submitEdit(item.id),
                        () => { setEditingId(null); setEditDraft('') }
                      )}
                    />
                    <div className={styles.composerActions}>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={disabled}
                        onClick={() => { setEditingId(null); setEditDraft('') }}
                      >
                        {t('common.cancel')}
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        type="submit"
                        disabled={disabled || !editDraft.trim()}
                      >
                        {t('planReview.saveEdit')}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className={styles.commentHeader}>
                    <p className={styles.commentText}>{item.comment}</p>
                    <span className={styles.commentActions}>
                      <IconButton
                        size="sm"
                        variant="ghost"
                        data-action="edit-plan-comment"
                        disabled={disabled}
                        label={t('planReview.editComment')}
                        title={t('planReview.editComment')}
                        icon={<Pencil size={12} aria-hidden="true" />}
                        onClick={() => startEdit(item)}
                      />
                      <IconButton
                        size="sm"
                        variant="ghost"
                        data-action="delete-plan-comment"
                        disabled={disabled}
                        label={t('planReview.deleteComment')}
                        title={t('planReview.deleteComment')}
                        icon={<Trash2 size={12} aria-hidden="true" />}
                        onClick={() => onDeleteComment(item.id)}
                      />
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>}

          {isComposing && (
            <form
              className={styles.composer}
              data-ui="plan-comment-composer"
              onSubmit={event => {
                event.preventDefault()
                submitNewComment(section)
              }}
            >
              <TextArea
                className={styles.textarea}
                data-testid="plan-comment-input"
                aria-label={t('planReview.commentLabel')}
                placeholder={t('planReview.commentPlaceholder')}
                value={draft}
                rows={2}
                maxLength={MAX_COMMENT_LENGTH}
                disabled={disabled}
                autoFocus
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => onComposerKeyDown(
                  event,
                  () => submitNewComment(section),
                  () => { setComposingSection(null); setDraft('') }
                )}
              />
              <div className={styles.composerActions}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => { setComposingSection(null); setDraft('') }}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  type="submit"
                  disabled={disabled || !draft.trim()}
                >
                  {t('planReview.saveComment')}
                </Button>
              </div>
            </form>
          )}
        </div>
      })}
    </div>

    <div className={styles.generalWrap}>
      {showGeneralInput ? (
        <div className={styles.generalField}>
          <span className={styles.generalLabel}>{t('planReview.generalLabel')}</span>
          <TextArea
            className={styles.textarea}
            data-testid="plan-general-feedback"
            aria-label={t('planReview.generalLabel')}
            placeholder={t('planReview.generalPlaceholder')}
            value={generalNote}
            rows={2}
            maxLength={MAX_COMMENT_LENGTH}
            disabled={disabled}
            autoFocus={generalExpanded && !generalNote}
            onChange={event => onChangeGeneralNote(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape' && !generalNote.trim()) {
                event.stopPropagation()
                setGeneralExpanded(false)
              }
            }}
          />
        </div>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          data-action="toggle-general-note"
          disabled={disabled}
          icon={<MessageSquarePlus size={13} aria-hidden="true" />}
          onClick={() => setGeneralExpanded(true)}
        >
          {t('planReview.addGeneralNote')}
        </Button>
      )}
    </div>

    {statusText !== undefined && <span role="status" className={styles.srOnly}>{statusText}</span>}
  </div>
}
