import { describe, expect, it } from 'vitest'
import { modelChipName, modelDisplayName } from '../../src/components/Threads/threadModelName'

const claude = { models: [
  { id: 'default', label: 'Default (recommended)', description: '', efforts: [], isDefault: true },
  { id: 'sonnet', label: 'Sonnet', description: '', efforts: [] }
], defaultModel: 'default' }

describe('modelDisplayName', () => {
  it('names provider ids as people say them', () => {
    expect(modelDisplayName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelDisplayName('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
    expect(modelDisplayName('claude-opus-4-20250514')).toBe('Opus 4')
    expect(modelDisplayName('claude-3-5-haiku-20241022')).toBe('Haiku 3.5')
    expect(modelDisplayName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
    expect(modelDisplayName('opus')).toBe('Opus')
    expect(modelDisplayName('gpt-5.1-codex')).toBe('gpt-5.1-codex')
  })
})

/** T57: the picker said "default" instead of the model the conversation runs. */
describe('modelChipName', () => {
  it('never says "default": Claude\'s alias shows the model the session reported', () => {
    expect(modelChipName({ chosen: 'default', catalog: claude, reported: 'claude-opus-5-5' })).toBe('Opus 5.5')
    expect(modelChipName({ catalog: claude, reported: 'claude-opus-5-5' })).toBe('Opus 5.5')
  })

  it('is unknown before the first turn when the default is only an alias', () => {
    expect(modelChipName({ chosen: 'default', catalog: claude })).toBeNull()
  })

  it('shows a picked model by its catalog label', () => {
    expect(modelChipName({ chosen: 'sonnet', catalog: claude, reported: 'claude-opus-5-5' })).toBe('Sonnet')
  })

  it('names a real default from the catalog, and trusts only the report when settings may override it', () => {
    const codex = { models: [{ id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', description: '', efforts: [], isDefault: true }], defaultModel: 'gpt-5.1-codex' }
    expect(modelChipName({ catalog: codex })).toBe('GPT-5.1 Codex')
    expect(modelChipName({ catalog: { ...codex, defaultModel: undefined, defaultKnown: false } })).toBeNull()
    expect(modelChipName({ catalog: { ...codex, defaultModel: undefined, defaultKnown: false }, reported: 'gpt-5.1-codex' })).toBe('GPT-5.1 Codex')
  })
})
