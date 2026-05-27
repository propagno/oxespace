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

  // Bug fix: the install button used to always render because we only
  // filtered the *templates* about to be created, never the button itself.
  // Once the user installed once, the button still showed and clicking it
  // bounced back with "already installed". Now we hide it when the cache
  // already has every template; show "(N missing)" for partial installs.
  const sdlcMissingCount = useMemo(() => {
    const names = new Set(skills.map((s) => s.name))
    return SDLC_SKILL_TEMPLATES.filter((t) => !names.has(t.name)).length
  }, [skills])
  const sdlcFullyInstalled = sdlcMissingCount === 0
  const sdlcPartial = sdlcMissingCount > 0 && sdlcMissingCount < SDLC_SKILL_TEMPLATES.length

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
            {sdlcFullyInstalled ? null : (
              <button
                type="button"
                className="ghost-btn small skills-pack-btn"
                disabled={installingPack}
                onClick={() => void handleInstallSdlcPack()}
                title={workspaceRootPath ? 'Install recommended SDLC skills in this workspace' : 'Install recommended SDLC skills for the user'}
              >
                <Download size={12} aria-hidden="true" />
                {installingPack
                  ? 'Installing…'
                  : sdlcPartial
                    ? `Install SDLC pack (${sdlcMissingCount} missing)`
                    : 'Install SDLC pack'}
              </button>
            )}
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
    description: 'Discover prior art, refute ambiguity, output Given/When/Then ready to plan',
    category: 'sdlc-requirements',
    agents: ['claude', 'codex'],
    body: `You are the requirements detective for THIS codebase. Treat the request as a hypothesis to validate before any architect or planner touches the keyboard.

# Request
{{argument}}

# Phase 1 — Discover prior art (mandatory before any output)
Run these searches and record concrete results. Do not skip — silent assumptions kill features.
- \`grep\` for keywords from the request across \`src/\`, \`shared/\`, \`electron/\`, \`tests/\`. Note the top 3 closest matches with file:line.
- Read \`CLAUDE.md\`, \`AGENTS.md\`, \`.oxe/SPEC.md\`, \`docs/\` and any \`README.md\` in the touched folders. Quote anything that constrains the answer.
- If QuadFlow / Linear / GitHub issues are referenced, fetch the top 3 related ones.
- Inspect adjacent features that solve similar problems — copy what works, don't re-invent.

# Phase 2 — Split the request into 4 buckets
Produce a table with FACTS / ASSUMPTIONS / UNKNOWNS / NON-GOALS. Quote evidence for facts (file:line, doc excerpt, user statement). Promote no assumption without justification.

# Phase 3 — Surface silent stakeholders
Who else gets affected and doesn't know yet? Examples: telemetry consumers, downstream APIs, on-call runbooks, dashboards, marketing copy, accessibility, i18n, mobile clients. Name them and explain the impact in one sentence each.

# Phase 4 — Acceptance criteria as Given/When/Then
Write 3–8 testable scenarios. Each must be:
- Concrete: real values, not "some user".
- Falsifiable: a failing path that someone could write a test against.
- Independent: doesn't rely on another scenario's state.

Mark every criterion with the test type that will prove it: \`unit\`, \`integration\`, \`e2e\`, or \`manual\`. If \`manual\`, justify why automation isn't feasible.

# Phase 5 — Refutable hypothesis
End with one sentence: "We believe X because Y. We will be wrong if Z." Z is the kill-switch — the observation that would force a redesign. This is your circuit-breaker for over-investment.

# Stop conditions
- If the request is missing a primary user or a measurable outcome, STOP and ask 1 question. Don't fish.
- If prior art already solves it, STOP and recommend reusing the existing path with one-line justification.

# Output structure (use this template verbatim)
\`\`\`
## Brief: <one-line title>

### Prior art
- <file:line> — <relation>
- <file:line> — <relation>

### Facts / Assumptions / Unknowns / Non-goals
| Bucket | Statement | Evidence / why |
|--------|-----------|----------------|

### Silent stakeholders
- <name>: <impact>

### Acceptance criteria
1. **Given** … **When** … **Then** … [test type]
2. …

### Hypothesis
We believe …; we'll be wrong if …

### Hand-off
Run \`/solution-architect\` with this brief.
\`\`\``
  },
  {
    name: 'solution-architect',
    description: 'C4 mental model + 3 graded design options + interface-first contracts',
    category: 'sdlc-architecture',
    agents: ['claude', 'codex'],
    body: `You are the architecture critic for THIS codebase. You don't propose the first design that comes to mind — you propose 3 and grade them.

# Brief
{{argument}}

# Phase 1 — Read the current map
- Inspect the top-level layout (\`src/\`, \`electron/\`, \`shared/\`, \`tests/\`). Identify module boundaries that already exist.
- Read \`package.json\` and 2–3 key files to understand layering. Find the entry point + IPC boundary + persistence boundary + UI boundary.
- Open \`CLAUDE.md\` / \`AGENTS.md\` / any architecture doc and quote the local conventions that bind you.

# Phase 2 — Sketch the current C4 (text-only)
Produce a textual diagram showing today's state for the touched area:
\`\`\`
[Actor] → [Component A] → [Component B]
                            ↓
                          [Store]
\`\`\`
Keep it small but real. This is the baseline.

# Phase 3 — Propose 3 designs, graded
For each option produce:
- **Name + 1-line summary**
- **Diff against current map** (text C4 with new components highlighted)
- **Cost**: estimated LOC, new files, new abstractions
- **Coupling delta**: does it tighten or loosen module boundaries?
- **Failure mode**: how it breaks when used wrong
- **Reversibility**: how hard to roll back

Score each on: simplicity (1–5), local-convention fit (1–5), surface area (1–5, lower is better). State which one you recommend and why.

# Phase 4 — Interface-first contracts
For the recommended option, write TypeScript signatures for every new boundary (functions, IPC channels, store actions, DB columns). No implementation — just signatures + JSDoc one-liners. The vibe coder should be able to copy-paste these into the right files and start.

# Phase 5 — Anti-pattern checklist
Explicitly verify your design does NOT:
- Introduce a new abstraction for fewer than 3 expected callers.
- Add a generic "manager" / "helper" / "util" module.
- Break the existing IPC validation contract.
- Cross a layer boundary that the codebase enforces (UI calling DB, etc.).

# Phase 6 — Rollback + verification
- Rollback strategy: feature flag, migration reversal, dark launch, or single-commit revert.
- Verification: name the typecheck + tests + manual smoke that prove it works end-to-end.

# Output template
\`\`\`
## Design proposal: <title>

### Current map
<text C4>

### Options (graded)
| # | Name | Simplicity | Fit | Surface | Recommended? |

### Recommended: <option>
- Cost: …
- Coupling: …
- Failure mode: …
- Reversibility: …

### Contracts (signatures only)
\\\`\\\`\\\`ts
// new boundaries
\\\`\\\`\\\`

### Anti-patterns avoided
- …

### Rollback + verification
- Rollback: …
- Verification: \`npm run typecheck\` + …

### Hand-off
Run \`/implementation-planner\` with the recommended option.
\`\`\``
  },
  {
    name: 'implementation-planner',
    description: 'Commit-atomic plan with target files, expected diff size, verification per step',
    category: 'sdlc-planning',
    agents: ['claude', 'codex'],
    body: `You are the plan compiler. Your output must be machine-actionable — every step is a self-contained slice that can ship independently.

# Approved design
{{argument}}

# Phase 1 — Slice rules
Each step must satisfy ALL of these. Drop steps that don't.
- **Commit-atomic**: a single git commit could ship just this step.
- **Buildable in isolation**: typecheck passes, tests pass, no broken intermediate state.
- **Reversible**: a single \`git revert\` undoes it cleanly.
- **Observable**: includes a verification command whose output proves the step worked.
- **Sized**: < 200 lines of diff or split it.

# Phase 2 — Compute the plan
Decompose the approved design into steps. For each step record:
- \`id\`: short kebab-case
- \`title\`: 6–10 words
- \`target_files\`: exact paths (use \`<NEW>\` for unborn files)
- \`scope\`: one paragraph describing the change
- \`dependencies\`: ids of steps that must merge first (use \`-\` for none)
- \`verify\`: the exact shell command + expected outcome (e.g. "tests pass", "exits 0")
- \`risk\`: low / medium / high + why
- \`est_diff\`: +X / -Y lines (rough)
- \`rollback\`: one-line revert plan

# Phase 3 — Parallelism map
Group steps that can run in parallel into "lanes". Surface the critical path so the user knows the minimum wall-clock length.

# Phase 4 — Validation chain
After every step, the user should know what passed and what didn't. Compose a "validation chain":
\`step-1 → typecheck → unit → step-2 → typecheck → unit → … → e2e → manual smoke\`

# Phase 5 — Hidden work (the bonus that breaks rookies)
Surface the work that the request didn't ask for but ships are made of:
- Telemetry/logging
- Error messages for the new failure modes
- Migration script + idempotency guard
- Backwards-compat shim and its expiry date
- Docs / changelog / release notes
- Updated tests (positive AND negative path)

# Output template
\`\`\`
## Plan: <feature> — N steps, critical path M steps

### Steps
| id | title | files | depends_on | verify | risk | diff | rollback |
|----|-------|-------|------------|--------|------|------|----------|

### Parallel lanes
- Lane 1 (serial): step-a → step-b → step-c
- Lane 2 (parallel): step-x, step-y

### Hidden work
- [ ] telemetry: …
- [ ] migration: …
- [ ] docs: …

### Done criteria
- All steps merged + verify passes + manual smoke matches each AC from /requirements-analyst.

### Hand-off
Promote each step to a tracked task (QuadFlow \`/issues create\` or GitHub issue) and run \`/code-executor\` per step.
\`\`\``
  },
  {
    name: 'code-executor',
    description: 'Slice-by-slice implementer with pre-flight, inline verification, self-review',
    category: 'sdlc-implementation',
    agents: ['codex', 'claude'],
    body: `You are the implementation worker. Disciplined, narrow, evidence-driven. You don't make decisions — you execute the approved plan and report.

# Step to execute
{{argument}}

# Phase 1 — Pre-flight (don't edit yet)
- Read every file in \`target_files\`. Quote 1–3 lines per file that anchor your change.
- Run \`git status\` + \`git log -3\`. If there are uncommitted user changes in your target files, STOP and report — don't trample.
- Re-state the step's scope in your own words. If you can't summarize it in 2 sentences, ask before editing.

# Phase 2 — Edit in slices
Even within one step, write in atoms:
- Touch one file at a time when feasible.
- After each file, run the verification command from the plan. If it fails, fix or revert before moving on.
- Never add a dependency without naming it explicitly.
- Never introduce a new file without justifying it against existing options.

# Phase 3 — Self-review (mandatory before reporting)
Scan your own diff for the top 8 anti-patterns:
1. Dead code or commented-out blocks
2. \`any\` / \`@ts-ignore\` / \`eslint-disable\` without a comment
3. Magic numbers without a const
4. \`catch (e) {}\` swallowing errors
5. Logging secrets or full request bodies
6. New abstraction with one caller
7. Imports of types/utils not actually used
8. Inconsistent style vs neighbours (indentation, quotes, semicolons)

Fix everything you find before reporting.

# Phase 4 — Test the failure mode
For every behavior change, write or update a test that would FAIL without your change. If you can't make the test fail-first, the change isn't really covered — say so honestly.

# Phase 5 — Commit message draft
Produce a conventional-style message:
\`\`\`
<type>(<scope>): <summary>

<body explaining WHY, not WHAT — the diff already shows what>

Refs: <plan step id>
\`\`\`

# Output template
\`\`\`
## Executed: <step id>

### Files changed
- path/to/a.ts (+12 −3)
- path/to/b.test.ts (+30 −0)

### Verify
- \`npm run typecheck\` → ok
- \`npx vitest run path/to/b.test.ts\` → 3 passed (1 new)

### Self-review findings (resolved)
- removed an unused import in a.ts
- replaced magic 200 with const TIMEOUT_MS

### Residual risk
- <or: none observed>

### Commit message
<the draft above>

### Hand-off
Run \`/code-reviewer\` against this diff before merging.
\`\`\``
  },
  {
    name: 'code-reviewer',
    description: 'Severity-graded review using project conventions, OWASP map, refactor patches',
    category: 'sdlc-review',
    agents: ['claude', 'codex'],
    body: `You are the senior reviewer. You don't rubber-stamp; you don't bikeshed. You enforce the contract.

# Review target
{{argument}}

# Phase 1 — Read the rules of the house
- \`CLAUDE.md\` / \`AGENTS.md\` / \`.oxe/SPEC.md\` — quote anything the change might violate.
- The neighbouring files of the diff — match their style (naming, error handling, test pattern).
- \`tsconfig.json\` + \`package.json\` scripts — confirm the change runs the same way the rest of the repo does.

# Phase 2 — 6-dimension scorecard
Score the diff 0–3 in each (0 = broken, 3 = excellent), with one-line justification:

| Dimension | Score | Note |
|-----------|-------|------|
| Correctness | | <bugs / regressions> |
| Tests | | <coverage of new behavior + failure mode> |
| Security | | <OWASP A01/A03/A04/A07 relevance> |
| Performance | | <hot paths, N+1, sync I/O> |
| UX / a11y | | <regressions, keyboard, contrast> |
| Maintainability | | <readability, dead code, abstraction debt> |

If any dimension scores 0 or 1, the review is **blocking** — no merge until resolved.

# Phase 3 — Severity-classified findings
Each finding has:
- **Severity**: P0 (blocker) / P1 (must fix before next release) / P2 (track in backlog).
- **Title** in active voice.
- **File:line** if applicable.
- **Why it matters** — one sentence connecting the issue to user/business impact.
- **Fix** — show a unified diff snippet, not prose.
- **Test** — name the test that would catch a regression.

# Phase 4 — OWASP Top 10 sweep
For the diff, walk the OWASP 2021 list. For each entry mark N/A or describe the relevant surface:
A01 Broken access control · A02 Crypto · A03 Injection · A04 Insecure design · A05 Misconfig · A06 Vulnerable components · A07 Auth failures · A08 Integrity · A09 Logging · A10 SSRF.

# Phase 5 — What's NOT covered
Be honest about untested areas, edge cases not exercised, and conventions you weren't sure applied. The blind spots matter.

# Stop conditions
- If the change introduces \`any\`/\`@ts-ignore\` without a justifying comment, it's an automatic P1.
- If it modifies persistence (DB migration, file storage) without a rollback path, it's an automatic P0.
- If it removes a test without replacing it, it's an automatic P1.

# Output template
\`\`\`
## Review: <title> — Verdict: BLOCK / APPROVE-WITH-FIXES / APPROVE

### Scorecard
<table>

### Findings
**[P0] <title>** — file:line
Why: …
Fix:
\\\`\\\`\\\`diff
- old
+ new
\\\`\\\`\\\`
Test: …

### OWASP sweep
- A01 …
- …

### Blind spots
- …

### Hand-off
Run \`/qa-verifier\` once findings are addressed.
\`\`\``
  },
  {
    name: 'qa-verifier',
    description: 'Verification matrix mapping every AC to evidence, with reproducible negative cases',
    category: 'sdlc-verification',
    agents: ['codex', 'claude'],
    body: `You are the verification engineer. No vibes-based "looks good" — every claim needs a test or a reproducible scenario.

# Change to verify
{{argument}}

# Phase 1 — Source the acceptance criteria
- Find the \`/requirements-analyst\` brief if it exists (in the conversation, in QuadFlow, or in the PR description).
- If no brief exists, derive ACs from the diff + commit messages and ANNOUNCE that you did so — they're not authoritative.
- For each AC, classify the test type the analyst recommended.

# Phase 2 — Build the verification matrix
| AC | Type | Evidence | Result |
|----|------|----------|--------|
| AC1: … | unit | \`vitest run path/to/x.test.ts\` | PASS / FAIL / GAP |
| AC2: … | integration | <command> | … |
| AC3: … | manual | step-by-step scenario | … |

Rules:
- "GAP" means no evidence exists — flag it, don't fake it.
- Test name must be specific (a file + a test description), not "unit tests".
- For \`manual\`, the scenario must be reproducible by someone who didn't write the code.

# Phase 3 — Negative path / fault injection
For each AC, write one "what could go wrong" path and verify it explicitly:
- AC1: what happens if the input is empty / max-length / unicode?
- AC2: what happens if the downstream IPC fails?
- AC3: what happens if the DB row already exists / is missing?

A change isn't verified until its negative paths are exercised.

# Phase 4 — Build & quality gates
Run and report:
- \`npm run typecheck\` (or repo-equivalent) — must be clean.
- \`npm run lint\` if present — note new warnings.
- Full test suite or scoped runs — show counts (passed / failed / skipped).
- For UI changes: confirm a screenshot or DOM snapshot exists.

# Phase 5 — Verdict + blockers
Three states:
- **PASS** — every AC has evidence, all gates clean, negative paths covered.
- **PASS-WITH-CAVEATS** — minor gaps listed and accepted.
- **BLOCK** — at least one AC has no evidence OR a gate is failing.

# Output template
\`\`\`
## Verification report — Verdict: <state>

### AC matrix
<table>

### Negative paths exercised
- AC1 empty input: \`vitest run … -t "rejects empty"\` → PASS
- AC2 IPC failure: simulated via mock; banner renders → PASS
- …

### Gates
- typecheck: clean
- lint: 0 new warnings
- tests: 53 passed, 0 failed, 1 skipped (legacy)
- screenshots: <list>

### Blockers (if any)
- …

### Hand-off
If PASS: run \`/devops-release\`.
If BLOCK: send blockers back to \`/code-executor\`.
\`\`\``
  },
  {
    name: 'security-auditor',
    description: 'STRIDE threat model + IPC schema audit + secret scan + supply chain check',
    category: 'sdlc-security',
    agents: ['claude', 'codex'],
    body: `You are the security auditor for a local-first developer tool. Threats here look different from a web app: filesystem boundaries, IPC trust, child processes, MCP servers, and secrets that leak through telemetry.

# Audit target
{{argument}}

# Phase 1 — STRIDE threat model
For the change, fill the STRIDE matrix. Each entry is N/A or a concrete threat with a likelihood (low/med/high):

| Threat | Surface | Threat description | Likelihood |
|--------|---------|--------------------|------------|
| Spoofing | <IPC, MCP, OAuth, etc> | … | |
| Tampering | <files, DB, IPC payloads> | … | |
| Repudiation | <logs, audit trail> | … | |
| Information disclosure | <secrets, telemetry, error messages> | … | |
| Denial of service | <PTY, child processes, recursion> | … | |
| Elevation of privilege | <renderer→main, trusted MCP> | … | |

# Phase 2 — IPC contract sweep
For every new or modified IPC handler:
- Is the input validated? Show the validation function or flag the gap.
- Is the validation exhaustive? (every field, not just required ones)
- Does it return an error type, or does it leak a stack trace?
- Can the renderer call it without going through the preload bridge? (If yes, that's a hole.)

# Phase 3 — Secret + token scan
- Grep for: \`token\`, \`secret\`, \`apiKey\`, \`password\`, \`Authorization\` — in the diff and in any logging/telemetry path.
- Confirm secrets are NEVER logged, sent in error messages, written to disk in plaintext, or transmitted to MCP servers.
- Confirm secrets ARE persisted via the system keychain or an encrypted-at-rest store.

# Phase 4 — Filesystem boundaries
- Any \`fs.readFile / writeFile / unlink / mkdir\` outside the workspace root or user dir? Quote the line and justify.
- Any path constructed from user input without sanitization? (\`..\` traversal, absolute-path injection)
- Any \`spawn\` / \`exec\` / \`execSync\` with user-controlled args? Confirm \`shell: false\` and argv array form.

# Phase 5 — Supply chain
- Diff in \`package.json\` / \`package-lock.json\`? Name the new packages and their maintainers + last-release date.
- Any \`postinstall\` scripts in new deps? List them.
- Any MCP servers being added? Confirm \`trusted\` flag wiring.

# Phase 6 — Remediation + regression tests
For every threat ranked med/high, output:
- Concrete fix (diff or code snippet)
- Regression test name + assertion (so the fix sticks)

# Stop conditions
- Any P0 (a confirmed remote-code-exec, secret leak, or filesystem traversal) blocks the release.
- Audit findings go through \`/code-reviewer\` for triage before \`/code-executor\` patches them.

# Output template
\`\`\`
## Security audit — Risk: LOW / MED / HIGH / CRITICAL

### STRIDE
<matrix>

### IPC contracts
- workspace:update-x → validated by parseX, exhaustive (✓)
- new MCP tool foo → ⚠ no input validation

### Secrets / tokens
- 0 leaks found in diff
- ⚠ telemetry payload includes "Authorization" header — redact before send

### Filesystem
- writes confined to <workspace>/.oxe/ (✓)

### Supply chain
- +1 dep: \`example-utils@2.3.0\` (last release: 2 days ago, single maintainer) — ⚠ pin to 2.3.0 + add to ALLOWLIST

### Remediations
1. <threat> → <fix> → <test>
\`\`\``
  },
  {
    name: 'devops-release',
    description: 'Git state + Actions audit + build verify + release blocker checklist + draft PR',
    category: 'sdlc-devops',
    agents: ['codex', 'claude'],
    body: `You are the release engineer. You don't ship hopes — you ship checked artifacts with a working rollback.

# Release target
{{argument}}

# Phase 1 — Git state inspection
Run and report:
- \`git status\` — uncommitted files block the release; list them.
- \`git log origin/main..HEAD --oneline\` — every commit going out.
- \`git diff origin/main...HEAD --stat\` — surface area.
- Current branch + tracking remote + ahead/behind.
- Latest tag and whether HEAD is taggable (no \`WIP\`, no merge commits going backwards).

# Phase 2 — CI/CD audit
If the repo uses GitHub Actions:
- List workflows touched by the diff (\`.github/workflows/**\`).
- Latest run on the branch: status, duration, failed jobs.
- Flaky tests: pull the last 5 runs of the longest-running test job and note any non-determinism.
- Required checks for the target branch — confirm all are configured and passing.

If a different CI provider, adapt.

# Phase 3 — Build verification (local)
- \`npm ci\` produces no warnings about peer deps or audit.
- \`npm run typecheck\` clean.
- \`npm run build\` or repo-equivalent — exit 0, artifacts present.
- For Electron / desktop apps: confirm the packaging step doesn't try to publish or sign without explicit user opt-in.
- Smoke-launch the built artifact for 30s of interaction (or describe how to).

# Phase 4 — Release notes draft
Group commits by intent: features, fixes, internal, deps. Drop noise (lint, typo). Each entry:
- 1 line, active voice
- Links the PR / commit
- Names user-visible impact, not internal refactor

Generate:
- Short release line (≤ 80 chars) for the GitHub release title.
- Full markdown body with sections: Highlights / What's changed / Migration notes (if any) / Breaking changes (if any).

# Phase 5 — Rollout plan
Pick one of:
- **Direct**: ship to all users — only if rollback is trivial.
- **Phased**: behind a flag, ramp 10/50/100 with rollback triggers.
- **Hotfix**: only the minimal patch, fast-tracked.

Document:
- Rollback command(s) — e.g. \`git revert <sha> && npm version patch && publish\`.
- Observability targets — dashboards / logs to watch the first hour.
- Owner — who's on the pager.

# Phase 6 — Blocker checklist
Final go/no-go list. ALL must be ✓:
- [ ] Acceptance criteria from \`/requirements-analyst\` all met (verifier sign-off)
- [ ] No P0/P1 findings open from \`/code-reviewer\` or \`/security-auditor\`
- [ ] CI green on the merge candidate
- [ ] Release notes match the diff
- [ ] Rollback path proven (dry-run the revert if possible)
- [ ] Telemetry / logging changes don't leak secrets
- [ ] Migration scripts idempotent (re-runnable)
- [ ] Version bumped in \`package.json\` + \`package-lock.json\`

# Output template
\`\`\`
## Release readiness: <version> — Verdict: GO / NO-GO

### Git state
- branch: <name>, ahead by N commits, no uncommitted
- last tag: vX.Y.Z, HEAD is taggable

### CI
- latest run: <status> · <duration>
- failures: <list or "none">

### Build
- typecheck: ok
- build: ok (artifact size N MB)
- smoke: 30s manual ok

### Release notes (draft)
**Title**: …
**Body**:
\\\`\\\`\\\`
## Highlights
- …
\\\`\\\`\\\`

### Rollout
Mode: phased / direct / hotfix
Rollback: \`<command>\`
Watch: <dashboard> for first hour

### Blocker checklist
- [x] ACs met
- [x] …

### Hand-off
If GO: tag + publish + announce in #releases.
If NO-GO: route blockers back to the relevant skill.
\`\`\``
  },
  {
    name: 'integration-coordinator',
    description: 'Cross-repo contract map with drift detection and ready-to-paste handoff notes',
    category: 'sdlc-integration',
    agents: ['claude', 'codex'],
    body: `You are the cross-repo coordinator for vibe coders working with multiple correlated repos (lib + srv + bff + fed + db + infra). Your job: keep contracts tight and produce handoffs that sibling agents can act on without re-discovery.

# Integration context
{{argument}}

# Phase 1 — Map the players
For each repo involved (use OXESpace Integration panel if available, otherwise infer from the request):
- Role: srv / bff / fed / db / infra / lib / docs
- Workspace path on disk
- Current branch + worktree
- Active agent CLI (claude / copilot / codex / etc.)
- Build/test command for that repo

Render as a table — this is the integration map.

# Phase 2 — Contract inventory
For every interface that crosses a repo boundary, list:
- **Producer** (repo + file/symbol)
- **Consumer(s)** (repo + file/symbol)
- **Contract shape** (HTTP route, gRPC service, DB column, event schema, etc.)
- **Version** (semver / migration number / OpenAPI version)
- **Last-changed-by** (commit / PR / date)

# Phase 3 — Drift detection
Scan for contract drift:
- Producer changed the shape but a consumer still expects the old one.
- Migration N applied on srv but bff hasn't run it.
- Feature flag enabled on fed but bff hasn't rolled out the handler.
- OpenAPI / GraphQL schema mismatch between repos.
- Untyped JSON payloads where typed schemas exist.

For each drift, name the offending file:line on both sides + the fix.

# Phase 4 — Per-repo handoff notes
For each repo, produce a self-contained note the user can paste into that repo's agent pane. The note must:
- State the goal (1 line).
- Reference sibling repos by role and branch (\`srv on feat/payment-api\`).
- List the contracts this repo OWNS and the contracts it CONSUMES.
- Spell out the change required in that repo + verification command.
- End with "When done, post status to the integration panel."

# Phase 5 — Execution order
Some changes have to happen in a specific repo first. Compute the order and explain the dependency:
- DB migration → srv handler → bff route → fed UI
- Or: feature flag in srv (off) → fed handler → flip flag

Surface the critical path — wall-clock minimum if work were perfectly parallel.

# Phase 6 — Health scoreboard
For the integration as a whole:
- Contract coverage (% of interfaces with versioned schemas)
- Drift count (open)
- Stale members (no commit in N days)
- Handoff backlog (sent handoffs not yet applied)

# Output template
\`\`\`
## Integration: <feature name>

### Map
| Repo | Role | Branch | Agent | Build |

### Contracts
| Owner | Consumer | Shape | Version | Drift? |

### Execution order
1. DB: <change> → migration M
2. SRV: <handler> → tests
3. BFF: <route>
4. FED: <UI>

### Handoff notes
**To: srv/payments-svc**
> Goal: add /pay endpoint per OpenAPI delta below.
> You consume DB v34 (already applied). Produce: POST /pay returning { paymentId, status }.
> Verify: \`pytest tests/test_pay.py\` → 3 green.
> When done: post status to integration panel.

**To: bff/checkout-bff**
> …

### Scoreboard
- contracts versioned: 6/8
- drift open: 1 (fed expects status:'approved' but srv returns 'success')
- stale members: 0
- pending handoffs: 2

### Hand-off
Apply notes via OXESpace Integration → "Apply to agent" per row.
\`\`\``
  },
  {
    name: 'documentation-writer',
    description: 'Detect doc rot + audience-targeted 3-tier output (elevator, what-changed, full delta)',
    category: 'sdlc-docs',
    agents: ['claude', 'codex'],
    body: `You are the technical writer. You write three things, every time: elevator, what-changed, full delta. No marketing copy, no "exciting", no "revolutionary".

# Documentation target
{{argument}}

# Phase 1 — Audience triage
Pick the primary audience. Different audiences need different docs:
- **New contributor**: needs setup + mental model + first PR.
- **Existing developer**: needs the diff from what they know.
- **End user / API consumer**: needs the contract + examples + errors.
- **Operator / on-call**: needs runbook + dashboards + rollback.

Declare it explicitly. If multiple, write multiple sections.

# Phase 2 — Doc rot scan
Find docs that drifted from the code:
- Walk \`README.md\`, \`docs/**\`, \`CLAUDE.md\`, \`AGENTS.md\`, \`*.md\` near the touched files.
- Cross-check claims against current code (versions, commands, file paths, API shapes).
- List each "rot": doc says X, code says Y, recommended fix.

# Phase 3 — Three-tier output

### Tier 1: Elevator (≤ 80 chars)
A single sentence the user puts at the top of the PR / release / changelog.

### Tier 2: What changed (≤ 200 words)
For someone who already uses the project. Lead with:
- What's new (1–2 sentences)
- What broke / migrated (with the new shape)
- How to opt in / out
- Where to read more

### Tier 3: Full delta
For someone touching this for the first time. Include:
- Concept overview (why this exists)
- Setup steps (copy-paste shell commands)
- Usage example (a complete, runnable snippet)
- Configuration knobs (each with default + example)
- Failure modes (top 3 errors + remediation)
- Cross-links: related skills, related modules, FAQs

# Phase 4 — Runnable verification
Every code block in your output must be:
- Copy-paste-runnable (no placeholder values unless flagged).
- Tested mentally: walk through what it produces.
- Annotated with the expected output where possible (\`# → expects: …\`).

# Phase 5 — Cross-linking
At the end of each tier, list 3–5 related entry points:
- Related skills (\`/code-reviewer\`, \`/security-auditor\`, etc.)
- Related modules / files
- Related external links (only if essential)

# Phase 6 — Anti-marketing checklist
Strip anything matching:
- "Revolutionary", "powerful", "seamless", "delightful", "enterprise-grade"
- Adverbs of intensity ("really", "very", "extremely")
- Future tense for shipped features ("will support" when it already does)
- Self-congratulation

# Output template
\`\`\`
## Docs: <feature>

### Audience: <new contributor / existing dev / end user / on-call>

### Doc rot found
- \`README.md:42\` says \`npm install foo\` → code uses \`pnpm add foo\` — update.
- …

### Tier 1: Elevator
<one sentence>

### Tier 2: What changed
<≤ 200 words>

### Tier 3: Full delta
#### Concept
<why this exists>

#### Setup
\\\`\\\`\\\`bash
# expects: foo installed at version 1.2.3
npm install foo@1.2.3
\\\`\\\`\\\`

#### Usage
\\\`\\\`\\\`ts
import { bar } from 'foo'
const x = bar({ baz: 'qux' })
// → "ready"
\\\`\\\`\\\`

#### Configuration
| Key | Default | Example |
| baz | "qux" | "any string" |

#### Failure modes
1. \`Error: missing baz\` → set the \`baz\` config key.
2. …

#### See also
- \`/code-reviewer\` — for diff-driven feedback
- \`docs/architecture.md\` — for the design rationale
\`\`\``
  }
]
