# Mandacaru icons

Our own icons for the modes, Agora and History (T85, FIDELITY.md). Lucide stays for everything else.

## Rules

- **One module per icon.** `OxeCodeIcon.tsx`, `OxeChatIcon.tsx`, `OxeQueryIcon.tsx`, `OxePodIcon.tsx`,
  `OxePostIcon.tsx`, `AgoraIcon.tsx`, `HistoryIcon.tsx`. Each file exports exactly one component and stays under
  2.5 kB, so a screen pulls in only what it draws.
- **No barrel.** There is no `index.ts` that imports every icon and no shared `PATHS` map; import the module directly:
  `import { AgoraIcon } from '../design/icons/AgoraIcon'`.
- **currentColor.** Icons stroke with `currentColor`; color comes from the surrounding text and its tokens.
- **Hidden by default.** Without `title` the svg is `aria-hidden` (the button or label names it). With `title` it
  becomes `role="img"` with a `<title>`.
- **Grid.** 24 px viewBox, 2 px stroke, round caps and joins, the same as Lucide so they sit side by side.
  Drawn for this app, not copied from a set.

## Props

`SVGProps<SVGSVGElement> & { size?: number; title?: string }`. `size` sets width and height (default 24); any other
svg prop passes through and can override the defaults.

## Adding an icon

Copy one module, rename the file and the export to `<Name>Icon`, redraw the paths. The acceptance test
`tests/acceptance/f1/a9-icons-modules.test.ts` checks every `PascalCase.tsx` here.
