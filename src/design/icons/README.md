# Obsidian Minimal mode icons

Our own icons for the OXESpace modes, Agora and History (amended in OXE-469 on 27/11 to retire cactus, thorn, and sun-ray motifs in favor of clean Obsidian Minimal geometry while preserving only the monochrome Mandacaru Ramo logo). Lucide stays for everything else.

## Rules

- **One module per icon.** `OxeCodeIcon.tsx`, `OxeChatIcon.tsx`, `OxeQueryIcon.tsx`, `OxePodIcon.tsx`,
  `OxePostIcon.tsx`, `AgoraIcon.tsx`, `HistoryIcon.tsx`. Each file exports exactly one component and stays under
  2.5 kB, so a screen pulls in only what it draws.
- **No barrel.** There is no `index.ts` that imports every icon and no shared `PATHS` map; import the module directly:
  `import { AgoraIcon } from '../design/icons/AgoraIcon'`.
- **currentColor.** Icons stroke (and, where a shape is solid, fill) with `currentColor`; color comes from the
  surrounding text and its tokens.
- **Hidden by default.** Without `title` the svg is `aria-hidden` (the button or label names it). With `title` it
  becomes `role="img"` with a `<title>`.
- **Grid.** 24 px viewBox, 2 px stroke, round caps and joins, matching Lucide so they sit side by side. No size
  variants: `size` scales the one drawing.

## Contract fixture

`tests/acceptance/f1/fixtures/mandacaru-icons.json` stores the canonical SVG shapes for each mode icon, and
`tests/acceptance/f1/cr02-icons-approved-drawings.test.tsx` compares every icon to it shape by shape. History remains
the horizontal time scrubber (a track, ticks, and a handle), not a clock.

## Props

`SVGProps<SVGSVGElement> & { size?: number; title?: string }`. `size` sets width and height (default 24); any other
svg prop passes through and can override the defaults.

## Adding an icon

Copy one module, rename the file and the export to `<Name>Icon`, draw clean 24 px Minimal shapes, and add them to the
fixture. `tests/acceptance/f1/a9-icons-modules.test.ts` checks every `PascalCase.tsx` here.
