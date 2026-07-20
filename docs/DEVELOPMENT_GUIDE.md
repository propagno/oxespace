# Development guide

## Local verification

```powershell
npm ci
npm run typecheck
npm run lint
npm run rebuild:native:node
npm run test:coverage
npm run build
npm run fix:native
npm run verify:native
npm run test:e2e
```

`better-sqlite3` is ABI-specific. Integration tests run under Node, while the application and E2E run under Electron. Switching runtimes can replace the native binary, so always rebuild for Node before tests and prepare/verify the Electron binary before launching the app. `npm run native:doctor` reports the currently loadable Node modules and both runtime ABIs. A source rebuild on Windows requires the Visual Studio C++ workload and Windows SDK; CI/package flows prefer the pinned prebuilt Electron binary.

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
