# OXESpace

Agentic terminal workspace manager built with Electron, React, SQLite and real PTY-backed terminal panes.

## Development

```powershell
npm ci
npm run rebuild:native
npm run dev
```

## Verification

```powershell
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

The Playwright E2E smoke uses `OXESPACE_E2E_MOCK_NATIVE=1` to exercise Electron, preload and renderer flows without depending on local native module ABI.

## Windows Installer

```powershell
npm run rebuild:native
npm run build
npm run dist -- --win nsis
```

The installer is emitted under `dist/`. Native modules must be rebuilt against Electron before producing a runtime-ready installer.
