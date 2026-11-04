// Frozen acceptance test for CR-02 (OXE phase F1, A9, from the DESIGN review of #606). The executor must not edit it.
// Each Mandacaru icon draws exactly the approved shapes from the playground (fixtures/mandacaru-icons.json, copied from
// playground/src/components/icons.ts at #577 @ 718ddfcf), on the same 24 px grid. Stroke width may differ (1.75 → 2).
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ComponentType } from 'react'
import { describe, expect, test } from 'vitest'
import { AgoraIcon } from '../../../src/design/icons/AgoraIcon'
import { HistoryIcon } from '../../../src/design/icons/HistoryIcon'
import { OxeChatIcon } from '../../../src/design/icons/OxeChatIcon'
import { OxeCodeIcon } from '../../../src/design/icons/OxeCodeIcon'
import { OxePodIcon } from '../../../src/design/icons/OxePodIcon'
import { OxePostIcon } from '../../../src/design/icons/OxePostIcon'
import { OxeQueryIcon } from '../../../src/design/icons/OxeQueryIcon'

const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'mandacaru-icons.json'), 'utf8')) as { icons: Record<string, string> }
const SHAPE_ATTRS = ['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'fill']

/** The drawn shapes of an SVG fragment, as comparable strings (tag + geometry attributes), in order. */
function shapes(root: Element): string[] {
  return [...root.querySelectorAll('path, circle, ellipse, rect, line, polyline, polygon')].map(el => {
    const attrs = SHAPE_ATTRS.filter(name => el.hasAttribute(name)).map(name => `${name}=${(el.getAttribute(name) ?? '').replace(/\s+/g, ' ').trim()}`)
    return `${el.tagName.toLowerCase()}(${attrs.join(';')})`
  })
}

const ICONS: Record<string, ComponentType<{ size?: number }>> = { OxeCodeIcon, OxeChatIcon, OxeQueryIcon, OxePodIcon, OxePostIcon, AgoraIcon, HistoryIcon }

describe('CR-02 · the icons are the approved Mandacaru drawings', () => {
  test.each(Object.keys(ICONS))('%s draws the approved shapes on the 24 px grid', name => {
    const Icon = ICONS[name]
    const { container } = render(<Icon />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    const approved = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    approved.innerHTML = fixture.icons[name]
    expect(shapes(svg)).toEqual(shapes(approved))
  })

  test('History is the time scrubber, not a clock', () => {
    const { container } = render(<HistoryIcon />)
    expect(container.querySelector('circle[r="9"]')).toBeNull()
    expect(container.querySelector('path[d="M3 12h18"]')).not.toBeNull()
  })
})
