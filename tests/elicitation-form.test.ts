import { describe, expect, it } from 'vitest'
import { elicitationContent, elicitationDefaults, elicitationFields, validateElicitationField } from '../shared/elicitationForm'

const schema = {
  type: 'object',
  required: ['email', 'size'],
  properties: {
    email: { type: 'string', format: 'email', title: 'Email', maxLength: 40 },
    size: { type: 'string', oneOf: [{ const: 's', title: 'Small' }, { const: 'l', title: 'Large' }], default: 's' },
    count: { type: 'integer', minimum: 1, maximum: 5 },
    ratio: { type: 'number', default: 0.5 },
    tags: { type: 'array', items: { enum: ['a', 'b', 'c'] }, minItems: 1, maxItems: 2, default: ['a'] },
    agree: { type: 'boolean', default: false },
    legacy: { type: 'string', enum: ['x', 'y'], enumNames: ['Ex', 'Why'] },
    ignored: { type: 'object' }
  }
}

describe('elicitation form', () => {
  it('reads every primitive type, choices with titles, and skips what it cannot show', () => {
    const fields = elicitationFields(schema)
    expect(fields.map(field => [field.name, field.kind, field.required])).toEqual([
      ['email', 'text', true], ['size', 'single', true], ['count', 'number', false], ['ratio', 'number', false], ['tags', 'multi', false], ['agree', 'boolean', false], ['legacy', 'single', false]
    ])
    expect(fields.find(field => field.name === 'size')!.options).toEqual([{ value: 's', label: 'Small' }, { value: 'l', label: 'Large' }])
    expect(fields.find(field => field.name === 'legacy')!.options).toEqual([{ value: 'x', label: 'Ex' }, { value: 'y', label: 'Why' }])
    expect(elicitationDefaults(fields)).toEqual({ size: 's', ratio: 0.5, tags: ['a'], agree: false })
  })

  it('checks lengths, formats, bounds, whole numbers and choices', () => {
    const [email, , count, , tags] = elicitationFields(schema)
    expect(validateElicitationField(email, '')).toBe('This field is required')
    expect(validateElicitationField(email, 'nobody')).toBe('Enter a valid email address')
    expect(validateElicitationField(email, 'a@b.dev')).toBeNull()
    expect(validateElicitationField(email, `${'a'.repeat(40)}@b.dev`)).toBe('Maximum length is 40')
    expect(validateElicitationField(count, '')).toBeNull()
    expect(validateElicitationField(count, '0')).toBe('Minimum is 1')
    expect(validateElicitationField(count, '9')).toBe('Maximum is 5')
    expect(validateElicitationField(count, '2.5')).toBe('Enter a whole number')
    expect(validateElicitationField(count, 'abc')).toBe('Enter a number')
    expect(validateElicitationField(tags, [])).toBeNull()
    expect(validateElicitationField(tags, ['a', 'b', 'c'])).toBe('Choose at most 2')
    expect(validateElicitationField(tags, ['z'])).toBe('Choose from the options')
  })

  it('builds the answer: numbers as numbers, empty optional fields left out, problems reported', () => {
    const fields = elicitationFields(schema)
    const ok = elicitationContent(fields, { email: 'a@b.dev', size: 'l', count: '3', ratio: '', tags: ['b'], agree: true })
    expect(ok.errors).toEqual({})
    expect(ok.content).toEqual({ email: 'a@b.dev', size: 'l', count: 3, tags: ['b'], agree: true })
    const bad = elicitationContent(fields, { email: 'x', count: '10' })
    expect(Object.keys(bad.errors).sort()).toEqual(['count', 'email', 'size'])
  })

  it('an empty schema has no fields', () => {
    expect(elicitationFields(undefined)).toEqual([])
    expect(elicitationFields({ type: 'object' })).toEqual([])
  })
})
