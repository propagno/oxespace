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

## Definition of done

A change is complete when TypeScript and ESLint pass, tests cover failure paths, coverage stays above configured thresholds, bundle budgets pass, the relevant native runtime is verified, and the smoke E2E covers important user behavior. Update architecture or security documentation whenever a boundary or invariant changes.
