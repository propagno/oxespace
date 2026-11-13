import { describe, expect, test } from 'vitest'
import { addPreviewProblem, formatPreviewProblems, isFailedRequest, MAX_PREVIEW_PROBLEMS, NO_PREVIEW_PROBLEMS, previewProblemCount, previewVerifyNote } from '../../shared/preview-problems'

describe('preview problems: what broke in the page since it loaded', () => {
  test('console errors count; warnings and info do not', () => {
    let problems = NO_PREVIEW_PROBLEMS
    problems = addPreviewProblem(problems, { level: 'warning', message: 'deprecated', source: 'a.js', line: 1 })
    problems = addPreviewProblem(problems, { level: 'info', message: 'ready', source: 'a.js', line: 2 })
    problems = addPreviewProblem(problems, { level: 'error', message: 'x is not defined', source: 'http://localhost:5173/src/App.tsx', line: 12 })
    expect(previewProblemCount(problems)).toBe(1)
    expect(problems.console[0].message).toBe('x is not defined')
  })

  test('a request fails with a network error or an answer of 400 and above; a cancelled one is not a problem', () => {
    expect(isFailedRequest({ method: 'GET', url: '/api', status: 500, type: 'fetch', ms: 3 })).toBe(true)
    expect(isFailedRequest({ method: 'GET', url: '/api', status: 404, type: 'fetch', ms: 3 })).toBe(true)
    expect(isFailedRequest({ method: 'GET', url: '/api', status: null, type: 'fetch', ms: null, failed: 'error' })).toBe(true)
    expect(isFailedRequest({ method: 'GET', url: '/api', status: null, type: 'fetch', ms: null, failed: 'canceled' })).toBe(false)
    expect(isFailedRequest({ method: 'GET', url: '/api', status: 304, type: 'fetch', ms: 3 })).toBe(false)
  })

  test('the same problem is kept once, and a page that floods does not fill the list', () => {
    let problems = NO_PREVIEW_PROBLEMS
    for (let i = 0; i < 5; i++) problems = addPreviewProblem(problems, { level: 'error', message: 'boom', source: 'a.js', line: 1 })
    expect(problems.console).toHaveLength(1)
    for (let i = 0; i < 60; i++) problems = addPreviewProblem(problems, { level: 'error', message: `boom ${i}`, source: 'a.js', line: i })
    expect(problems.console).toHaveLength(MAX_PREVIEW_PROBLEMS)
    for (let i = 0; i < 3; i++) problems = addPreviewProblem(problems, { method: 'GET', url: '/api/cart', status: 500, type: 'fetch', ms: 9 })
    expect(problems.network).toHaveLength(1)
  })

  test('nothing is changed when the row is not a problem', () => {
    const before = NO_PREVIEW_PROBLEMS
    expect(addPreviewProblem(before, { method: 'GET', url: '/ok', status: 200, type: 'fetch', ms: 2 })).toBe(before)
  })

  test('the prompt says where, what the console said and which requests failed, on one line each', () => {
    const text = formatPreviewProblems('http://localhost:5173/', {
      console: [{ level: 'error', message: 'TypeError: x is\n   not a function', source: 'http://localhost:5173/src/Cart.tsx', line: 30 }],
      network: [{ method: 'POST', url: 'http://localhost:5173/api/cart', status: 500, type: 'fetch', ms: 14 }, { method: 'GET', url: 'http://localhost:5173/logo.png', status: null, type: 'image', ms: null, failed: 'error' }]
    })
    expect(text).toBe([
      'The web preview at http://localhost:5173/ shows problems since the page last loaded.',
      '',
      'Console errors:',
      '- TypeError: x is not a function (http://localhost:5173/src/Cart.tsx:30)',
      '',
      'Failed requests:',
      '- POST http://localhost:5173/api/cart → 500',
      '- GET http://localhost:5173/logo.png → network error',
      '',
      'Find the cause in the project and fix it.'
    ].join('\n'))
    expect(formatPreviewProblems('http://localhost:3000/', { console: [], network: [{ method: 'GET', url: '/x', status: 404, type: 'fetch', ms: 1 }] }, '  only the 404  ')).toContain('User request:\nonly the 404')
  })

  test('the note for an agent that can see the preview names the two tools and nothing of the page', () => {
    const note = previewVerifyNote('http://localhost:5173/')
    expect(note).toContain('<oxespace-preview>')
    expect(note).toContain('http://localhost:5173/')
    expect(note).toContain('oxespace_capture_web_preview')
    expect(note).toContain('oxespace_preview_interact')
    expect(note.trimEnd().endsWith('</oxespace-preview>')).toBe(true)
  })
})
