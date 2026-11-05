# Mandacaru icons

Our own icons for the modes, Agora and History (T85, FIDELITY.md). Lucide stays for everything else.

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
- **Grid.** 24 px viewBox, 2 px stroke, round caps and joins, the same as Lucide so they sit side by side. No size
  variants: `size` scales the one drawing.

## The drawings are the approved ones

The shapes are ported verbatim from the playground (`playground/src/components/icons.ts`, #577 @ 718ddfcf), approved
by the user on 04/11. The copy kept for the check is `tests/acceptance/f1/fixtures/mandacaru-icons.json`, and
`tests/acceptance/f1/cr02-icons-approved-drawings.test.tsx` compares every icon to it shape by shape. Only the stroke
width differs (playground 1.75, app 2). History is the time scrubber (a track, ticks and a handle), not a clock.

Do not redraw an icon here. A new drawing goes through DESIGN review in the playground first, then the fixture and
the module change together.

## Props

`SVGProps<SVGSVGElement> & { size?: number; title?: string }`. `size` sets width and height (default 24); any other
svg prop passes through and can override the defaults.

## Adding an icon

Once the drawing is approved: copy one module, rename the file and the export to `<Name>Icon`, paste the approved
shapes, and add them to the fixture. `tests/acceptance/f1/a9-icons-modules.test.ts` checks every `PascalCase.tsx` here.
