package com.oxespace.mobile.ui.live

import com.oxespace.mobile.protocol.RemoteThreadItem
import com.oxespace.mobile.protocol.live.id

/*
 * M10 (docs/design/mobile-conversation.md §2, §3a): the conversation as the phone draws it, built from the C5 items.
 * Pure, so the shape is tested without a screen. A turn starts after the person's prompt and ends with a `completed`
 * item; inside it, consecutive steps fold into one row, the agent's last message is the turn's one card, and a
 * finished turn shows its steps only when opened.
 */

/** What a tool step did, for its verb ("Leu", "Executou"…) and for the group summary. */
enum class StepKind { READ, RUN, EDIT, CREATE, SEARCH, OTHER }

fun stepKind(toolName: String): StepKind = when (toolName.lowercase()) {
    "read", "view", "cat", "notebookread", "read_file" -> StepKind.READ
    "bash", "shell", "exec", "run", "terminal", "command", "local_shell" -> StepKind.RUN
    "edit", "multiedit", "apply_patch", "patch", "notebookedit", "str_replace_editor" -> StepKind.EDIT
    "write", "create", "write_file" -> StepKind.CREATE
    "grep", "glob", "search", "find", "ls", "list", "websearch", "webfetch", "fetch" -> StepKind.SEARCH
    else -> StepKind.OTHER
}

sealed interface TimelineRow {
    val key: String

    /** The person's prompt: a sunken block. */
    data class Prompt(override val key: String, val text: String, val truncated: Boolean) : TimelineRow

    /** The agent's prose while it works: plain text with Markdown. */
    data class Prose(override val key: String, val text: String, val truncated: Boolean) : TimelineRow

    /** The turn's final message: the one card of the turn. */
    data class Answer(override val key: String, val text: String, val truncated: Boolean) : TimelineRow

    /** One tool step. */
    data class Step(override val key: String, val tool: RemoteThreadItem.Tool) : TimelineRow

    /** Consecutive steps folded into one row ("Leu 3 arquivos · executou 2 comandos"); opens to the rows. */
    data class StepGroup(override val key: String, val tools: List<RemoteThreadItem.Tool>) : TimelineRow

    data class Plan(override val key: String, val plan: RemoteThreadItem.Plan) : TimelineRow

    /** Where a request happened: a pill; the request itself is in the bar above the composer. */
    data class RequestMarker(override val key: String, val request: RemoteThreadItem.Request) : TimelineRow

    /** A finished turn's bar: it opens or closes that turn's steps. */
    data class TurnBar(override val key: String, val turnId: String, val steps: Int, val status: String, val open: Boolean) : TimelineRow

    /** The running turn's bar under its steps, and the live row: what is happening now. */
    data class Running(override val key: String, val steps: Int, val current: RemoteThreadItem.Tool?) : TimelineRow

    data class Subagents(override val key: String, val item: RemoteThreadItem.Subagent) : TimelineRow
}

/**
 * The rows to draw. [running]: the conversation's turn is still going (the last turn has no `completed` yet).
 * [openTurns]: finished turns the person opened. Reasoning is not drawn: the live row says what is happening.
 */
fun timelineRows(items: List<RemoteThreadItem>, running: Boolean, openTurns: Set<String>): List<TimelineRow> {
    val turns = splitTurns(items)
    val out = mutableListOf<TimelineRow>()
    turns.forEachIndexed { index, turn ->
        turn.prompt?.let { out += TimelineRow.Prompt("prompt:${it.id}", it.text, it.truncated == true) }
        val body = turn.body
        val completed = turn.completed
        val isLast = index == turns.lastIndex
        val live = isLast && completed == null && running
        val tools = body.filterIsInstance<RemoteThreadItem.Tool>()
        // The final message: the turn's last assistant message, once the turn has ended.
        val answer = if (completed != null) body.lastOrNull { it is RemoteThreadItem.Message && it.role == "assistant" } else null
        val turnId = turn.prompt?.id ?: completed?.id ?: body.firstOrNull()?.id ?: "turn-$index"
        val stepsShown = live || completed == null || turnId in openTurns
        if (completed != null && tools.isNotEmpty()) {
            out += TimelineRow.TurnBar("bar:$turnId", turnId, tools.size, completed.status, open = turnId in openTurns)
        }
        val pending = mutableListOf<RemoteThreadItem.Tool>()
        fun flush() {
            if (pending.isEmpty()) return
            if (stepsShown) out += groupSteps(pending.toList())
            pending.clear()
        }
        // The running step is the live row's: it is not drawn twice.
        val current = if (live) tools.lastOrNull()?.takeIf { it.state == "running" } else null
        for (item in body) {
            when (item) {
                is RemoteThreadItem.Tool -> if (item !== current) pending += item
                is RemoteThreadItem.Message -> {
                    flush()
                    if (item === answer) out += TimelineRow.Answer("answer:${item.id}", item.text, item.truncated == true)
                    else out += TimelineRow.Prose("prose:${item.id}", item.text, item.truncated == true)
                }
                is RemoteThreadItem.Plan -> { flush(); out += TimelineRow.Plan("plan:${item.id}", item) }
                is RemoteThreadItem.Request -> { flush(); out += TimelineRow.RequestMarker("request:${item.id}", item) }
                is RemoteThreadItem.Subagent -> { flush(); out += TimelineRow.Subagents("subagent:${item.id}", item) }
                is RemoteThreadItem.Reasoning, is RemoteThreadItem.Completed -> Unit
            }
        }
        flush()
        if (live) out += TimelineRow.Running("running:$turnId", tools.size, current)
    }
    return out
}

/** Consecutive steps: edits and creations stand alone (their change is the point); the rest fold when 2 or more. */
private fun groupSteps(tools: List<RemoteThreadItem.Tool>): List<TimelineRow> {
    val out = mutableListOf<TimelineRow>()
    val run = mutableListOf<RemoteThreadItem.Tool>()
    fun flush() {
        when (run.size) {
            0 -> Unit
            1 -> out += TimelineRow.Step("step:${run[0].id}", run[0])
            else -> out += TimelineRow.StepGroup("group:${run[0].id}", run.toList())
        }
        run.clear()
    }
    for (tool in tools) {
        val kind = stepKind(tool.name)
        // The running step and a failed one stay visible on their own.
        val alone = kind == StepKind.EDIT || kind == StepKind.CREATE || tool.state == "running" || tool.state == "failed"
        if (alone) { flush(); out += TimelineRow.Step("step:${tool.id}", tool) } else run += tool
    }
    flush()
    return out
}

/** How many steps of each kind a group holds, for its one-line summary. */
fun groupCounts(tools: List<RemoteThreadItem.Tool>): Map<StepKind, Int> =
    tools.groupingBy { stepKind(it.name) }.eachCount().toSortedMap()

private class Turn(val prompt: RemoteThreadItem.Message?, val body: List<RemoteThreadItem>, val completed: RemoteThreadItem.Completed?)

/** A turn: the person's prompt, what followed, and the `completed` that closed it (null while it runs). */
private fun splitTurns(items: List<RemoteThreadItem>): List<Turn> {
    val turns = mutableListOf<Turn>()
    var prompt: RemoteThreadItem.Message? = null
    var body = mutableListOf<RemoteThreadItem>()
    var started = false
    fun close(completed: RemoteThreadItem.Completed?) {
        if (started || prompt != null || body.isNotEmpty() || completed != null) turns += Turn(prompt, body, completed)
        prompt = null; body = mutableListOf(); started = false
    }
    for (item in items) {
        when {
            item is RemoteThreadItem.Message && item.role == "user" -> { if (prompt != null || body.isNotEmpty()) close(null); prompt = item; started = true }
            item is RemoteThreadItem.Completed -> close(item)
            else -> { body += item; started = true }
        }
    }
    if (started || prompt != null || body.isNotEmpty()) turns += Turn(prompt, body, null)
    return turns
}
