/**
 * C3 · Messages from the main process.
 *
 * The main process never returns interface sentences across IPC. It returns a `MessageCode` with its parameters, and the
 * window turns that into words with the `main` catalog (`shared/locales/<language>/main.json`, under `messages.<code>`).
 * The catalog keys belong to the FRONTEND; adding or renaming a code is a contract change.
 *
 * Native dialogs are the one exception: the main process shows them itself, so it translates with `tMain`.
 */

/** Every code the main process may send, with the parameters each one carries. Add codes; never repurpose one. */
export interface MessageParams {
  /** MCP quarantine: tools whose description or inputs changed after the person trusted the server. */
  'mcp.quarantine.changed': { tools: string[] }
  /** MCP quarantine: tools the server added after it was trusted. */
  'mcp.quarantine.added': { tools: string[] }
  /** MCP quarantine: tools the server removed after it was trusted. */
  'mcp.quarantine.removed': { tools: string[] }
  /** MCP quarantine: the server's command, arguments, environment or URL no longer match what was trusted. */
  'mcp.quarantine.configChanged': Record<string, never>
  /** A pending request was answered, cancelled or expired before this answer arrived. */
  'thread.request.notPending': Record<string, never>
  /** The conversation restarted since the request was listed; the answer belongs to an older generation. */
  'thread.request.staleGeneration': Record<string, never>
  /** Another answer to the same request is being delivered (a second window or device). */
  'thread.request.alreadyResponding': Record<string, never>
  /** A question was answered without an answer for every required question. */
  'thread.request.unanswered': Record<string, never>
  /** A guarded request (agent instructions, MCP settings, hooks) was answered "for the session": it is approved once or declined. */
  'thread.request.guardedDecision': Record<string, never>
  /** Why a change needs the person each time; `path` is the file as the request names it. */
  'thread.protectedConfig.instructions': { path: string }
  'thread.protectedConfig.mcp': { path: string }
  'thread.protectedConfig.hooks': { path: string }
  'thread.protectedConfig.warning': Record<string, never>
  /** B16: `command` rewrites tracked files without naming them (git checkout, tar x…), so it needs the person each time. */
  'thread.protectedConfig.rewritesTracked': { command: string }
  /** The system reports no network interface with a route. */
  'app.connectivity.offline': Record<string, never>
  /** B12: the IPC sender guard refused a call from a sender other than the app window's main frame. */
  'ipc.sender.refused': Record<string, never>
  /** The provider cannot fork its session into a side chat (B1.2). */
  'thread.side.unavailable': Record<string, never>
  /** The conversation has no native session to copy yet: send a message first. */
  'thread.side.noSession': Record<string, never>
  /** B13: OxeChat starts agents only from a native executable; any other .cmd/.ps1/.bat is refused. */
  'thread.agent.scriptUnsupported': Record<string, never>
  /** B13: a `codex.cmd` npm install whose native `codex.exe` is missing (it is never run through the app as Node). */
  'thread.agent.nativeMissing': Record<string, never>
  /** F30 · Refusals of the activity center's calls (ACTIVITY_REFUSALS); a refused call stores nothing. */
  'activity.invalid': Record<string, never>
  'activity.tooMany': { max: number }
  'activity.titleTooLong': { max: number }
  'activity.detailTooLong': { max: number }
  'activity.hiddenCharacters': Record<string, never>
  /** A time more than a minute ahead of the computer's clock. */
  'activity.future': Record<string, never>
  /** An entry's text looks like a password, token or key; the whole call is refused, nothing is stored. */
  'activity.secret': Record<string, never>
  /** F13 · Refusals of a sections save (THREAD_SECTIONS_REFUSALS); a refused save stores nothing. */
  'thread.sections.invalid': Record<string, never>
  'thread.sections.tooMany': { sections: number; assignments: number }
  'thread.sections.nameEmpty': Record<string, never>
  'thread.sections.nameTooLong': { max: number }
  'thread.sections.nameHidden': Record<string, never>
  /** `name` is the second section's name, trimmed, as the person typed it. */
  'thread.sections.nameDuplicate': { name: string }
  'thread.sections.unknownWorkspace': Record<string, never>
  /** B17 · Why a pane's recorded agent session was not resumed on its first start (PaneAgentResume `notResumed`). */
  'agents.resume.sessionMissing': Record<string, never>
  'agents.resume.otherAgent': Record<string, never>
  'agents.resume.launchOverride': Record<string, never>
  'agents.resume.blocked': Record<string, never>
  'agents.resume.disabled': Record<string, never>
  /** The person restarted the pane without its session (terminal.restart with `resume: false`). */
  'agents.resume.startedFresh': Record<string, never>
  /** The resumed agent exited at once: its session would not load, so the pane started fresh and forgot it. */
  'agents.resume.failedToLoad': Record<string, never>
  /** B17 · Terminal details: the pane runs Claude Code or Codex, but no session was reported yet. */
  'agents.session.notFound': Record<string, never>
  /** Diagnostics journal (B8.3): one kind of incident. */
  'incident.window.crashed': Record<string, never>
  'incident.window.rendererGone': Record<string, never>
  'incident.ipc.handlerFailed': Record<string, never>
  'incident.ipc.validationRejected': Record<string, never>
  'incident.ipc.senderRefused': Record<string, never>
  'incident.agent.startFailed': Record<string, never>
  'incident.mcp.quarantined': Record<string, never>
  'incident.mcp.toolGroupOff': Record<string, never>
  'incident.database.busy': Record<string, never>
  'incident.oxequery.timeout': Record<string, never>
  /** The OxeQuery worker stopped answering, and its restart was put off because a person session has a transaction open or a command running (B14). */
  'incident.oxequery.restartDeferred': Record<string, never>
  'incident.updater.failed': Record<string, never>
  'incident.interaction.overBudget': Record<string, never>
  'incident.app.journalReset': Record<string, never>
  /** F26: the window gave no first answer to a close or quit within 3 s; main went ahead. */
  'incident.app.closeUnanswered': Record<string, never>
  /** F26: the window's renderer went away while a close or quit was waiting on it; main went ahead. */
  'incident.app.closeRendererGone': Record<string, never>
  /** F26: the close guard hit an error or an inconsistent state; the close or quit went ahead unasked. */
  'incident.app.closeGuardFailed': Record<string, never>
  /** A link the main window tried to open outside the app was refused (its reason is the incident's subject). */
  'incident.window.externalRefused': Record<string, never>
  'incident.window.externalRateLimited': Record<string, never>
  /** The system refused to open a link the app allowed (no mail app or browser registered for it). */
  'incident.window.externalOpenFailed': Record<string, never>
  /** The main window called window.open; it opens nothing by itself (links leave through app:open-external). */
  'incident.window.openDenied': Record<string, never>
  /** The main window tried to navigate or redirect away from the app; it was kept in place and nothing was opened. */
  'incident.window.navigationDenied': Record<string, never>
  /** Diagnostics bundle (B8.3): one of its files is over the per-file cap; nothing was saved. */
  'diagnostics.bundle.fileTooLarge': Record<string, never>
  /** Diagnostics bundle (B8.3): the whole archive is over its cap; nothing was saved. */
  'diagnostics.bundle.tooLarge': Record<string, never>
  /** What each file of the diagnostics bundle holds (B8.3 preview). */
  'bundle.file.snapshot': Record<string, never>
  'bundle.file.incidents': Record<string, never>
  'bundle.file.logTail': Record<string, never>
  'bundle.file.runtime': Record<string, never>
  'bundle.file.versions': Record<string, never>
  'bundle.file.configuration': Record<string, never>
  // Main-process sentences the window used to receive ready-made in English (C3 sweep).
  'linear.worktree.exists': { issue: string; path: string }
  'worktree.cleanup.notRemovable': Record<string, never>
  'worktree.cleanup.blocked': { reasons: string[] }
  'worktree.cleanup.needsConfirmation': { reasons: string[] }
  'mcp.signIn.waiting': Record<string, never>
  'mcp.server.quarantined': Record<string, never>
  'mcp.server.untrusted': Record<string, never>
  /** Settings › Tools (F10): the folder is neither a Code workspace nor an OxeChat project, so its tool groups are not OXESpace's to read or change. */
  'mcp.toolGroups.unknownProject': Record<string, never>
  /** Settings › Tools: the project's oxe.yaml is not valid YAML; it is left as it is until fixed by hand. */
  'mcp.toolGroups.invalidYaml': Record<string, never>
  /** Settings › Tools: oxe.yaml is valid YAML but not a mapping of settings. */
  'mcp.toolGroups.notMapping': Record<string, never>
  /** Settings › Tools: `thread` in oxe.yaml is written inline (`thread: { … }`), which this editor does not rewrite. */
  'mcp.toolGroups.inlineThread': Record<string, never>
  /** Settings › Tools: the edit would have changed more than `thread.tools` (anchors, aliases, an unusual layout), so nothing was written. */
  'mcp.toolGroups.unsafeEdit': Record<string, never>
  /** A project file changed on disk after OXESpace read it (another editor, a git checkout); nothing was written. */
  'project.file.changedMeanwhile': { file: string }
  'github.cli.missing': Record<string, never>
  'git.base.unresolved': { base: string }
  'git.base.maybeStale': { branch: string }
  'git.fetch.needsPerson': Record<string, never>
  'git.person.refused': { keys: string[] }
  'git.hooks.skipped': Record<string, never>
  'oxe.status.unreadable': Record<string, never>
  'oxe.dashboard.timeout': Record<string, never>
  'memory.disabled': Record<string, never>
  'memory.unavailable': Record<string, never>
  'memory.runtimeUnavailable': Record<string, never>
  'thread.commands.configure': Record<string, never>
  'thread.commands.busy': Record<string, never>
  'thread.commands.claudeFailed': Record<string, never>
  'thread.commands.codexFailed': Record<string, never>
  'thread.capability.readOnly': Record<string, never>
  'thread.capability.mcpReadOnly': Record<string, never>
  'thread.observe.unsupported': Record<string, never>
  'thread.observe.changed': Record<string, never>
  'thread.queue.deliveryUnconfirmed': Record<string, never>
  'oxequery.edit.readOnly': Record<string, never>
  'oxequery.edit.notTable': Record<string, never>
  'oxequery.edit.noKey': Record<string, never>
  'oxequery.test.connected': Record<string, never>
  'oxequery.startFailed': { reason: string }
  /** SQL risk: `COPY … TO/FROM PROGRAM` runs a shell command on the database server. */
  'oxequery.sql.copyProgram': Record<string, never>
  /** SQL risk: a `DO` block runs code whose effect is not known before it runs. */
  'oxequery.sql.doBlock': Record<string, never>
  /** SQL risk: `CALL` runs a stored procedure whose effect is not known before it runs. */
  'oxequery.sql.callProcedure': Record<string, never>
  /** SQL risk: a `DO` or `CALL` carries a destructive keyword (DROP, TRUNCATE, DELETE, …) in its body or arguments. */
  'oxequery.sql.destructiveInside': { statement: string; keyword: string }
  /** SQL risk: `SELECT … FOR UPDATE / FOR SHARE` locks the rows it reads. */
  'oxequery.sql.rowLock': Record<string, never>
  /** SQL risk: `SET ROLE` / `SET SESSION AUTHORIZATION` changes the session user. */
  'oxequery.sql.sessionRole': Record<string, never>
  /** SQL risk: `VACUUM FULL` locks the whole table while it runs. */
  'oxequery.sql.tableLock': Record<string, never>
  /** A session with a transaction open or a command running is never closed to reopen it with new settings. */
  'oxequery.session.busy': Record<string, never>
  /** One connection already holds the most database connections it may hold for one role (the person or an agent). */
  'oxequery.session.limit': { limit: number }
  /** An agent sent BEGIN: an agent's session never keeps a transaction, so it was rolled back and refused. */
  'oxequery.session.agentTransaction': Record<string, never>
  /** Mongo write (B15): a change on a production connection waits for the connection's name, typed. */
  'oxequery.mongo.confirmName': Record<string, never>
  /** Mongo write: a change that needs the person's confirmation (a delete). */
  'oxequery.mongo.confirm': Record<string, never>
  /** Mongo write reason: the connection is a production one. */
  'oxequery.mongo.production': Record<string, never>
  /** Mongo write reason: the document will be deleted. */
  'oxequery.mongo.deletes': Record<string, never>
  /** SQL risk: a backslash in an ordinary string can end it early on a legacy server, so more runs than the text shows. */
  'oxequery.sql.ambiguousEscape': Record<string, never>
  'oxepod.startFailed': { reason: string }
  'oxepost.network.notFound': Record<string, never>
  'oxepost.network.refused': Record<string, never>
  'oxepost.network.reset': Record<string, never>
  'oxepost.network.timedOut': Record<string, never>
  'oxepost.network.lookupFailed': Record<string, never>
  'oxepost.network.hostUnreachable': Record<string, never>
  'oxepost.network.networkUnreachable': Record<string, never>
  'oxepost.send.invalidUrl': Record<string, never>
  'oxepost.send.scheme': Record<string, never>
  'oxepost.send.bodyNotAllowed': { method: string }
  'oxepost.send.bodyTooLarge': Record<string, never>
  'oxepost.send.invalidHeader': { name: string }
  'oxepost.send.timeout': { seconds: number }
  'oxepost.send.tls': { code: string }
  'oxepost.send.failed': Record<string, never>
  'oxepost.send.failedWith': { detail: string }
  /** The person picked a port below 1024 for the remote gateway. */
  'remote.port.privileged': { port: number }
  /** Another program already listens on the gateway's port. */
  'remote.port.inUse': { port: number }
  /** No private network interface (RFC 1918, link-local, ULA) to listen on. */
  'remote.network.noPrivateInterface': Record<string, never>
  /** The gateway's certificate could not be made or read back from secure storage. */
  'remote.certificate.failed': Record<string, never>
  /** A workspace root that is not an absolute path (a relative one would depend on where the app started). */
  /** No folder was given: the text was empty, or only spaces or quotes. */
  'workspace.root.empty': Record<string, never>
  'workspace.root.notAbsolute': { path: string }
  /** A workspace root that does not exist. */
  'workspace.root.notFound': { path: string }
  /** A workspace root that is a file, not a folder. */
  'workspace.root.notDirectory': { path: string }
  /** A workspace root the app is not allowed to open or list. */
  'workspace.root.unreadable': { path: string }
  // B10 · Approvals (shared/types/approvals.ts). Titles, summaries, requesters, options and the app's notes.
  'approvals.title.agent': Record<string, never>
  'approvals.title.oxequery': Record<string, never>
  'approvals.title.previewAutomation': Record<string, never>
  'approvals.title.crash': Record<string, never>
  /**
   * A `confirm`-level MCP tool; `tool` and `action` are the tool's identifiers (`oxespace_git`, `push`), not sentences, and
   * `target` is what it applies to from the app's records (a project path, a server, a resource).
   */
  'approvals.summary.mcpConfirm': { tool: string; action: string; target: string }
  'approvals.summary.oxequery.read': Record<string, never>
  'approvals.summary.oxequery.write': Record<string, never>
  'approvals.summary.oxequery.action': Record<string, never>
  'approvals.summary.preview.closeTab': Record<string, never>
  'approvals.summary.preview.click': Record<string, never>
  'approvals.summary.preview.fill': Record<string, never>
  'approvals.summary.preview.navigate': Record<string, never>
  'approvals.summary.preview.scroll': Record<string, never>
  'approvals.summary.preview.other': { action: string }
  'approvals.summary.crash': Record<string, never>
  /** The app's name for who asks: the agent's provider and the pane's position, never the pane's chosen name. */
  'approvals.requester.pane': { agent: string; pane: number }
  /** A conversation, by provider and a short id the app assigned. */
  'approvals.requester.conversation': { agent: string; conversation: string }
  /** The provider is not known to the app: never a provider name, so it cannot pass for a trusted one. */
  'approvals.requester.unknownPane': { pane: number }
  'approvals.requester.unknownConversation': { conversation: string }
  'approvals.requester.mcpServer': { server: string }
  'approvals.requester.app': Record<string, never>
  /** A Web Preview automation call with no pane or conversation behind it. */
  'approvals.requester.preview': Record<string, never>
  'approvals.option.deny': Record<string, never>
  'approvals.option.allowOnce': Record<string, never>
  'approvals.option.allowSessionReads': Record<string, never>
  'approvals.option.closeTab': Record<string, never>
  'approvals.option.restart': Record<string, never>
  'approvals.option.keepWorking': Record<string, never>
  /** `statement` is the SQL keyword the classifier saw (`DROP`, `DELETE`). */
  'approvals.note.sql.removes': { statement: string }
  'approvals.note.sql.noWhere': { statement: string }
  'approvals.note.sql.alterDrop': Record<string, never>
  'approvals.note.sql.withNoWhere': { statement: string }
  'approvals.note.sql.explainAnalyze': Record<string, never>
  'approvals.note.sql.selectInto': Record<string, never>
  'approvals.note.sql.notReadOnly': { statement: string }
  'approvals.note.sql.outsideReach': { calls: string[] }
  'approvals.note.production': Record<string, never>
  'approvals.note.mongo.deletes': { count: number }
  'approvals.note.mongo.changes': { count: number }
  'approvals.note.mongo.emptyFilter': Record<string, never>
  'approvals.note.agent.actsOnPrompt': Record<string, never>
  'approvals.note.agent.turnStopped': Record<string, never>
  'approvals.note.thread.actsOnMessage': Record<string, never>
  'approvals.note.skill.followed': Record<string, never>
  'approvals.note.automation.runsAlone': Record<string, never>
  /** B15: an agent asks to open a page that is not on this computer's loopback. */
  'approvals.note.preview.notLocal': Record<string, never>
  'approvals.note.worktree.folderDeleted': Record<string, never>
  'approvals.note.worktree.forceDiscards': Record<string, never>
  'approvals.note.git.branchShared': Record<string, never>
  'approvals.note.checkpoint.replaces': Record<string, never>
  'approvals.note.github.autoMerge': Record<string, never>
  'approvals.note.github.releasePublic': Record<string, never>
  /** The requester's text was longer than the window shows; only deny is offered. */
  'approvals.note.textCut': { max: number }
  'approvals.note.crash': Record<string, never>
  /** R2: the requester's text holds bidi controls or invisible characters; the risk is at least high. */
  'approvals.note.hiddenCharacters': Record<string, never>
  /** The system dialog cannot hold Allow back for 2 s, so a critical request is deny-only there. */
  'approvals.note.nativeCriticalDenyOnly': Record<string, never>
  /** R3: the OS notification when a request waits and the window is not focused. Fixed text, never request content. */
  'approvals.notify.waiting': Record<string, never>
  /** The window could not show the modal for a request, so it opened in a system dialog. */
  'approvals.unavailable': Record<string, never>
  /** Nobody answered in time; the request was denied. */
  'approvals.expired': Record<string, never>
  /** Refusals of `approvals.respond`, `ack` and `unavailable` (APPROVAL_REFUSALS). */
  'approvals.refused.notPending': Record<string, never>
  'approvals.refused.staleGeneration': Record<string, never>
  'approvals.refused.alreadyAnswered': Record<string, never>
  'approvals.refused.unknownOption': Record<string, never>
  'approvals.refused.alreadyReported': Record<string, never>
  /** An allow at critical risk before the modal had been shown for APPROVAL_CRITICAL_ALLOW_DELAY_MS. */
  'approvals.refused.tooSoon': Record<string, never>
  /** R1: an allow before the window acknowledged showing the request, at any risk. */
  'approvals.refused.notShown': Record<string, never>
  /** Denied before it was shown: APPROVAL_QUEUE_MAX requests were already waiting. */
  'approvals.denied.queueFull': { max: number }
  'approvals.denied.timeout': Record<string, never>
  'approvals.denied.cancelled': Record<string, never>
  /** Denied before it was shown: the text to approve is longer than a person reviews. */
  'approvals.denied.tooLong': { max: number }
  /** An agent's notification, prefixed with who sent it; `title` is the agent's text. */
  'notify.prefix.pane': { agent: string; pane: number; title: string }
  'notify.prefix.conversation': { agent: string; conversation: string; title: string }
  'notify.prefix.unknownPane': { pane: number; title: string }
  'notify.prefix.unknownConversation': { conversation: string; title: string }
  'notify.refused.reservedName': { name: string }
  'notify.refused.rateLimit': { perMinute: number }
  /** A pane name an agent chose contains a name only the app uses. */
  'agents.name.reserved': { name: string }
}

export type MessageCode = keyof MessageParams

export const MESSAGE_CODES = [
  'mcp.quarantine.changed',
  'mcp.quarantine.added',
  'mcp.quarantine.removed',
  'mcp.quarantine.configChanged',
  'thread.request.notPending',
  'thread.request.staleGeneration',
  'thread.request.alreadyResponding',
  'thread.request.unanswered',
  'thread.request.guardedDecision',
  'thread.protectedConfig.instructions',
  'thread.protectedConfig.mcp',
  'thread.protectedConfig.hooks',
  'thread.protectedConfig.warning',
  'thread.protectedConfig.rewritesTracked',
  'app.connectivity.offline',
  'ipc.sender.refused',
  'thread.side.unavailable',
  'thread.side.noSession',
  'thread.agent.scriptUnsupported',
  'thread.agent.nativeMissing',
  'activity.invalid',
  'activity.tooMany',
  'activity.titleTooLong',
  'activity.detailTooLong',
  'activity.hiddenCharacters',
  'activity.future',
  'activity.secret',
  'thread.sections.invalid',
  'thread.sections.tooMany',
  'thread.sections.nameEmpty',
  'thread.sections.nameTooLong',
  'thread.sections.nameHidden',
  'thread.sections.nameDuplicate',
  'thread.sections.unknownWorkspace',
  'agents.resume.sessionMissing',
  'agents.resume.otherAgent',
  'agents.resume.launchOverride',
  'agents.resume.blocked',
  'agents.resume.disabled',
  'agents.resume.startedFresh',
  'agents.resume.failedToLoad',
  'agents.session.notFound',
  'incident.window.crashed',
  'incident.window.rendererGone',
  'incident.ipc.handlerFailed',
  'incident.ipc.validationRejected',
  'incident.ipc.senderRefused',
  'incident.agent.startFailed',
  'incident.mcp.quarantined',
  'incident.mcp.toolGroupOff',
  'incident.database.busy',
  'incident.oxequery.timeout',
  'incident.oxequery.restartDeferred',
  'incident.updater.failed',
  'incident.interaction.overBudget',
  'incident.app.journalReset',
  'incident.app.closeUnanswered',
  'incident.app.closeRendererGone',
  'incident.app.closeGuardFailed',
  'incident.window.externalRefused',
  'incident.window.externalRateLimited',
  'incident.window.externalOpenFailed',
  'incident.window.openDenied',
  'incident.window.navigationDenied',
  'diagnostics.bundle.fileTooLarge',
  'diagnostics.bundle.tooLarge',
  'bundle.file.snapshot',
  'bundle.file.incidents',
  'bundle.file.logTail',
  'bundle.file.runtime',
  'bundle.file.versions',
  'bundle.file.configuration',
  'linear.worktree.exists',
  'worktree.cleanup.notRemovable',
  'worktree.cleanup.blocked',
  'worktree.cleanup.needsConfirmation',
  'mcp.signIn.waiting',
  'mcp.server.quarantined',
  'mcp.server.untrusted',
  'mcp.toolGroups.unknownProject',
  'mcp.toolGroups.invalidYaml',
  'mcp.toolGroups.notMapping',
  'mcp.toolGroups.inlineThread',
  'mcp.toolGroups.unsafeEdit',
  'project.file.changedMeanwhile',
  'github.cli.missing',
  'git.base.unresolved',
  'git.base.maybeStale',
  'git.fetch.needsPerson',
  'git.person.refused',
  'git.hooks.skipped',
  'oxe.status.unreadable',
  'oxe.dashboard.timeout',
  'memory.disabled',
  'memory.unavailable',
  'memory.runtimeUnavailable',
  'thread.commands.configure',
  'thread.commands.busy',
  'thread.commands.claudeFailed',
  'thread.commands.codexFailed',
  'thread.capability.readOnly',
  'thread.capability.mcpReadOnly',
  'thread.observe.unsupported',
  'thread.observe.changed',
  'thread.queue.deliveryUnconfirmed',
  'oxequery.edit.readOnly',
  'oxequery.edit.notTable',
  'oxequery.edit.noKey',
  'oxequery.test.connected',
  'oxequery.startFailed',
  'oxequery.sql.copyProgram',
  'oxequery.sql.doBlock',
  'oxequery.sql.callProcedure',
  'oxequery.sql.destructiveInside',
  'oxequery.sql.rowLock',
  'oxequery.sql.sessionRole',
  'oxequery.sql.tableLock',
  'oxequery.session.busy',
  'oxequery.session.limit',
  'oxequery.session.agentTransaction',
  'oxequery.mongo.confirmName',
  'oxequery.mongo.confirm',
  'oxequery.mongo.production',
  'oxequery.mongo.deletes',
  'oxequery.sql.ambiguousEscape',
  'oxepod.startFailed',
  'oxepost.network.notFound',
  'oxepost.network.refused',
  'oxepost.network.reset',
  'oxepost.network.timedOut',
  'oxepost.network.lookupFailed',
  'oxepost.network.hostUnreachable',
  'oxepost.network.networkUnreachable',
  'oxepost.send.invalidUrl',
  'oxepost.send.scheme',
  'oxepost.send.bodyNotAllowed',
  'oxepost.send.bodyTooLarge',
  'oxepost.send.invalidHeader',
  'oxepost.send.timeout',
  'oxepost.send.tls',
  'oxepost.send.failed',
  'oxepost.send.failedWith',
  'remote.port.privileged',
  'remote.port.inUse',
  'remote.network.noPrivateInterface',
  'remote.certificate.failed',
  'workspace.root.empty',
  'workspace.root.notAbsolute',
  'workspace.root.notFound',
  'workspace.root.notDirectory',
  'workspace.root.unreadable',
  'approvals.title.agent',
  'approvals.title.oxequery',
  'approvals.title.previewAutomation',
  'approvals.title.crash',
  'approvals.summary.mcpConfirm',
  'approvals.summary.oxequery.read',
  'approvals.summary.oxequery.write',
  'approvals.summary.oxequery.action',
  'approvals.summary.preview.closeTab',
  'approvals.summary.preview.click',
  'approvals.summary.preview.fill',
  'approvals.summary.preview.navigate',
  'approvals.summary.preview.scroll',
  'approvals.summary.preview.other',
  'approvals.summary.crash',
  'approvals.requester.pane',
  'approvals.requester.conversation',
  'approvals.requester.unknownPane',
  'approvals.requester.unknownConversation',
  'approvals.requester.mcpServer',
  'approvals.requester.app',
  'approvals.requester.preview',
  'approvals.option.deny',
  'approvals.option.allowOnce',
  'approvals.option.allowSessionReads',
  'approvals.option.closeTab',
  'approvals.option.restart',
  'approvals.option.keepWorking',
  'approvals.note.sql.removes',
  'approvals.note.sql.noWhere',
  'approvals.note.sql.alterDrop',
  'approvals.note.sql.withNoWhere',
  'approvals.note.sql.explainAnalyze',
  'approvals.note.sql.selectInto',
  'approvals.note.sql.notReadOnly',
  'approvals.note.sql.outsideReach',
  'approvals.note.production',
  'approvals.note.mongo.deletes',
  'approvals.note.mongo.changes',
  'approvals.note.mongo.emptyFilter',
  'approvals.note.agent.actsOnPrompt',
  'approvals.note.agent.turnStopped',
  'approvals.note.thread.actsOnMessage',
  'approvals.note.skill.followed',
  'approvals.note.automation.runsAlone',
  'approvals.note.preview.notLocal',
  'approvals.note.worktree.folderDeleted',
  'approvals.note.worktree.forceDiscards',
  'approvals.note.git.branchShared',
  'approvals.note.checkpoint.replaces',
  'approvals.note.github.autoMerge',
  'approvals.note.github.releasePublic',
  'approvals.note.textCut',
  'approvals.note.crash',
  'approvals.note.hiddenCharacters',
  'approvals.note.nativeCriticalDenyOnly',
  'approvals.notify.waiting',
  'approvals.unavailable',
  'approvals.expired',
  'approvals.refused.notPending',
  'approvals.refused.staleGeneration',
  'approvals.refused.alreadyAnswered',
  'approvals.refused.unknownOption',
  'approvals.refused.alreadyReported',
  'approvals.refused.tooSoon',
  'approvals.refused.notShown',
  'approvals.denied.queueFull',
  'approvals.denied.timeout',
  'approvals.denied.cancelled',
  'approvals.denied.tooLong',
  'notify.prefix.pane',
  'notify.prefix.conversation',
  'notify.prefix.unknownPane',
  'notify.prefix.unknownConversation',
  'notify.refused.reservedName',
  'notify.refused.rateLimit',
  'agents.name.reserved'
] as const satisfies readonly MessageCode[]

/** A code and its parameters, as one value: what crosses IPC instead of a sentence. */
export type MainMessage = { [Code in MessageCode]: { code: Code; params: MessageParams[Code] } }[MessageCode]

const known = new Set<string>(MESSAGE_CODES)

export function isMessageCode(value: unknown): value is MessageCode {
  return typeof value === 'string' && known.has(value)
}

/** Shape check for a message read back from storage or another process; parameters are checked by the catalog. */
export function isMainMessage(value: unknown): value is MainMessage {
  if (!value || typeof value !== 'object') return false
  const { code, params } = value as { code?: unknown; params?: unknown }
  return isMessageCode(code) && !!params && typeof params === 'object' && !Array.isArray(params)
}

export function mainMessage<Code extends MessageCode>(code: Code, params: MessageParams[Code]): { code: Code; params: MessageParams[Code] } {
  return { code, params }
}

/** The catalog key of a code in the `main` namespace. */
export function messageKey(code: MessageCode): `messages.${MessageCode}` {
  return `messages.${code}`
}

/** Interpolation values for the catalog: lists are joined the way the language writes them. */
export function messageValues(message: MainMessage, language: string): Record<string, string> {
  const list = new Intl.ListFormat(language, { style: 'long', type: 'conjunction' })
  return Object.fromEntries(Object.entries(message.params as Record<string, unknown>)
    .map(([name, value]) => [name, Array.isArray(value) ? list.format(value.map(String)) : String(value)]))
}
