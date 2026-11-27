/**
 * Official kepano/obsidian-minimal color schemes. Kept in a zero-dependency
 * module so runtime mode helpers (`src/design/mode.ts`) stay tiny in the
 * renderer boot entry while full palette synthesis lives in `schemes.ts`.
 */
export const COLOR_SCHEMES = [
  'default',
  'obsidian',
  'flexoki',
  'nord',
  'catppuccin',
  'dracula',
  'gruvbox',
  'solarized'
] as const

export type ColorScheme = (typeof COLOR_SCHEMES)[number]
