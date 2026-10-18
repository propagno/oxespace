import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeSettingsPickModel, codexConfigPicksModel, detectModelOverride } from '../electron/main/services/conversation/thread-model-override'

describe('model override detection', () => {
  let root = ''
  let home = ''
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'oxe-model-root-'))
    home = await mkdtemp(join(tmpdir(), 'oxe-model-home-'))
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }) })

  it('reads Claude model choices from settings and env', () => {
    expect(claudeSettingsPickModel('{"model":"opus"}')).toBe(true)
    expect(claudeSettingsPickModel('{"env":{"ANTHROPIC_MODEL":"sonnet"}}')).toBe(true)
    expect(claudeSettingsPickModel('{"model":"  "}')).toBe(false)
    expect(claudeSettingsPickModel('{"permissions":{}}')).toBe(false)
    expect(claudeSettingsPickModel('not json')).toBe(false)
  })

  it('only counts a top-level Codex model, not one inside a profile', () => {
    expect(codexConfigPicksModel('model = "gpt-x"\n[profiles.fast]\nmodel = "mini"')).toBe(true)
    expect(codexConfigPicksModel('approval_policy = "never"\n[profiles.fast]\nmodel = "mini"')).toBe(false)
    expect(codexConfigPicksModel('# model = "commented"')).toBe(false)
  })

  it('is false when nothing chooses a model and true for a project or user file', async () => {
    const env = { CLAUDE_CONFIG_DIR: home, CODEX_HOME: home } as NodeJS.ProcessEnv
    expect((await detectModelOverride('claude', root, env)).mayOverride).toBe(false)
    expect((await detectModelOverride('codex', root, env)).mayOverride).toBe(false)
    await mkdir(join(root, '.claude'), { recursive: true })
    await writeFile(join(root, '.claude', 'settings.local.json'), '{"model":"opus"}')
    expect((await detectModelOverride('claude', root, env)).mayOverride).toBe(true)
    await writeFile(join(home, 'config.toml'), 'model = "gpt-x"\n')
    expect((await detectModelOverride('codex', root, env)).mayOverride).toBe(true)
  })

  it('treats ANTHROPIC_MODEL as an override', async () => {
    expect((await detectModelOverride('claude', root, { CLAUDE_CONFIG_DIR: home, ANTHROPIC_MODEL: 'haiku' } as NodeJS.ProcessEnv)).mayOverride).toBe(true)
  })
})
