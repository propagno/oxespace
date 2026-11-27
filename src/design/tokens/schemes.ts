/**
 * Official kepano/obsidian-minimal color schemes:
 *   default, obsidian, flexoki, nord, catppuccin, dracula, gruvbox, solarized
 *
 * Each scheme synthesizes light + dark palettes (and True Black / Pure White
 * surface presets) calibrated to pass WCAG AA/AAA across every surface, fill,
 * focus ring, accent button, syntax token, and terminal ANSI color.
 */
import { contrast, oklchToHex } from './color'
import { generateScale, type Mode, type ScaleSpec } from './palette'
import { COLOR_SCHEMES, type ColorScheme } from './schemeIds'
import { surfaceColorRoles, type ColorRoles, type SurfaceStyle } from './semantic'

export { COLOR_SCHEMES, type ColorScheme }

interface SchemeTone {
  canvas: string
  chrome: string
  sunken: string
  raised: string
  overlay: string
  inverse: string
  borderSubtle: string
  borderDefault: string
  borderStrong: string
  borderControl: string
  fillHover: string
  fillPressed: string
  fillSelected: string
  fillSelectedStrong: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  textDisabled: string
  /** Optional dark terminal surface overrides (inherited in both modes so terminal matches scheme ink). */
  termBg?: string
  termFg?: string
  termLine?: string
}

interface SchemeDefinition {
  accent: ScaleSpec
  light?: { default: SchemeTone; pure?: Partial<SchemeTone> }
  dark?: { default: SchemeTone; pure?: Partial<SchemeTone> }
}

const SCHEMES: Record<Exclude<ColorScheme, 'default'>, SchemeDefinition> = {
  /** Obsidian default signature Violet accent on pure Minimal surfaces. */
  obsidian: {
    accent: { hue: 294, chroma: { light: 0.19, dark: 0.16 }, solid: { light: 0.49, dark: 0.74 } }
  },
  /** Flexoki by Steph Ango: warm paper (#FFFCF0) & deep ink (#100F0F) with teal accent. */
  flexoki: {
    accent: { hue: 184, chroma: 0.095, solid: { light: 0.48, dark: 0.72 } },
    light: {
      default: {
        canvas: '#fffcf0', chrome: '#f2f0e5', sunken: '#eae7db', raised: '#fffcf0', overlay: '#fffdf7', inverse: '#100f0f',
        borderSubtle: '#e6e4d9', borderDefault: '#cecdc3', borderStrong: '#b7b5ac', borderControl: '#878580',
        fillHover: '#efeade', fillPressed: '#e3dfd2', fillSelected: '#e9e5d8', fillSelectedStrong: '#dbd7c9',
        textPrimary: '#100f0f', textSecondary: '#4a4946', textMuted: '#55544f', textDisabled: '#878580'
      },
      pure: {
        canvas: '#ffffff', chrome: '#ffffff', sunken: '#f8f7f1', raised: '#ffffff', overlay: '#ffffff',
        borderSubtle: '#eceae1', borderDefault: '#dcd9ce', borderStrong: '#c5c2b6',
        fillHover: '#f4f2ea', fillPressed: '#e8e5da', fillSelected: '#eeece3', fillSelectedStrong: '#e0ddd1'
      }
    },
    dark: {
      default: {
        canvas: '#100f0f', chrome: '#1c1b1a', sunken: '#0a0909', raised: '#1e1d1c', overlay: '#282726', inverse: '#fffcf0',
        borderSubtle: '#282726', borderDefault: '#343331', borderStrong: '#403e3c', borderControl: '#6f6e69',
        fillHover: '#222120', fillPressed: '#2c2b29', fillSelected: '#262524', fillSelectedStrong: '#32312f',
        textPrimary: '#cecdc3', textSecondary: '#b1afa6', textMuted: '#9e9c93', textDisabled: '#6f6e69',
        termBg: '#100f0f', termFg: '#cecdc3', termLine: '#343331'
      },
      pure: {
        canvas: '#000000', chrome: '#000000', sunken: '#000000', raised: '#100f0f', overlay: '#1c1b1a',
        borderSubtle: '#222120', borderDefault: '#2f2e2c', borderStrong: '#403e3c',
        fillHover: '#191817', fillPressed: '#242322', fillSelected: '#1e1d1c', fillSelectedStrong: '#2a2927',
        termBg: '#000000', termLine: '#222120'
      }
    }
  },
  /** Nord: Arctic Snow Storm light & Polar Night dark with Frost Blue accent. */
  nord: {
    accent: { hue: 245, chroma: 0.09, solid: { light: 0.47, dark: 0.74 } },
    light: {
      default: {
        canvas: '#ffffff', chrome: '#eceff4', sunken: '#e5e9f0', raised: '#ffffff', overlay: '#ffffff', inverse: '#2e3440',
        borderSubtle: '#e5e9f0', borderDefault: '#d8dee9', borderStrong: '#c2cad8', borderControl: '#7d889c',
        fillHover: '#edf0f5', fillPressed: '#dfe5ee', fillSelected: '#e5e9f0', fillSelectedStrong: '#d5dde8',
        textPrimary: '#242933', textSecondary: '#465063', textMuted: '#505b70', textDisabled: '#8d97aa'
      },
      pure: {
        canvas: '#ffffff', chrome: '#ffffff', sunken: '#f5f7fa', raised: '#ffffff', overlay: '#ffffff',
        borderSubtle: '#e8ecf2', borderDefault: '#d8dee9', borderStrong: '#c2cad8',
        fillHover: '#f1f4f8', fillPressed: '#e5e9f0', fillSelected: '#eceff4', fillSelectedStrong: '#dce2ec'
      }
    },
    dark: {
      default: {
        canvas: '#2e3440', chrome: '#272c36', sunken: '#232831', raised: '#363d4b', overlay: '#3e4656', inverse: '#eceff4',
        borderSubtle: '#3b4252', borderDefault: '#434c5e', borderStrong: '#525e74', borderControl: '#8592aa',
        fillHover: '#353c4a', fillPressed: '#3d4555', fillSelected: '#394150', fillSelectedStrong: '#434c5e',
        textPrimary: '#eceff4', textSecondary: '#c7d0e0', textMuted: '#b5c0d4', textDisabled: '#7c889f',
        termBg: '#272c36', termFg: '#eceff4', termLine: '#434c5e'
      },
      pure: {
        canvas: '#000000', chrome: '#000000', sunken: '#000000', raised: '#13161d', overlay: '#1c202a',
        borderSubtle: '#242936', borderDefault: '#313847', borderStrong: '#434c5e',
        fillHover: '#191d26', fillPressed: '#232834', fillSelected: '#1e232e', fillSelectedStrong: '#2a303e',
        termBg: '#000000', termLine: '#242936'
      }
    }
  },
  /** Catppuccin: Latte light & Frappé dark with Mauve accent. */
  catppuccin: {
    accent: { hue: 306, chroma: { light: 0.18, dark: 0.125 }, solid: { light: 0.48, dark: 0.76 } },
    light: {
      default: {
        canvas: '#eff1f5', chrome: '#e6e9ef', sunken: '#dce0e8', raised: '#f7f8fb', overlay: '#ffffff', inverse: '#303446',
        borderSubtle: '#dce0e8', borderDefault: '#ccd0da', borderStrong: '#bcc0cc', borderControl: '#7c7f93',
        fillHover: '#e6e9f0', fillPressed: '#d8dce6', fillSelected: '#dfe3ec', fillSelectedStrong: '#cfd4e0',
        textPrimary: '#242638', textSecondary: '#464963', textMuted: '#4e526e', textDisabled: '#8c8fa1'
      },
      pure: {
        canvas: '#ffffff', chrome: '#ffffff', sunken: '#f5f6f9', raised: '#ffffff', overlay: '#ffffff',
        borderSubtle: '#e6e9ef', borderDefault: '#d5d9e2', borderStrong: '#bcc0cc',
        fillHover: '#f0f2f7', fillPressed: '#e3e6ee', fillSelected: '#ebedf4', fillSelectedStrong: '#dce0e8'
      }
    },
    dark: {
      default: {
        canvas: '#303446', chrome: '#292c3c', sunken: '#232634', raised: '#383d52', overlay: '#414559', inverse: '#eff1f5',
        borderSubtle: '#414559', borderDefault: '#51576d', borderStrong: '#626880', borderControl: '#8e95b0',
        fillHover: '#373c50', fillPressed: '#40455b', fillSelected: '#3b4054', fillSelectedStrong: '#464b62',
        textPrimary: '#e4ebff', textSecondary: '#c4cef0', textMuted: '#b6c1e5', textDisabled: '#838ba7',
        termBg: '#292c3c', termFg: '#e4ebff', termLine: '#51576d'
      },
      pure: {
        canvas: '#000000', chrome: '#000000', sunken: '#000000', raised: '#141620', overlay: '#1d202d',
        borderSubtle: '#262938', borderDefault: '#353a4e', borderStrong: '#494f68',
        fillHover: '#191c28', fillPressed: '#242838', fillSelected: '#1f2331', fillSelectedStrong: '#2c3144',
        termBg: '#000000', termLine: '#262938'
      }
    }
  },
  /** Dracula: crisp Alucard light & Dracula dark (#282A37) with Purple accent. */
  dracula: {
    accent: { hue: 298, chroma: { light: 0.175, dark: 0.145 }, solid: { light: 0.48, dark: 0.75 } },
    light: {
      default: {
        canvas: '#f8f8f2', chrome: '#ecece6', sunken: '#e2e2db', raised: '#fcfcf9', overlay: '#ffffff', inverse: '#282a37',
        borderSubtle: '#e0e0d8', borderDefault: '#cecec5', borderStrong: '#b8b8ae', borderControl: '#7a7a72',
        fillHover: '#ededE6'.toLowerCase(), fillPressed: '#dfdfd7', fillSelected: '#e5e5dd', fillSelectedStrong: '#d5d5cc',
        textPrimary: '#1f212c', textSecondary: '#474a5e', textMuted: '#505469', textDisabled: '#8c8e99'
      },
      pure: {
        canvas: '#ffffff', chrome: '#ffffff', sunken: '#f5f5f1', raised: '#ffffff', overlay: '#ffffff',
        borderSubtle: '#e8e8e2', borderDefault: '#d8d8d0', borderStrong: '#c0c0b7',
        fillHover: '#f2f2ed', fillPressed: '#e5e5de', fillSelected: '#ecece6', fillSelectedStrong: '#dfdfd7'
      }
    },
    dark: {
      default: {
        canvas: '#282a37', chrome: '#21222c', sunken: '#191a22', raised: '#303342', overlay: '#383b4d', inverse: '#f8f8f2',
        borderSubtle: '#383b4d', borderDefault: '#44475a', borderStrong: '#595d76', borderControl: '#868aa6',
        fillHover: '#313444', fillPressed: '#3a3d50', fillSelected: '#343748', fillSelectedStrong: '#404358',
        textPrimary: '#f8f8f2', textSecondary: '#c7cae0', textMuted: '#b5b9d4', textDisabled: '#7e83a1',
        termBg: '#21222c', termFg: '#f8f8f2', termLine: '#44475a'
      },
      pure: {
        canvas: '#000000', chrome: '#000000', sunken: '#000000', raised: '#12131a', overlay: '#1b1c26',
        borderSubtle: '#242634', borderDefault: '#333648', borderStrong: '#464960',
        fillHover: '#181a24', fillPressed: '#232533', fillSelected: '#1e202c', fillSelectedStrong: '#2a2d3d',
        termBg: '#000000', termLine: '#242634'
      }
    }
  },
  /** Gruvbox: warm parchment light (#FCF2C7) & retro charcoal dark (#282828) with terracotta accent. */
  gruvbox: {
    accent: { hue: 46, chroma: { light: 0.145, dark: 0.135 }, solid: { light: 0.5, dark: 0.74 } },
    light: {
      default: {
        canvas: '#fcf2c7', chrome: '#f2e6bd', sunken: '#e9dbb0', raised: '#fdf6d8', overlay: '#fffbeb', inverse: '#282828',
        borderSubtle: '#e5d5a7', borderDefault: '#d5c496', borderStrong: '#bda97a', borderControl: '#7d7055',
        fillHover: '#efe1b4', fillPressed: '#e3d3a1', fillSelected: '#e9dab0', fillSelectedStrong: '#d9c896',
        textPrimary: '#242220', textSecondary: '#4a433d', textMuted: '#534b44', textDisabled: '#8b8071'
      },
      pure: {
        canvas: '#ffffff', chrome: '#ffffff', sunken: '#faf6e8', raised: '#ffffff', overlay: '#ffffff',
        borderSubtle: '#ece5cf', borderDefault: '#ddd3b8', borderStrong: '#c5b899',
        fillHover: '#f5f0de', fillPressed: '#eae2ca', fillSelected: '#f0ead6', fillSelectedStrong: '#e3d9be'
      }
    },
    dark: {
      default: {
        canvas: '#282828', chrome: '#1e2021', sunken: '#171819', raised: '#32302f', overlay: '#3c3836', inverse: '#fcf2c7',
        borderSubtle: '#3c3836', borderDefault: '#504945', borderStrong: '#665c54', borderControl: '#928374',
        fillHover: '#32302e', fillPressed: '#3b3735', fillSelected: '#353230', fillSelectedStrong: '#423e3b',
        textPrimary: '#f2e5bc', textSecondary: '#cbbda0', textMuted: '#b8aa8e', textDisabled: '#8a7e6e',
        termBg: '#1e2021', termFg: '#f2e5bc', termLine: '#504945'
      },
      pure: {
        canvas: '#000000', chrome: '#000000', sunken: '#000000', raised: '#141312', overlay: '#1d1b1a',
        borderSubtle: '#262321', borderDefault: '#36322f', borderStrong: '#4c4642',
        fillHover: '#1a1817', fillPressed: '#252220', fillSelected: '#1f1d1b', fillSelectedStrong: '#2c2926',
        termBg: '#000000', termLine: '#262321'
      }
    }
  },
  /** Solarized by Ethan Schoonover: warm cream (#FDF6E3) & deep teal (#002B36) with Solarized Blue accent. */
  solarized: {
    accent: { hue: 242, chroma: 0.125, solid: { light: 0.49, dark: 0.74 } },
    light: {
      default: {
        canvas: '#fdf6e3', chrome: '#eee8d5', sunken: '#e5dec9', raised: '#fffaf0', overlay: '#fffdf7', inverse: '#002b36',
        borderSubtle: '#e4ddc8', borderDefault: '#d3cbb7', borderStrong: '#bdb49f', borderControl: '#777d78',
        fillHover: '#efe8d5', fillPressed: '#e3dbc5', fillSelected: '#e9e2ce', fillSelectedStrong: '#d9d1ba',
        textPrimary: '#072a33', textSecondary: '#3b5259', textMuted: '#475e64', textDisabled: '#839496'
      },
      pure: {
        canvas: '#ffffff', chrome: '#ffffff', sunken: '#f8f5ec', raised: '#ffffff', overlay: '#ffffff',
        borderSubtle: '#eae5d8', borderDefault: '#dbd5c5', borderStrong: '#c2bba9',
        fillHover: '#f4f0e4', fillPressed: '#e9e4d4', fillSelected: '#efeae0', fillSelectedStrong: '#e1dac7'
      }
    },
    dark: {
      default: {
        canvas: '#002b36', chrome: '#073642', sunken: '#00212b', raised: '#0a3f4d', overlay: '#0f4959', inverse: '#fdf6e3',
        borderSubtle: '#0f4654', borderDefault: '#1b5868', borderStrong: '#2d6e7f', borderControl: '#6c929c',
        fillHover: '#083a47', fillPressed: '#0e4554', fillSelected: '#0b404e', fillSelectedStrong: '#134e5e',
        textPrimary: '#f2ecd9', textSecondary: '#c4d2d4', textMuted: '#b3c4c7', textDisabled: '#6f8d94',
        termBg: '#002b36', termFg: '#f2ecd9', termLine: '#1b5868'
      },
      pure: {
        canvas: '#000000', chrome: '#000000', sunken: '#000000', raised: '#041a21', overlay: '#082730',
        borderSubtle: '#0c303b', borderDefault: '#174350', borderStrong: '#275968',
        fillHover: '#072028', fillPressed: '#0d2e38', fillSelected: '#0a2730', fillSelectedStrong: '#123844',
        termBg: '#000000', termLine: '#0c303b'
      }
    }
  }
}

/** Lightens or darkens an OKLCH neutral/hue hex until it hits the minimum contrast target on all backgrounds. */
function ensureContrast(hex: string, backgrounds: readonly string[], minRatio: number, mode: Mode, hue = 0, chroma = 0): string {
  if (backgrounds.every(bg => contrast(hex, bg) >= minRatio)) return hex
  // Walk OKLCH lightness away from the backgrounds until every background satisfies minRatio.
  let lo = mode === 'light' ? 0.18 : 0.62
  let hi = mode === 'light' ? 0.52 : 0.96
  let best = mode === 'light' ? oklchToHex({ l: lo, c: chroma, h: hue }) : oklchToHex({ l: hi, c: chroma, h: hue })
  for (let i = 0; i < 18; i += 1) {
    const mid = (lo + hi) / 2
    const candidate = oklchToHex({ l: mid, c: chroma, h: hue })
    const ok = backgrounds.every(bg => contrast(candidate, bg) >= minRatio)
    if (mode === 'light') {
      if (ok) { best = candidate; lo = mid } else { hi = mid }
    } else {
      if (ok) { best = candidate; hi = mid } else { lo = mid }
    }
  }
  return best
}

function resolveTone(def: SchemeDefinition, mode: Mode, surface: SurfaceStyle): SchemeTone | undefined {
  const entry = def[mode]
  if (!entry) return undefined
  if (surface === 'pure' && entry.pure) return { ...entry.default, ...entry.pure }
  return entry.default
}

/**
 * Full semantic color roles for any of the 8 official Obsidian Minimal color
 * schemes in light/dark mode and Default/Pure surface style.
 */
export function schemeColorRoles(scheme: ColorScheme, mode: Mode, surface: SurfaceStyle = 'default'): ColorRoles {
  const base = surfaceColorRoles(mode, surface)
  if (scheme === 'default') return base

  const def = SCHEMES[scheme]
  const roles: ColorRoles = { ...base }
  const light = mode === 'light'
  const pure = surface === 'pure'

  // 1. Apply scheme accent scale.
  const accentScale = generateScale(def.accent, mode)
  roles['accent'] = accentScale[8]
  roles['accent-hover'] = accentScale[9]
  roles['accent-soft'] = accentScale[2]
  roles['accent-soft-hover'] = accentScale[3]
  roles['accent-border'] = accentScale[6]
  roles['focus-ring'] = accentScale[8]
  roles['border-focus'] = accentScale[8]
  roles['text-accent'] = accentScale[10]
  roles['text-on-accent'] = light ? '#ffffff' : accentScale[0]
  roles['brand-mark'] = light ? accentScale[8] : accentScale[9]

  // 2. Apply scheme surface, fill, border, text & terminal tones (if distinct from Minimal default).
  const tone = resolveTone(def, mode, surface)
  if (tone) {
    roles['surface-canvas'] = tone.canvas
    roles['surface-base'] = tone.canvas
    roles['surface-chrome'] = tone.chrome
    roles['surface-sunken'] = tone.sunken
    roles['surface-raised'] = tone.raised
    roles['surface-overlay'] = tone.overlay
    roles['surface-inverse'] = tone.inverse
    roles['border-subtle'] = tone.borderSubtle
    roles['border-default'] = tone.borderDefault
    roles['border-strong'] = tone.borderStrong
    roles['border-control'] = tone.borderControl
    roles['fill-hover'] = tone.fillHover
    roles['fill-pressed'] = tone.fillPressed
    roles['fill-selected'] = tone.fillSelected
    roles['fill-selected-strong'] = tone.fillSelectedStrong
    roles['text-primary'] = tone.textPrimary
    roles['text-secondary'] = tone.textSecondary
    roles['text-muted'] = tone.textMuted
    roles['text-disabled'] = tone.textDisabled
    roles['syn-cm'] = tone.textMuted
    roles['syn-pun'] = tone.textSecondary
  }

  // Terminal inherits the scheme's dark ink canvas in both modes (and pure black in dark OLED).
  const darkTone = resolveTone(def, 'dark', !light && pure ? 'pure' : 'default')
  if (darkTone?.termBg) roles['term-bg'] = darkTone.termBg
  if (darkTone?.termFg) roles['term-fg'] = darkTone.termFg
  if (darkTone?.termLine) roles['term-line'] = darkTone.termLine

  // 3. Guarantee WCAG AA contrast for accent, link, syntax, ANSI & workspace tokens on tinted surfaces.
  const allSurfaces = [
    roles['surface-canvas'], roles['surface-base'], roles['surface-raised'],
    roles['surface-overlay'], roles['surface-chrome'], roles['surface-sunken']
  ]
  const accentTextTargets = [...allSurfaces, roles['accent-soft']]
  const accentChroma = typeof def.accent.chroma === 'number' ? def.accent.chroma : def.accent.chroma[mode]
  roles['text-accent'] = ensureContrast(roles['text-accent'], accentTextTargets, 4.5, mode, def.accent.hue, accentChroma * 0.78)
  roles['text-link'] = ensureContrast(roles['text-link'], allSurfaces, 4.5, mode, 242, 0.08)

  const focusTargets = [roles['surface-canvas'], roles['surface-base'], roles['surface-raised']]
  if (!focusTargets.every(bg => contrast(roles['accent'], bg) >= 3.0)) {
    const adjusted = ensureContrast(roles['accent'], focusTargets, 3.05, mode, def.accent.hue, accentChroma)
    roles['accent'] = adjusted
    roles['focus-ring'] = adjusted
    roles['border-focus'] = adjusted
  }

  // Ensure text-on-accent >= 4.5:1 on accent and accent-hover.
  if (contrast(roles['text-on-accent'], roles['accent']) < 4.5 || contrast(roles['text-on-accent'], roles['accent-hover']) < 4.5) {
    roles['text-on-accent'] = contrast('#ffffff', roles['accent']) >= contrast('#111111', roles['accent']) ? '#ffffff' : '#111111'
  }

  // Ensure ANSI & syntax colors keep >= 4.5:1 on tinted scheme canvases (e.g. Solarized, Gruvbox, Catppuccin).
  if (tone) {
    const syntaxBgs = [roles['surface-base'], roles['surface-sunken'], roles['surface-raised']]
    const ansiBgs = [roles['surface-base']]
    const syntaxHues: Record<string, [number, number]> = {
      'syn-kw': [292, 0.08], 'syn-str': [132, 0.08], 'syn-num': [354, 0.09],
      'syn-fn': [242, 0.08], 'syn-type': [184, 0.07], 'syn-key': [82, 0.08], 'syn-var': [82, 0.08]
    }
    for (const [key, [hue, chroma]] of Object.entries(syntaxHues)) {
      const targets = key === 'syn-var' ? [...syntaxBgs, roles['syn-var-bg']] : syntaxBgs
      roles[key] = ensureContrast(roles[key], targets, 4.5, mode, hue, chroma)
    }
    const ansiHues: Record<string, [number, number]> = {
      'ansi-red': [16, 0.11], 'ansi-bright-red': [16, 0.1],
      'ansi-green': [132, 0.11], 'ansi-bright-green': [132, 0.1],
      'ansi-yellow': [82, 0.11], 'ansi-bright-yellow': [82, 0.1],
      'ansi-blue': [242, 0.11], 'ansi-bright-blue': [242, 0.1],
      'ansi-magenta': [292, 0.11], 'ansi-bright-magenta': [292, 0.1],
      'ansi-cyan': [184, 0.11], 'ansi-bright-cyan': [184, 0.1],
      'ansi-white': [0, 0], 'ansi-bright-black': [0, 0]
    }
    for (const [key, [hue, chroma]] of Object.entries(ansiHues)) {
      roles[key] = ensureContrast(roles[key], ansiBgs, 4.5, mode, hue, chroma)
    }
    // Keep intent solids & attn visible (>= 3:1) and intent/attn fg readable (>= 4.5:1) on tinted surfaces.
    const intentMeta: Record<string, [number, number]> = {
      success: [132, 0.105], warning: [52, 0.125], danger: [16, 0.15], info: [242, 0.095]
    }
    for (const [name, [hue, chroma]] of Object.entries(intentMeta)) {
      roles[`intent-${name}-solid`] = ensureContrast(roles[`intent-${name}-solid`], focusTargets, 3.05, mode, hue, chroma)
      roles[`intent-${name}-fg`] = ensureContrast(roles[`intent-${name}-fg`], [roles[`intent-${name}-bg`], roles['surface-raised']], 4.5, mode, hue, chroma * 0.8)
    }
    roles['attn'] = ensureContrast(roles['attn'], allSurfaces, 3.05, mode, 82, 0.11)
    roles['attn-fg'] = ensureContrast(roles['attn-fg'], [roles['attn-bg'], roles['surface-raised']], 4.5, mode, 82, 0.09)
    // Workspace swatches & resource kind marks on tinted surfaces.
    const wsHues: Array<[number, number]> = [[184, 0.08], [265, 0.1], [242, 0.09], [112, 0.09], [292, 0.1], [322, 0.1], [354, 0.11], [0, 0]]
    wsHues.forEach(([hue, chroma], idx) => {
      const n = idx + 1
      roles[`ws-${n}`] = ensureContrast(roles[`ws-${n}`], [roles['surface-base']], 3.05, mode, hue, chroma)
      roles[`ws-${n}-fg`] = ensureContrast(roles[`ws-${n}-fg`], [roles['surface-base'], roles['fill-selected']], 4.55, mode, hue, chroma * 0.8)
    })
    const kindMeta: Record<string, [number, number]> = {
      file: [242, 0.095], db: [292, 0.105], box: [184, 0.085], net: [354, 0.115], shell: [0, 0]
    }
    for (const [name, [hue, chroma]] of Object.entries(kindMeta)) {
      roles[`k-${name}`] = ensureContrast(roles[`k-${name}`], [roles['surface-base']], 3.05, mode, hue, chroma)
      roles[`k-${name}-fg`] = ensureContrast(roles[`k-${name}-fg`], [roles[`k-${name}-bg`]], 4.5, mode, hue, chroma * 0.8)
    }
  }

  return roles
}

/**
 * Compact token diff for a non-default color scheme against `default`, used by
 * `css.ts` so `tokens.generated.css` stays lean.
 *
 * When `surface === 'pure'`, any key emitted in the `default` surface diff whose
 * value changes under `pure` is also included, guaranteeing pure surface rules
 * win cleanly in CSS cascade order.
 */
export function schemeTokenDiff(
  scheme: Exclude<ColorScheme, 'default'>,
  mode: Mode,
  surface: SurfaceStyle = 'default'
): Record<string, string> {
  const base = surfaceColorRoles(mode, surface)
  const target = schemeColorRoles(scheme, mode, surface)
  const defaultDiff = surface === 'pure' ? schemeTokenDiff(scheme, mode, 'default') : null
  const diff: Record<string, string> = {}
  for (const [key, value] of Object.entries(target)) {
    if (value !== base[key] || (defaultDiff && key in defaultDiff && value !== defaultDiff[key])) {
      diff[key] = value
    }
  }
  return diff
}
