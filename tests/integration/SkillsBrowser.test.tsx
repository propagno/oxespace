import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { SkillsBrowser } from '../../src/components/Skills/SkillsBrowser'
import { useSkillStore } from '../../src/store/skill.store'
import type { CreateSkillInput, SkillDefinition } from '../../shared/types/skill'

function createSkillFromInput(input: CreateSkillInput): SkillDefinition {
  const source = input.scope === 'workspace' ? 'workspace' : 'user'
  const fileRoot = source === 'workspace' ? input.workspaceRootPath ?? 'C:/repo' : 'C:/Users/test/.oxe/skills'
  return {
    name: input.name,
    description: input.description,
    agents: input.agents,
    category: input.category,
    hidden: false,
    body: input.body ?? '',
    source,
    filePath: `${fileRoot}/.oxe/skills/${input.name}.md`,
    mtimeMs: 1
  }
}

describe('SkillsBrowser — SDLC skill templates', () => {
  beforeEach(() => {
    window.oxe = {
      ...(window.oxe ?? {}),
      skill: {
        list: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue(null),
        invoke: vi.fn().mockResolvedValue(undefined),
        create: vi.fn(async (input: CreateSkillInput) => createSkillFromInput(input)),
        onChange: vi.fn(() => () => undefined)
      }
    } as unknown as typeof window.oxe

    useSkillStore.setState({ skills: [], loading: false, error: null, loaded: false })
  })

  test('installs the recommended SDLC pack into the current workspace', async () => {
    const user = userEvent.setup()
    render(
      <SkillsBrowser
        activePaneId="pane-1"
        workspaceId="workspace-1"
        workspaceRootPath="C:/repo"
        onClose={vi.fn()}
        onOpenEditor={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: /install sdlc pack/i }))

    await waitFor(() => expect(window.oxe.skill.create).toHaveBeenCalledTimes(10))
    expect(window.oxe.skill.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'requirements-analyst',
      scope: 'workspace',
      workspaceRootPath: 'C:/repo'
    }))
    expect(window.oxe.skill.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'security-auditor',
      category: 'sdlc-security',
      agents: expect.arrayContaining(['claude', 'codex'])
    }))
    expect(screen.getByText(/10 SDLC skills installed in this workspace/i)).toBeInTheDocument()
  })

  test('template picker creates a complete reviewer skill body', async () => {
    const user = userEvent.setup()
    const onOpenEditor = vi.fn()
    render(
      <SkillsBrowser
        activePaneId="pane-1"
        workspaceId="workspace-1"
        workspaceRootPath="C:/repo"
        onClose={vi.fn()}
        onOpenEditor={onOpenEditor}
      />
    )

    await user.click(screen.getByRole('button', { name: /new skill/i }))
    await user.selectOptions(screen.getByLabelText('Template') as HTMLSelectElement, 'code-reviewer')
    await user.click(screen.getByRole('button', { name: /create skill/i }))

    await waitFor(() => expect(window.oxe.skill.create).toHaveBeenCalledTimes(1))
    expect(window.oxe.skill.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'code-reviewer',
      description: expect.stringContaining('Review diffs'),
      category: 'sdlc-review',
      scope: 'workspace',
      workspaceRootPath: 'C:/repo',
      body: expect.stringMatching(/You are a strict code reviewer/)
    }))
    expect(onOpenEditor).toHaveBeenCalledWith('.oxe/skills/code-reviewer.md')
  })
})
