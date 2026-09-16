# Web Preview: MCP interaction and capture failures

## Verified causes

The evidence supplied on 2026-09-15 showed that opening the panel worked while
`oxespace_preview_interact` reported `Documentation service unavailable` and
`oxespace_capture_web_preview` reported `require is not defined`.

These correspond to two independent defects in the current source:

- Bootstrap supplies the lazy documentation runtime to the local RPC server,
  but the per-request ToolContext omitted that dependency. Direct handler tests
  supplied it themselves and therefore missed the broken transport wiring.
- Legacy capture called CommonJS `require('electron')` in the ESM main process.
  It now uses a supported dynamic import.

## Scope and regression coverage

The RPC context now forwards the existing lazy runtime. No access checks or
native interaction consent were removed. Documentation remains independent of
AI Memory. The change does not add credential extraction or bypass login/OTP.

- `mcp-internal.local-rpc.test.ts` calls inspect through authenticated HTTP RPC
  with a fixture runtime, proving the dependency reaches the tool handler.
- `documentation-tools.test.ts` retains workspace/execution authorization checks.
- `documentation-preview.spec.ts` exercises real Electron guest inspection,
  filling, clicking and capture on a local fixture. It additionally bundles the
  legacy capture handler as ESM, matching production rather than hiding CommonJS
  incompatibility in a CJS test harness.

The enterprise site's OTP behavior is not established by these photos alone and
is not claimed fixed by this patch. Installed copies need an updated build and
application restart to receive the changes.

The release benchmark also records explicit Linux CI budgets for the two full
modal mounts (750 ms); the general interaction budget remains 500 ms.

## Validation on Windows

14 focused RPC/authorization tests passed. The real Electron preview E2E passed,
including legacy capture through the ESM tool registry. Typecheck, targeted lint
and production build/bundle budgets passed. Linux and the enterprise OTP flow
were not tested in this patch.
