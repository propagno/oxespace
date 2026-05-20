import { Copy, Edit3, FileText, FolderOpen, Play, RotateCw, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { SkillDefinition } from '../../../shared/types/skill'
import { useSkillStore } from '../../store/skill.store'

interface SkillsBrowserProps {
  workspaceId: string | null
  workspaceRootPath: string | null
  activePaneId: string | null
  onOpenEditor: (relativePath: string) => void
  onClose: () => void
}

export function SkillsBrowser({ activePaneId, onClose, onOpenEditor, workspaceId, workspaceRootPath }: SkillsBrowserProps): ReactElement {
  const skills = useSkillStore((s) => s.skills)
  const loading = useSkillStore((s) => s.loading)
  const error = useSkillStore((s) => s.error)
  const refresh = useSkillStore((s) => s.refresh)
  const invoke = useSkillStore((s) => s.invoke)
  const [filter, setFilter] = useState('')
  const [argumentBySkill, setArgumentBySkill] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [busySkill, setBusySkill] = useState<string | null>(null)

  useEffect(() => {
    void refresh(workspaceRootPath ?? undefined)
  }, [refresh, workspaceRootPath])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return skills
    return skills.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      (s.category ?? '').toLowerCase().includes(q)
    )
  }, [skills, filter])

  const userSkills = filtered.filter((s) => s.source === 'user')
  const workspaceSkills = filtered.filter((s) => s.source === 'workspace')

  const handleUseSkill = async (skill: SkillDefinition): Promise<void> => {
    if (!activePaneId) {
      setNotice('Selecione ou inicie um terminal antes de usar uma skill.')
      return
    }
    setBusySkill(skill.name)
    setNotice(null)
    try {
      await invoke(skill.name, activePaneId, argumentBySkill[skill.name] ?? '')
      setNotice(`/${skill.name} enviada para o terminal ativo.`)
    } catch (err) {
      setNotice(toMessage(err))
    } finally {
      setBusySkill(null)
    }
  }

  const handleCopySkill = async (skill: SkillDefinition): Promise<void> => {
    const argument = argumentBySkill[skill.name] ?? ''
    const prompt = renderSkillPrompt(skill.body, argument)
    try {
      await navigator.clipboard.writeText(prompt)
      setNotice(`Prompt de /${skill.name} copiado.`)
    } catch {
      setNotice('Não foi possível copiar o prompt.')
    }
  }

  const handleEditSkill = (skill: SkillDefinition): void => {
    if (!workspaceId || !workspaceRootPath) {
      setNotice('Para editar no OXESpace, abra um workspace primeiro.')
      return
    }
    const relativePath = toWorkspaceRelativePath(workspaceRootPath, skill.filePath)
    if (!relativePath) {
      setNotice('Esta skill é global. Para editar no editor do workspace, crie uma versão em <workspace>/.oxe/skills/.')
      return
    }
    onOpenEditor(relativePath)
    setNotice(`Abrindo /${skill.name} no editor.`)
  }

  return (
    <div className="skills-browser-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="skills-browser"
        role="dialog"
        aria-modal="true"
        aria-label="Skills"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="skills-browser-header">
          <div className="skills-browser-title">
            <Sparkles size={14} aria-hidden="true" />
            <strong>Agent Skills</strong>
            <span className="skills-browser-count">{skills.length} total</span>
          </div>
          <div className="skills-browser-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Atualizar"
              disabled={loading}
              onClick={() => void refresh(workspaceRootPath ?? undefined)}
            >
              <RotateCw size={13} className={loading ? 'usage-spin' : ''} aria-hidden="true" />
            </button>
            <button type="button" className="icon-button" aria-label="Fechar" onClick={onClose}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="skills-browser-search">
          <input
            type="search"
            placeholder="Buscar por nome, descrição ou categoria…"
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
          />
        </div>

        {error ? <div className="skills-browser-error">{error}</div> : null}
        {notice ? <div className="skills-browser-notice">{notice}</div> : null}

        <div className="skills-browser-list">
          {workspaceSkills.length > 0 ? (
            <>
              <div className="skills-section-label">Workspace ({workspaceSkills.length})</div>
              {workspaceSkills.map((skill) => (
                <SkillRow
                  key={skill.filePath}
                  skill={skill}
                  argument={argumentBySkill[skill.name] ?? ''}
                  busy={busySkill === skill.name}
                  canUse={Boolean(activePaneId)}
                  canEdit={Boolean(workspaceId && workspaceRootPath)}
                  onArgumentChange={(value) => setArgumentBySkill((state) => ({ ...state, [skill.name]: value }))}
                  onUse={() => void handleUseSkill(skill)}
                  onCopy={() => void handleCopySkill(skill)}
                  onEdit={() => handleEditSkill(skill)}
                />
              ))}
            </>
          ) : null}

          {userSkills.length > 0 ? (
            <>
              <div className="skills-section-label">User · ~/.oxe/skills ({userSkills.length})</div>
              {userSkills.map((skill) => (
                <SkillRow
                  key={skill.filePath}
                  skill={skill}
                  argument={argumentBySkill[skill.name] ?? ''}
                  busy={busySkill === skill.name}
                  canUse={Boolean(activePaneId)}
                  canEdit={Boolean(workspaceId && workspaceRootPath)}
                  onArgumentChange={(value) => setArgumentBySkill((state) => ({ ...state, [skill.name]: value }))}
                  onUse={() => void handleUseSkill(skill)}
                  onCopy={() => void handleCopySkill(skill)}
                  onEdit={() => handleEditSkill(skill)}
                />
              ))}
            </>
          ) : null}

          {filtered.length === 0 && !loading ? (
            <div className="skills-browser-empty">
              <Sparkles size={32} aria-hidden="true" />
              <strong>Sem skills</strong>
              <span>
                Crie arquivos <code>.md</code> em <code>~/.oxe/skills/</code> ou em{' '}
                <code>&lt;workspace&gt;/.oxe/skills/</code> com YAML frontmatter para extender os agentes.
              </span>
              <pre className="skills-browser-example">{`---
name: refactor
description: Refatora código no estilo do projeto
agents: [claude, codex]
category: refactor
---

Você é um refatorador. Analise {{argument}} e proponha melhorias.`}</pre>
            </div>
          ) : null}
        </div>

        <footer className="skills-browser-footer">
          <span>
            Skills aparecem no <kbd>Ctrl+/</kbd> automaticamente. Workspace skills sobrescrevem user skills com mesmo nome.
          </span>
        </footer>
      </section>
    </div>
  )
}

interface SkillRowProps {
  skill: SkillDefinition
  argument: string
  busy: boolean
  canUse: boolean
  canEdit: boolean
  onArgumentChange: (value: string) => void
  onUse: () => void
  onCopy: () => void
  onEdit: () => void
}

function SkillRow({ argument, busy, canEdit, canUse, onArgumentChange, onCopy, onEdit, onUse, skill }: SkillRowProps): ReactElement {
  return (
    <div className={`skill-row source-${skill.source}`}>
      <div className="skill-row-main">
        <div className="skill-row-title">
          <FileText size={11} aria-hidden="true" />
          <strong>/{skill.name}</strong>
          {skill.category ? <span className="skill-row-category">{skill.category}</span> : null}
        </div>
        <span className="skill-row-description">{skill.description || '(sem descrição)'}</span>
        <div className="skill-row-meta">
          {skill.agents.length > 0 ? (
            <span className="skill-row-agents">{skill.agents.join(', ')}</span>
          ) : (
            <span className="skill-row-agents">todos os agents</span>
          )}
          <span className="skill-row-path" title={skill.filePath}>
            <FolderOpen size={9} aria-hidden="true" /> {compactPath(skill.filePath)}
          </span>
        </div>
        <div className="skill-row-controls">
          <input
            type="text"
            value={argument}
            onChange={(event) => onArgumentChange(event.currentTarget.value)}
            placeholder="Argumento opcional para a skill..."
            aria-label={`Argumento para /${skill.name}`}
          />
          <div className="skill-row-buttons">
            <button type="button" className="primary-btn small" disabled={!canUse || busy} onClick={onUse} title={canUse ? 'Enviar para o terminal ativo' : 'Selecione um terminal ativo'}>
              <Play size={11} aria-hidden="true" /> Use
            </button>
            <button type="button" className="ghost-btn small" disabled={busy} onClick={onCopy} title="Copiar prompt renderizado">
              <Copy size={11} aria-hidden="true" /> Copy
            </button>
            <button type="button" className="ghost-btn small" disabled={!canEdit || busy} onClick={onEdit} title={skill.source === 'workspace' ? 'Editar no editor' : 'Skills globais precisam ser copiadas para o workspace para edição no editor'}>
              <Edit3 size={11} aria-hidden="true" /> Edit
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function compactPath(path: string): string {
  // Trim to last 3 segments for compactness
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 3) return path
  return '…' + path.slice(path.length - parts.slice(-3).join('/').length - 1)
}

function renderSkillPrompt(body: string, argument: string): string {
  if (body.includes('{{argument}}')) return body.replace(/\{\{argument\}\}/g, argument)
  return argument ? `${body}\n\n${argument}` : body
}

function toWorkspaceRelativePath(workspaceRootPath: string, filePath: string): string | null {
  const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const normalizedRoot = normalize(workspaceRootPath)
  const normalizedFile = filePath.replace(/\\/g, '/')
  const comparableFile = normalize(filePath)
  if (comparableFile === normalizedRoot) return null
  if (!comparableFile.startsWith(`${normalizedRoot}/`)) return null
  return normalizedFile.slice(workspaceRootPath.replace(/\\/g, '/').replace(/\/+$/, '').length + 1)
}

function toMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+':\s*/i, '').replace(/^Error:\s*/i, '').trim()
}
