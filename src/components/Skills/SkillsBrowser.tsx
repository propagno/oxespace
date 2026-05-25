import { Copy, Download, Edit3, FileText, FolderOpen, Play, Plus, RotateCw, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { BUILTIN_PROVIDERS, type AgentProvider } from '../../../shared/types/agent'
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
  const createSkill = useSkillStore((s) => s.createSkill)
  const [filter, setFilter] = useState('')
  const [argumentBySkill, setArgumentBySkill] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [busySkill, setBusySkill] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [installingPack, setInstallingPack] = useState(false)

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
      setNotice(`Prompt for /${skill.name} copied.`)
    } catch {
      setNotice('Could not copy the prompt.')
    }
  }

  const handleEditSkill = (skill: SkillDefinition): void => {
    if (!workspaceId || !workspaceRootPath) {
      setNotice('Open a workspace first to edit in OXESpace.')
      return
    }
    const relativePath = toWorkspaceRelativePath(workspaceRootPath, skill.filePath)
    if (!relativePath) {
      setNotice('This is a global skill. Copy it into <workspace>/.oxe/skills/ to edit in the workspace editor.')
      return
    }
    onOpenEditor(relativePath)
    setNotice(`Opening /${skill.name} in the editor.`)
  }

  const handleInstallSdlcPack = async (): Promise<void> => {
    setNotice(null)
    setInstallingPack(true)
    try {
      const existingNames = new Set(skills.map((skill) => skill.name))
      const scope = workspaceRootPath ? 'workspace' : 'user'
      const templates = SDLC_SKILL_TEMPLATES.filter((template) => !existingNames.has(template.name))
      if (templates.length === 0) {
        setNotice('SDLC skills already installed.')
        return
      }

      for (const template of templates) {
        await createSkill({
          name: template.name,
          description: template.description,
          category: template.category,
          agents: template.agents,
          body: template.body,
          scope,
          workspaceRootPath: scope === 'workspace' ? workspaceRootPath ?? undefined : undefined
        })
      }
      setNotice(`${templates.length} SDLC skills installed ${scope === 'workspace' ? 'in this workspace' : 'for the user'}.`)
      void refresh(workspaceRootPath ?? undefined)
    } catch (err) {
      setNotice(toMessage(err))
    } finally {
      setInstallingPack(false)
    }
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
              className="ghost-btn small skills-pack-btn"
              disabled={installingPack}
              onClick={() => void handleInstallSdlcPack()}
              title={workspaceRootPath ? 'Install recommended SDLC skills in this workspace' : 'Install recommended SDLC skills for the user'}
            >
              <Download size={12} aria-hidden="true" />
              {installingPack ? 'Installing…' : 'Install SDLC pack'}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="New skill"
              title="New skill"
              disabled={creating}
              onClick={() => setCreating(true)}
              data-testid="btn-new-skill"
            >
              <Plus size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Refresh"
              disabled={loading}
              onClick={() => void refresh(workspaceRootPath ?? undefined)}
            >
              <RotateCw size={13} className={loading ? 'usage-spin' : ''} aria-hidden="true" />
            </button>
            <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </header>

        {creating ? (
          <CreateSkillForm
            workspaceRootPath={workspaceRootPath}
            onCancel={() => setCreating(false)}
            onCreate={async (input) => {
              const created = await createSkill(input)
              setCreating(false)
              setNotice(`/${created.name} created at ${compactPath(created.filePath)}`)
              // Open workspace skills in the editor right away — gets the user
              // into the file to flesh out the prompt body. User skills can't
              // be opened in the workspace editor since they live outside it.
              if (created.source === 'workspace' && workspaceRootPath && workspaceId) {
                const relativePath = toWorkspaceRelativePath(workspaceRootPath, created.filePath)
                if (relativePath) onOpenEditor(relativePath)
              }
            }}
          />
        ) : null}

        <div className="skills-browser-search">
          <input
            type="search"
            placeholder="Search by name, description or category…"
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
              <strong>No skills</strong>
              <span>
                Create <code>.md</code> files in <code>~/.oxe/skills/</code> or{' '}
                <code>&lt;workspace&gt;/.oxe/skills/</code> with YAML frontmatter to extend your agents.
              </span>
              <pre className="skills-browser-example">{`---
name: refactor
description: Refactor code in the project's style
agents: [claude, codex]
category: refactor
---

You are a refactorer. Analyze {{argument}} and propose improvements.`}</pre>
            </div>
          ) : null}
        </div>

        <footer className="skills-browser-footer">
          <span>
            Skills appear in <kbd>Ctrl+/</kbd> automatically. Workspace skills override user skills with the same name.
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
        <span className="skill-row-description">{skill.description || '(no description)'}</span>
        <div className="skill-row-meta">
          {skill.agents.length > 0 ? (
            <span className="skill-row-agents">{skill.agents.join(', ')}</span>
          ) : (
            <span className="skill-row-agents">all agents</span>
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
            placeholder="Optional skill argument..."
            aria-label={`Argument for /${skill.name}`}
          />
          <div className="skill-row-buttons">
            <button type="button" className="primary-btn small" disabled={!canUse || busy} onClick={onUse} title={canUse ? 'Send to the active terminal' : 'Select an active terminal'}>
              <Play size={11} aria-hidden="true" /> Use
            </button>
            <button type="button" className="ghost-btn small" disabled={busy} onClick={onCopy} title="Copy rendered prompt">
              <Copy size={11} aria-hidden="true" /> Copy
            </button>
            <button type="button" className="ghost-btn small" disabled={!canEdit || busy} onClick={onEdit} title={skill.source === 'workspace' ? 'Edit in the editor' : 'Global skills must be copied into the workspace before editing'}>
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

interface CreateSkillFormProps {
  workspaceRootPath: string | null
  onCancel: () => void
  onCreate: (input: import('../../../shared/types/skill').CreateSkillInput) => Promise<void>
}

function CreateSkillForm({ onCancel, onCreate, workspaceRootPath }: CreateSkillFormProps): ReactElement {
  const [templateId, setTemplateId] = useState('custom')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [body, setBody] = useState('')
  const [scope, setScope] = useState<'user' | 'workspace'>(workspaceRootPath ? 'workspace' : 'user')
  const [agents, setAgents] = useState<AgentProvider[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const toggleAgent = (agent: AgentProvider): void => {
    setAgents((current) => current.includes(agent)
      ? current.filter((a) => a !== agent)
      : [...current, agent])
  }

  const applyTemplate = (nextTemplateId: string): void => {
    setTemplateId(nextTemplateId)
    const template = SDLC_SKILL_TEMPLATES.find((item) => item.name === nextTemplateId)
    if (!template) return
    setName(template.name)
    setDescription(template.description)
    setCategory(template.category)
    setAgents(template.agents)
    setBody(template.body)
    setSubmitError(null)
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setSubmitError(null)
    const trimmedName = name.trim()
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(trimmedName)) {
      setSubmitError('Name must be kebab-case (letters, digits, hyphens). Starts with a letter or digit.')
      return
    }
    if (!description.trim()) {
      setSubmitError('Description is required.')
      return
    }
    if (scope === 'workspace' && !workspaceRootPath) {
      setSubmitError('Open a workspace before creating a workspace-scoped skill.')
      return
    }
    setSubmitting(true)
    try {
      await onCreate({
        name: trimmedName,
        description: description.trim(),
        scope,
        agents,
        category: category.trim() || undefined,
        body: body.trim() || undefined,
        workspaceRootPath: scope === 'workspace' ? workspaceRootPath ?? undefined : undefined
      })
    } catch (err) {
      setSubmitError(toMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="skills-create-form" onSubmit={(e) => void handleSubmit(e)}>
      <header className="skills-create-header">
        <strong>New skill</strong>
        <span>The file is written to disk; you can edit the prompt body afterwards.</span>
      </header>

      <div className="skills-create-grid">
        <label className="skills-create-field">
          <span>Template</span>
          <select value={templateId} onChange={(e) => applyTemplate(e.currentTarget.value)}>
            <option value="custom">Custom skill</option>
            {SDLC_SKILL_TEMPLATES.map((template) => (
              <option key={template.name} value={template.name}>{template.name}</option>
            ))}
          </select>
        </label>

        <label className="skills-create-field">
          <span>Name (kebab-case)</span>
          <input
            type="text"
            value={name}
            placeholder="refactor-react"
            onChange={(e) => setName(e.currentTarget.value)}
            autoFocus
          />
        </label>

        <label className="skills-create-field">
          <span>Category (optional)</span>
          <input
            type="text"
            value={category}
            placeholder="refactor"
            onChange={(e) => setCategory(e.currentTarget.value)}
          />
        </label>
      </div>

      <label className="skills-create-field">
        <span>Description</span>
        <input
          type="text"
          value={description}
          placeholder="Refactor React components in the project's style"
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
      </label>

      <fieldset className="skills-create-field">
        <legend>Scope</legend>
        <label className="skills-create-radio">
          <input
            type="radio"
            name="skill-scope"
            value="user"
            checked={scope === 'user'}
            onChange={() => setScope('user')}
          />
          User — <code>~/.oxe/skills/</code> (every workspace sees it)
        </label>
        <label className={`skills-create-radio${!workspaceRootPath ? ' disabled' : ''}`}>
          <input
            type="radio"
            name="skill-scope"
            value="workspace"
            checked={scope === 'workspace'}
            disabled={!workspaceRootPath}
            onChange={() => setScope('workspace')}
          />
          Workspace — <code>&lt;root&gt;/.oxe/skills/</code> (overrides user skills with the same name)
        </label>
      </fieldset>

      <fieldset className="skills-create-field">
        <legend>Providers (empty = all)</legend>
        <div className="skills-create-providers">
          {BUILTIN_PROVIDERS.map((provider) => (
            <label key={provider} className="skills-create-checkbox">
              <input
                type="checkbox"
                checked={agents.includes(provider)}
                onChange={() => toggleAgent(provider)}
              />
              {provider}
            </label>
          ))}
        </div>
      </fieldset>

      {templateId !== 'custom' ? (
        <div className="skills-create-template-note">
          Template body will be written to the skill file. Workspace skills open in the editor after creation for tuning.
        </div>
      ) : null}

      {submitError ? <div className="skills-create-error">{submitError}</div> : null}

      <footer className="skills-create-actions">
        <button type="button" className="ghost-btn small" disabled={submitting} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary-btn small" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create skill'}
        </button>
      </footer>
    </form>
  )
}

function toMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+':\s*/i, '').replace(/^Error:\s*/i, '').trim()
}

interface SkillTemplate {
  name: string
  description: string
  category: string
  agents: AgentProvider[]
  body: string
}

const SDLC_SKILL_TEMPLATES: SkillTemplate[] = [
  {
    name: 'requirements-analyst',
    description: 'Clarify scope, acceptance criteria, constraints and non-goals before implementation',
    category: 'sdlc-requirements',
    agents: ['claude', 'codex'],
    body: `You are a senior requirements analyst for this codebase.

Goal: turn the request into an implementation-ready brief without writing code.

Input:
{{argument}}

Process:
- Separate facts, assumptions, open questions, non-goals and risks.
- Define explicit acceptance criteria.
- Identify affected users, workflows, modules and integrations.
- Flag ambiguity that would materially change implementation.
- Keep questions short and only ask what blocks a correct plan.

Output:
1. Problem statement
2. Scope and non-goals
3. Acceptance criteria
4. Risks and assumptions
5. Recommended next step`
  },
  {
    name: 'solution-architect',
    description: 'Design architecture, contracts, data flow, boundaries and rollout strategy',
    category: 'sdlc-architecture',
    agents: ['claude', 'codex'],
    body: `You are a pragmatic software architect.

Request:
{{argument}}

Before proposing changes:
- Inspect the current architecture and existing patterns.
- Prefer local conventions over new abstractions.
- Identify module boundaries, contracts, storage, IPC/API and UI impact.
- Consider backward compatibility, migration and rollback.

Output:
1. Recommended architecture
2. Files/modules likely affected
3. Data flow and contracts
4. Risks and tradeoffs
5. Rollback plan
6. Validation strategy`
  },
  {
    name: 'implementation-planner',
    description: 'Break a feature into ordered tasks with validation and rollback per step',
    category: 'sdlc-planning',
    agents: ['claude', 'codex'],
    body: `You are an implementation planner.

Task:
{{argument}}

Create a concrete execution plan:
- Use the smallest safe write set.
- Order tasks by dependency and risk.
- Include exact validation after each meaningful slice.
- Avoid vague tasks like "improve UI"; define observable results.
- Include rollback notes for risky changes.

Output:
1. Assumptions
2. Step-by-step plan
3. Validation commands/tests
4. Risks
5. Done criteria`
  },
  {
    name: 'code-executor',
    description: 'Implement a scoped approved plan with minimal unrelated changes',
    category: 'sdlc-implementation',
    agents: ['codex', 'claude'],
    body: `You are the implementation agent.

Approved work:
{{argument}}

Rules:
- Read the relevant code first.
- Make the smallest coherent change that satisfies the approved scope.
- Do not refactor unrelated code.
- Preserve user changes.
- Add or update focused tests when behavior changes.
- Report blockers instead of guessing around missing requirements.

Output:
1. Files changed
2. Behavior changed
3. Tests/validation run
4. Known residual risk`
  },
  {
    name: 'code-reviewer',
    description: 'Review diffs for bugs, regressions, missing tests and maintainability risks',
    category: 'sdlc-review',
    agents: ['claude', 'codex'],
    body: `You are a strict code reviewer.

Review target:
{{argument}}

Prioritize:
- Bugs and behavioral regressions.
- Security and data safety issues.
- Missing or weak tests.
- Race conditions, stale state, persistence/migration issues.
- UX regressions and accessibility issues.

Output findings first, ordered by severity:
[P0/P1/P2] Title
File/line if available
Why it matters
Concrete fix recommendation

If no issues are found, say so and list residual risks or untested areas.`
  },
  {
    name: 'qa-verifier',
    description: 'Build verification evidence from acceptance criteria, tests and manual scenarios',
    category: 'sdlc-verification',
    agents: ['codex', 'claude'],
    body: `You are a QA/verifier agent.

Change to verify:
{{argument}}

Verify from the user's acceptance criteria backwards:
- Map each criterion to evidence.
- Include automated tests, typecheck/build commands and manual scenarios.
- Identify gaps honestly.
- Do not mark done if critical evidence is missing.

Output:
1. Criteria covered
2. Commands run and results
3. Manual scenarios
4. Gaps/risks
5. Pass/fail recommendation`
  },
  {
    name: 'security-auditor',
    description: 'Audit local execution, filesystem, secrets, auth, IPC and supply-chain risks',
    category: 'sdlc-security',
    agents: ['claude', 'codex'],
    body: `You are a security auditor for a local developer tool.

Audit target:
{{argument}}

Focus on:
- Command execution and shell injection.
- Filesystem traversal and workspace boundary violations.
- Secret/token storage and leakage.
- IPC/preload validation.
- MCP/tool trust boundaries.
- Dependency and supply-chain risks.

Output:
1. Findings ordered by severity
2. Exploit scenario
3. Affected files/contracts
4. Concrete remediation
5. Tests or checks to prevent regression`
  },
  {
    name: 'devops-release',
    description: 'Analyze CI/CD, GitHub Actions, build packaging, release notes and rollout readiness',
    category: 'sdlc-devops',
    agents: ['codex', 'claude'],
    body: `You are a DevOps and release engineer.

Release/change:
{{argument}}

Evaluate:
- CI/CD workflow status and logs.
- Build/package commands.
- Version, changelog and release notes.
- Artifact availability.
- Rollback and rollout risks.
- GitHub branch/PR/release readiness.

Output:
1. Release readiness
2. CI/CD issues
3. Required commands
4. Release notes draft
5. Rollback plan`
  },
  {
    name: 'integration-coordinator',
    description: 'Coordinate multi-repo work across srv, bff, fed, db, infra and docs',
    category: 'sdlc-integration',
    agents: ['claude', 'codex'],
    body: `You are a multi-repo integration coordinator.

Integration context:
{{argument}}

Coordinate the work across repositories:
- Identify which repo owns each responsibility.
- Track branch/worktree/session assumptions.
- Produce handoff notes between repos.
- Detect missing contracts between srv, bff, fed, db and infra.
- Keep the summary short enough to paste into another terminal session.

Output:
1. Current integration map
2. Repo-by-repo responsibilities
3. Cross-repo contracts
4. Pending handoffs
5. Next repo/action`
  },
  {
    name: 'documentation-writer',
    description: 'Create README, changelog, usage, troubleshooting and developer docs for a change',
    category: 'sdlc-docs',
    agents: ['claude', 'codex'],
    body: `You are a technical documentation writer.

Documentation target:
{{argument}}

Create concise documentation that a developer can use immediately:
- Explain what changed and why.
- Include setup, usage and troubleshooting.
- Avoid marketing copy.
- Keep commands copyable.
- Mention limitations and prerequisites.

Output:
1. README/update section
2. Usage steps
3. Troubleshooting
4. Changelog/release note snippet`
  }
]
