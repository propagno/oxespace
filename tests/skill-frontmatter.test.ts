import { describe, expect, it } from 'vitest'
import { parseSkillMarkdown } from '../electron/main/services/skill.service'

const file = (header: string, body = 'Do the thing.') => `---\n${header}\n---\n${body}\n`

describe('skill header', () => {
  it('reads the flat header skills have always used', () => {
    const skill = parseSkillMarkdown(file('name: review\ndescription: Review a diff\nagents: [claude, codex]\ncategory: quality\nhidden: false'), 'review.md')
    expect(skill).toEqual({ name: 'review', description: 'Review a diff', agents: ['claude', 'codex'], category: 'quality', hidden: false, body: 'Do the thing.' })
  })

  it('reads block lists, quoted values and folded descriptions', () => {
    const skill = parseSkillMarkdown(file('name: "deploy"\ndescription: >\n  Ship the build\n  to staging.\nagents:\n  - claude\n  - codex\nhidden: true'), 'deploy.md')
    expect(skill).toMatchObject({ name: 'deploy', description: 'Ship the build to staging.', agents: ['claude', 'codex'], hidden: true })
  })

  it('keeps loading a header that is not valid YAML', () => {
    const skill = parseSkillMarkdown(file('name: notes\ndescription: use for: quick notes\nagents: [claude]'), 'notes.md')
    expect(skill).toMatchObject({ name: 'notes', description: 'use for: quick notes', agents: ['claude'] })
  })

  it('does not run code or build objects from the header', () => {
    // js-yaml refuses the tag; the flat reading then keeps it as plain text.
    const skill = parseSkillMarkdown(file('name: x\ndescription: !!js/function "function(){}"'), 'x.md')
    expect(typeof skill?.description).toBe('string')
  })

  it('still rejects a missing or malformed name', () => {
    expect(parseSkillMarkdown(file('description: nameless'), 'a.md')).toBeNull()
    expect(parseSkillMarkdown(file('name: bad name\ndescription: x'), 'b.md')).toBeNull()
    expect(parseSkillMarkdown('no header at all', 'c.md')).toBeNull()
  })
})
