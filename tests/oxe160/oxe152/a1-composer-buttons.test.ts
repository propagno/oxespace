// Frozen acceptance test for 1.6.0 program 160-152 (Jira OXE-152, A1). Written by the planner; the executor must not
// edit it. The composer and its configuration on main b3491f620 write 28 raw <button> tags (ThreadConfigurationBar 12,
// ThreadPromptQueue 10, ThreadComposerForm 3, useThreadCommands 2, useFileMentions 1). Contract: none, every control
// a src/ui primitive with the BRD-04 measures.
import { describe, expect, it } from 'vitest'
import { offenders } from './raw-buttons'

const COMPOSER = ['ThreadConfigurationBar.tsx', 'ThreadComposerForm.tsx', 'ThreadPromptQueue.tsx', 'useThreadCommands.tsx', 'useFileMentions.tsx']

describe('OXE-152 · A1 the composer on the src/ui primitives', () => {
  it('the composer and its configuration have no raw button', () => {
    expect(offenders(COMPOSER)).toEqual([])
  })
})
