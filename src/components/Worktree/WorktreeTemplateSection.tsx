import { ChevronDown, ChevronRight, Eye, Save, ShieldAlert, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorktreeTemplateConfig, WorktreeTemplateDryRun } from '../../../shared/types/repo-config'
import { Badge, Button, ErrorState, Notice, SectionLabel, Spinner, TextArea, TextField } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import styles from './WorktreeTemplateSection.module.css'

interface WorktreeTemplateSectionProps {
  rootPath: string
  defaultOpen?: boolean
  onTemplateChanged?: () => void
}

function parseLines(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))]
}

function appendUniqueLine(currentText: string, value: string): string {
  const existing = currentText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (existing.includes(value)) return existing.join('\n')
  return [...existing, value].join('\n')
}

function hasSensitivePatternText(lines: string[]): boolean {
  const re = /^\.env|\.(?:env|pem|key|p12|pfx)(?:$|[*?])|credentials|secret|^id_(?:rsa|ed25519)/i
  return lines.some((raw) => {
    const cleaned = raw.trim().replace(/^!/, '').replace(/\\/g, '/')
    return cleaned.split('/').some((part) => re.test(part))
  })
}

/**
 * Compact declarative worktree template editor with 1-click stack presets,
 * sensitive-pattern opt-in toggle, and read-only dry-run preview (OXE-444).
 * Built strictly from `src/ui` primitives and design tokens.
 */
export function WorktreeTemplateSection({
  rootPath,
  defaultOpen = false,
  onTemplateChanged
}: WorktreeTemplateSectionProps): ReactElement | null {
  const { t } = useTranslation('code')
  const api = window.oxe?.repository
  const [open, setOpen] = useState(defaultOpen)
  const [loadedRoot, setLoadedRoot] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [trusting, setTrusting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedNotice, setSavedNotice] = useState(false)
  const [config, setConfig] = useState<WorktreeTemplateConfig | null>(null)
  const [preview, setPreview] = useState<WorktreeTemplateDryRun | null>(null)

  const [sharedDirsText, setSharedDirsText] = useState('')
  const [includeText, setIncludeText] = useState('')
  const [setupScript, setSetupScript] = useState('')
  const dirtyRef = useRef(false)
  const loading = open && loadedRoot !== rootPath && error === null

  const hydrate = useCallback((next: WorktreeTemplateConfig): void => {
    setConfig(next)
    setSharedDirsText(next.sharedDirectories.join('\n'))
    setIncludeText(next.worktreeInclude.join('\n'))
    setSetupScript(next.setupScript)
  }, [])

  useEffect(() => {
    if (!open || !api) return
    let cancelled = false
    dirtyRef.current = false
    void api
      .getWorktreeTemplate({ rootPath })
      .then((next) => {
        if (cancelled) return
        if (dirtyRef.current) {
          setConfig(next)
        } else {
          hydrate(next)
        }
        setError(null)
        setLoadedRoot(rootPath)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(humanizeError(err))
          setLoadedRoot(rootPath)
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, rootPath, api, hydrate])

  if (!api) return null

  const applyNodePreset = (): void => {
    dirtyRef.current = true
    setSharedDirsText((prev) => appendUniqueLine(prev, 'node_modules'))
    setSavedNotice(false)
  }

  const applyPythonPreset = (): void => {
    dirtyRef.current = true
    setSharedDirsText((prev) => appendUniqueLine(prev, '.venv'))
    setSavedNotice(false)
  }

  const applyEnvPreset = (): void => {
    dirtyRef.current = true
    setIncludeText((prev) => appendUniqueLine(prev, '.env.local'))
    setSavedNotice(false)
  }

  const handleSave = async (): Promise<WorktreeTemplateConfig | null> => {
    setSaving(true)
    setError(null)
    setSavedNotice(false)
    try {
      const next = await api.saveWorktreeTemplate({
        rootPath,
        sharedDirectories: parseLines(sharedDirsText),
        copyFiles: config?.copyFiles ?? [],
        worktreeInclude: includeText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
        setupScript: setupScript.trim()
      })
      dirtyRef.current = false
      hydrate(next)
      setSavedNotice(true)
      onTemplateChanged?.()
      return next
    } catch (err) {
      setError(humanizeError(err))
      return null
    } finally {
      setSaving(false)
    }
  }

  const handlePreview = async (): Promise<void> => {
    setPreviewing(true)
    setError(null)
    try {
      const result = await api.previewWorktreeTemplate({ rootPath })
      setPreview(result)
    } catch (err) {
      setError(humanizeError(err))
    } finally {
      setPreviewing(false)
    }
  }

  const handleToggleSensitiveTrust = async (): Promise<void> => {
    setTrusting(true)
    setError(null)
    try {
      const current = config?.sensitiveHash ? config : await handleSave()
      const hash = current?.sensitiveHash ?? preview?.sensitiveHash ?? ''
      const nextTrusted = !(current?.sensitiveApproved ?? false)
      const updated = await api.trustWorktreeSensitiveCopy({
        rootPath,
        contentHash: hash,
        trusted: nextTrusted
      })
      dirtyRef.current = false
      hydrate(updated)
      if (preview) {
        setPreview(await api.previewWorktreeTemplate({ rootPath }))
      }
      onTemplateChanged?.()
    } catch (err) {
      setError(humanizeError(err))
    } finally {
      setTrusting(false)
    }
  }

  const includeLines = includeText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const hasSensitive =
    (config?.sensitivePatterns.length ?? 0) > 0 ||
    (preview?.sensitivePending.length ?? 0) > 0 ||
    hasSensitivePatternText(includeLines)
  const sensitiveApproved = config?.sensitiveApproved === true

  return (
    <section className={styles.section} aria-label={t('worktree.template.title')}>
      <div className={styles.header}>
        <Button
          variant="ghost"
          size="sm"
          icon={open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
          aria-expanded={open}
          onClick={() => {
            setOpen((v) => !v)
            setPreview(null)
            setSavedNotice(false)
            setError(null)
          }}
          data-testid="wt-template-toggle"
        >
          <SlidersHorizontal size={12} aria-hidden="true" />
          <span>{t('worktree.template.title')}</span>
        </Button>
        {config && config.sources.length > 0 ? (
          <div className={styles.headerMeta}>
            {config.sources.map((src) => (
              <Badge key={src} intent="info">{src}</Badge>
            ))}
          </div>
        ) : null}
      </div>

      {open ? (
        <div className={styles.body}>
          {loading ? <Spinner label={t('worktree.template.loading')} /> : null}
          {error ? <ErrorState compact title={t('worktree.template.errorTitle')} message={error} /> : null}
          {savedNotice ? <Notice intent="success" title={t('worktree.template.saved')} /> : null}

          <SectionLabel>{t('worktree.template.presetsLabel')}</SectionLabel>
          <div className={styles.presets}>
            <Button
              variant="secondary"
              size="sm"
              onClick={applyNodePreset}
              data-testid="wt-preset-node"
            >
              {t('worktree.template.presetNode')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={applyPythonPreset}
              data-testid="wt-preset-python"
            >
              {t('worktree.template.presetPython')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={applyEnvPreset}
              data-testid="wt-preset-env"
            >
              {t('worktree.template.presetEnv')}
            </Button>
          </div>

          <TextArea
            mono
            rows={2}
            label={t('worktree.template.sharedDirsLabel')}
            hint={t('worktree.template.sharedDirsHint')}
            placeholder="node_modules"
            value={sharedDirsText}
            onChange={(event) => {
              dirtyRef.current = true
              setSharedDirsText(event.currentTarget.value)
              setSavedNotice(false)
            }}
            disabled={saving}
            data-testid="wt-template-shared-dirs"
          />

          <TextArea
            mono
            rows={3}
            label={t('worktree.template.includeLabel')}
            hint={t('worktree.template.includeHint')}
            placeholder={'.env.local\n!.env.production'}
            value={includeText}
            onChange={(event) => {
              dirtyRef.current = true
              setIncludeText(event.currentTarget.value)
              setSavedNotice(false)
            }}
            disabled={saving}
            data-testid="wt-template-include"
          />

          <TextField
            mono
            label={t('worktree.template.setupLabel')}
            hint={t('worktree.template.setupHint')}
            placeholder="npm run bootstrap"
            value={setupScript}
            onChange={(event) => {
              dirtyRef.current = true
              setSetupScript(event.currentTarget.value)
              setSavedNotice(false)
            }}
            disabled={saving}
            data-testid="wt-template-setup"
          />

          {hasSensitive ? (
            <div className={styles.sensitiveBox}>
              <span>
                {sensitiveApproved
                  ? t('worktree.template.sensitiveApproved')
                  : t('worktree.template.sensitivePending')}
              </span>
              <div>
                <Button
                  variant={sensitiveApproved ? 'ghost' : 'secondary'}
                  size="sm"
                  icon={sensitiveApproved ? <ShieldCheck size={12} aria-hidden="true" /> : <ShieldAlert size={12} aria-hidden="true" />}
                  disabled={trusting}
                  onClick={() => void handleToggleSensitiveTrust()}
                  data-testid="wt-template-sensitive-optin"
                >
                  {sensitiveApproved
                    ? t('worktree.template.sensitiveRevoke')
                    : t('worktree.template.sensitiveApprove')}
                </Button>
              </div>
            </div>
          ) : null}

          <div className={styles.actions}>
            <Button
              variant="secondary"
              size="sm"
              icon={<Eye size={12} aria-hidden="true" />}
              disabled={previewing}
              onClick={() => void handlePreview()}
              data-testid="wt-template-preview"
            >
              {previewing ? t('worktree.template.previewing') : t('worktree.template.preview')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Save size={12} aria-hidden="true" />}
              disabled={saving}
              onClick={() => void handleSave()}
              data-testid="wt-template-save"
            >
              {saving ? t('worktree.template.saving') : t('worktree.template.save')}
            </Button>
          </div>

          {preview ? (
            <div className={styles.preview} data-testid="wt-template-dryrun-result">
              <SectionLabel>{t('worktree.template.dryRunTitle')}</SectionLabel>
              {preview.linked.length === 0 &&
              preview.copied.length === 0 &&
              preview.skipped.length === 0 &&
              !preview.hookCommands.setup ? (
                <span className={styles.previewMuted}>{t('worktree.template.dryRunEmpty')}</span>
              ) : (
                <>
                  {preview.linked.length > 0 ? (
                    <div>
                      <strong>{t('worktree.template.dryRunLinked', { count: preview.linked.length })}</strong>
                      <ul className={styles.previewList}>
                        {preview.linked.map((dir) => <li key={dir}>{dir}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {preview.copied.length > 0 ? (
                    <div>
                      <strong>{t('worktree.template.dryRunCopied', { count: preview.copied.length })}</strong>
                      <ul className={styles.previewList}>
                        {preview.copied.map((file) => <li key={file}>{file}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {preview.skipped.length > 0 ? (
                    <div>
                      <strong>{t('worktree.template.dryRunSkipped', { count: preview.skipped.length })}</strong>
                      <ul className={styles.previewList}>
                        {preview.skipped.map((item, idx) => (
                          <li key={`${item.path}-${item.reason}-${idx}`}>
                            {item.path} ({item.reason})
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {preview.hookCommands.setup ? (
                    <div>
                      <strong>{t('worktree.template.dryRunHook')}</strong>{' '}
                      <code>{preview.hookCommands.setup}</code>{' '}
                      <Badge intent={preview.hookTrusted.setup ? 'success' : 'warning'}>
                        {preview.hookTrusted.setup
                          ? t('worktree.template.hookApproved')
                          : t('worktree.template.hookPending')}
                      </Badge>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
