# Development guide

## Local verification

```powershell
npm ci
npm run typecheck
npm run lint
npm run test:electron
npm run build
npm run fix:native
npm run verify:native
npm run test:e2e
```

`better-sqlite3` is ABI-specific: it is built for Electron (NODE_MODULE_VERSION 125), while system Node is 127. `npm test` therefore fails every DB-backed test with a module-version error — which is easy to mistake for known noise, and once hid a real migration break until release CI caught it. `npm run test:electron` runs vitest through the Electron binary (`ELECTRON_RUN_AS_NODE=1`), so the ABI matches and the suite passes locally exactly as in CI; forward a path with `npm run test:electron -- tests/integration/foo.test.ts`.

CI takes the other route — it rebuilds for Node, runs `test:coverage`, then prepares the Electron binary for the packaged build and E2E. Locally you can still do that with `npm run rebuild:native:node` / `npm run rebuild:native:electron`, but prefer `test:electron`: switching runtimes replaces the native binary and the rebuild is slow and occasionally fails. `npm run native:doctor` reports the currently loadable Node modules and both runtime ABIs. A source rebuild on Windows requires the Visual Studio C++ workload and Windows SDK; CI/package flows prefer the pinned prebuilt Electron binary.

## Adding an IPC capability

1. Add request/result types to a focused file in `shared/types/` and expose the method through `OxeApi` and `IPC_CHANNELS`.
2. Implement the service without renderer dependencies. Enforce authorization and path/trust validation in the service, not just the UI.
3. Register a small adapter in `electron/main/ipc/` and expose it from `electron/preload/api.ts`.
4. Add safe fallback handlers used by native-failure and E2E modes when the UI can call the capability during startup.
5. Add service/contract integration tests and, for a user-visible critical flow, an E2E assertion.

Never expose generic `ipcRenderer.send`, a raw shell executor, database handles or unrestricted filesystem primitives to the renderer.

## Database changes

Create the next ordered migration; never edit an already released migration. Make migrations transactional where SQLite permits it, specify defaults for existing rows, and update repository/service queries and fixtures together. Validate upgrades from an existing database in addition to fresh creation.

## MCP changes

Treat command, arguments, environment and remote endpoints as executable configuration. Preserve the `enabled && trusted` synchronization invariant. Avoid logging environment values or bridge tokens. Any new internal MCP tool needs a bounded input schema, workspace authorization, deterministic errors and tests for rejection paths.

## UI and Web Preview

UI code should consume typed bridge methods and keep pure transformations in adjacent model modules. Remote preview access must remain a visible user choice; do not restore popup/download sandbox permissions or apply cross-origin response rewriting globally.

## Styling: two systems, one cascade

The renderer runs OXESpace's hand-written CSS (`src/styles/*.css`) alongside the
shadcn/Tailwind foundation (`src/styles/ui-kit.css`, `src/components/ui/`).

**Cascade.** Everything except `tokens.css` is imported into the `oxe-legacy`
cascade layer, ordered `oxe-reset → theme → base → oxe-legacy → components →
utilities`. A Tailwind utility therefore beats a legacy panel class, which is
what lets panels migrate one at a time. `tokens.css` stays unlayered so its
custom properties win everywhere, including all 11 `[data-theme]` palettes.

**Tokens.** shadcn's semantic tokens are namespaced `--sh-*` and bridged onto
OXESpace tokens, so primitives inherit the brand and follow theme switches.
Interactive tokens track `--accent` (which themes retheme), not `--brand`
(the fixed logo emerald). `tests/unit/token-bridge.test.ts` guards this — a
re-run of `npx shadcn add` would otherwise restore the stock gray defaults.

**When to reach for a primitive.** Use one when it brings *behaviour* that
hand-written CSS cannot: focus traps, Escape/outside-click, keyboard menus,
aria wiring. Do **not** convert working bespoke CSS to Tailwind utilities for
its own sake — measured on this codebase, expressing a one-off brand tint as
arbitrary values (`bg-[color-mix(...)]`, `text-[9.5px]`) emits a unique utility
per value and cost ~2 kB for two badges, enough to breach the CSS budget, while
the CSS rule it replaced was smaller and clearer. Utilities pay off on repeated
patterns, not on one-offs.

**Signature surfaces.** Panels whose look is richer than the stock shell (the
Tools hub, the settings and workspace wizards) use `<DialogContent unstyled>`:
Radix supplies the behaviour, the panel's own CSS supplies the appearance.
Such a surface must position itself and declare a `z-index` at least equal to
`LEGACY_MODAL_OVERLAY`'s — content renders after the overlay in the portal, so
a lower value hides the panel behind the blurred scrim.

## Definition of done

A change is complete when TypeScript and ESLint pass, tests cover failure paths, coverage stays above configured thresholds, bundle budgets pass, the relevant native runtime is verified, and the smoke E2E covers important user behavior. Update architecture or security documentation whenever a boundary or invariant changes.
