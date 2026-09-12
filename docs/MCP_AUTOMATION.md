# MCP automation: first increment

The following read-only tools require a live OXESpace execution and an empty object:

- `oxespace_capabilities`: actual registered tool names, effective delegation opt-in,
  execution role, active delegation count, limit and reason creation is unavailable.
  Tool discovery is not permission to execute every tool; handlers recheck policy.
- `oxespace_execution_context`: bound workspace/pane/execution, launch cwd, agent
  profile, origin pane, locally hashed project identity and sampled Git branch/HEAD.
  The identity hash is not AI Memory's project UUID. Shell cwd after `cd` is unknown.
- `oxespace_memory_diagnostics`: run binding, project memory settings, runtime health,
  last admitted hook metadata and successful provider calls through MemoryManager.

New replies have `schemaVersion: 1`, requestId, status and data/error. Authorization
failures never include credentials. Missing optional services return partial results.
Errors include a stable code, message and retryable flag. Existing tools retain
their current reply format.

Hook timestamps live for the execution lifetime; provider observations are bounded
to 512 projects and live for the application lifetime. They are metadata only.
Write/read timestamps cover classified MCP operations; they do not measure all
native hook writes or all provider consumers. Runtime health checks are not writes.
Spool, native persistence and consolidation are explicitly `not_observable`.
No upstream AI Memory API or private spool-file format was introduced.

Example agent instruction:

> Call oxespace_capabilities and oxespace_execution_context before automating work.
> If memory continuity is uncertain, inspect oxespace_memory_diagnostics. Do not
> infer successful capture from runtime readiness or hook receipt alone.

Remaining increments are tracked in MCP_AUTOMATION_PLAN.md: durable operation
journal, events, structured handoff, dependencies/claims and terminal/layout control.
