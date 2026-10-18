#!/usr/bin/env node
/**
 * Redesign helper: replaces color literals in legacy stylesheets with design
 * tokens, choosing the role from the CSS property (text, fill, border) and
 * from the literal's hue and lightness. Shadows keep their literal ink.
 *
 *   node scripts/design-literals.mjs [--write] [paths…]
 *
 * Without --write it prints what it would change. Review the visual audit in
 * both modes after writing; the mapping is a heuristic, not a proof.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const write = args.includes('--write')
const targets = args.filter(arg => !arg.startsWith('--'))
// OxeQuery is owned by another workstream; it is converted together with it.
const SKIP = [/OxeQuery/, /tokens(\.generated)?\.css$/, /\.module\.css$/]

function files(path) {
  if (statSync(path).isDirectory()) return readdirSync(path).flatMap(name => files(join(path, name)))
  return path.endsWith('.css') && !SKIP.some(pattern => pattern.test(path)) ? [path] : []
}

function parseColor(text) {
  let match = text.match(/^#([0-9a-f]{3,8})$/i)
  if (match) {
    let hex = match[1]
    if (hex.length <= 4) hex = hex.split('').map(char => char + char).join('')
    const n = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16))
    const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
    return { r: n[0], g: n[1], b: n[2], a: alpha }
  }
  match = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i)
  if (match) {
    const alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4])
    return { r: +match[1], g: +match[2], b: +match[3], a: alpha }
  }
  return null
}

function hsl({ r, g, b }) {
  const [R, G, B] = [r, g, b].map(value => value / 255)
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === R ? ((G - B) / d + (G < B ? 6 : 0)) * 60 : max === G ? ((B - R) / d + 2) * 60 : ((R - G) / d + 4) * 60
  return { h, s, l }
}

function family(color) {
  const { h, l } = hsl(color)
  // Chroma, not saturation: very dark or very light tints read as neutral surfaces and text.
  const chroma = (Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b)) / 255
  if (chroma < 0.16 || (l > 0.85 && chroma < 0.3) || l < 0.12) return 'neutral'
  if (h >= 330 || h < 15) return 'danger'
  if (h < 52) return 'warning'
  if (h < 70) return 'warning'
  if (h < 160) return 'success'
  // Teal and cyan were the previous brand color.
  if (h < 195) return 'accent'
  if (h < 255) return 'info'
  if (h < 300) return 'accent'
  return 'danger'
}

const pct = alpha => `${Math.round(alpha * 100)}%`

function replacement(color, property, onSolid, context = {}) {
  const kind = /^(color|fill|caret-color|-webkit-text-fill-color|text-decoration-color|outline-color|stroke)$/.test(property) ? 'text'
    : /border|outline|column-rule/.test(property) ? 'border' : 'fill'
  const fam = family(color)
  const { l } = hsl(color)
  if (fam === 'neutral') {
    if (color.a < 1) {
      // Translucent white or black: a tint of the text or of the canvas, so it follows the mode.
      const base = l > 0.5 ? 'var(--text-primary)' : 'var(--surface-sunken)'
      if (kind === 'text') return l > 0.5 ? (color.a > 0.75 ? 'var(--text-primary)' : color.a > 0.5 ? 'var(--text-secondary)' : 'var(--text-muted)') : 'var(--text-muted)'
      return `color-mix(in srgb, ${base} ${pct(color.a)}, transparent)`
    }
    // White text on a colored fill is a label on that fill, not body text.
    if (kind === 'text' && l > 0.85 && onSolid) return onSolid
    if (kind === 'text') return l > 0.85 ? 'var(--text-primary)' : l > 0.65 ? 'var(--text-secondary)' : l > 0.4 ? 'var(--text-muted)' : 'var(--text-on-accent)'
    if (kind === 'border') return l > 0.5 ? 'var(--border-strong)' : 'var(--border-default)'
    // A white fill under dark text was the old inverted primary button; anything else is a raised surface.
    if (l > 0.9) return context.darkText ? (context.hover ? 'var(--accent-hover)' : 'var(--accent)') : 'var(--surface-raised)'
    return l < 0.06 ? 'var(--surface-sunken)' : l < 0.11 ? 'var(--surface-canvas)' : l < 0.16 ? 'var(--surface-base)' : l < 0.22 ? 'var(--surface-raised)' : 'var(--surface-overlay)'
  }
  const role = fam === 'accent' ? { fg: 'var(--text-accent)', bg: 'var(--accent-soft)', solid: 'var(--accent)', border: 'var(--accent-border)' }
    : { fg: `var(--intent-${fam}-fg)`, bg: `var(--intent-${fam}-bg)`, solid: `var(--intent-${fam}-solid)`, border: `var(--intent-${fam}-border)` }
  if (kind === 'text') return role.fg
  if (kind === 'border') return color.a < 0.6 ? role.border : role.solid
  if (color.a < 0.35) return role.bg
  return color.a < 1 ? `color-mix(in srgb, ${role.solid} ${pct(color.a)}, transparent)` : role.solid
}

const LITERAL = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi
let changed = 0
const report = []
for (const path of (targets.length ? targets : ['src']).flatMap(target => files(join(ROOT, target)))) {
  const text = readFileSync(path, 'utf8')
  const next = text.replace(/([^{}]*)(\{[^{}]*\})/g, (whole, selector, block) => {
  // What the rule's own background is, so a white label on it gets the matching label color.
  const background = block.match(/background(?:-color)?\s*:\s*([^;}]+)/i)?.[1] ?? ''
  const bgColor = parseColor((background.match(LITERAL) ?? [''])[0])
  // Initials and logo letters sit on identity colors set inline.
  const onSolid = /letter|avatar|initial|monogram/i.test(selector) ? 'var(--text-on-identity)'
    : /var\(--(accent|brand)\b/.test(background) || (bgColor && bgColor.a >= 0.6 && family(bgColor) === 'accent') ? 'var(--text-on-accent)'
    : /var\(--(dot-|intent-)/.test(background) || (bgColor && bgColor.a >= 0.6 && family(bgColor) !== 'neutral') ? 'var(--text-on-solid)' : ''
  const textColor = parseColor((block.match(/(?:^|[;{\s])color\s*:\s*([^;}]+)/i)?.[1]?.match(LITERAL) ?? [''])[0])
  const darkText = Boolean(textColor && hsl(textColor).l < 0.3)
  return selector + block.replace(/([a-z-]+)\s*:\s*([^;{}]+)(;|(?=}))/gi, (declaration, property, value, end) => {
    const prop = property.toLowerCase()
    if (prop.startsWith('--')) return declaration
    // Shadows and filters keep their ink; they read in both modes.
    if (/shadow|filter|mask/.test(prop)) return declaration
    let touched = false
    const newValue = value.replace(LITERAL, literal => {
      const color = parseColor(literal)
      if (!color) return literal
      // Pure transparent stays transparent.
      if (color.a === 0) return 'transparent'
      // Scrims behind dialogs.
      if (prop.startsWith('background') && color.r + color.g + color.b < 40 && color.a >= 0.4 && color.a < 1) { touched = true; return 'var(--scrim)' }
      touched = true
      return replacement(color, prop, onSolid, { darkText, hover: /:hover/.test(selector) })
    })
    if (!touched) return declaration
    changed++
    report.push(`${relative(ROOT, path)}: ${prop}: ${value.trim()}  →  ${newValue.trim()}`)
    return `${property}: ${newValue}${end}`
  })
  })
  if (write && next !== text) writeFileSync(path, next)
}
console.log(report.join('\n'))
console.log(`\n[design-literals] ${changed} declarations ${write ? 'rewritten' : 'would change'}`)
