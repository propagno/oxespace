package com.oxespace.mobile.compat

import com.oxespace.mobile.compat.v143.FrameRead as FrameRead143
import com.oxespace.mobile.compat.v143.FrameSource as FrameSource143
import com.oxespace.mobile.compat.v143.RemoteErrorCode as RemoteErrorCode143
import com.oxespace.mobile.compat.v143.RemoteErrorFrame as RemoteErrorFrame143
import com.oxespace.mobile.compat.v143.RemoteFrames as RemoteFrames143
import com.oxespace.mobile.compat.v143.RemoteHelloFrame as RemoteHelloFrame143
import com.oxespace.mobile.protocol.REMOTE_PROTOCOL_VERSION
import com.oxespace.mobile.protocol.RemoteAckFrame
import com.oxespace.mobile.protocol.RemoteDelegation
import com.oxespace.mobile.protocol.RemoteDelegationsData
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemoteErrorFrame
import com.oxespace.mobile.protocol.RemoteEventFrame
import com.oxespace.mobile.protocol.RemoteFrame
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemoteHelloFrame
import com.oxespace.mobile.protocol.RemoteJob
import com.oxespace.mobile.protocol.RemoteJobsData
import com.oxespace.mobile.protocol.RemotePane
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.RemotePendingRequestsData
import com.oxespace.mobile.protocol.RemoteQueuedPreview
import com.oxespace.mobile.protocol.RemoteSnapshotFrame
import com.oxespace.mobile.protocol.RemoteTerminalData
import com.oxespace.mobile.protocol.RemoteTerminalSnapshot
import com.oxespace.mobile.protocol.RemoteThreadEvent
import com.oxespace.mobile.protocol.RemoteThreadHeader
import com.oxespace.mobile.protocol.RemoteThreadItem
import com.oxespace.mobile.protocol.RemoteThreadSnapshot
import com.oxespace.mobile.protocol.RemoteThreadSummary
import com.oxespace.mobile.protocol.RemoteThreadsEvent
import com.oxespace.mobile.protocol.RemoteThreadsSnapshot
import com.oxespace.mobile.protocol.RemoteToolDiff
import com.oxespace.mobile.protocol.RemoteToolDiffFile
import com.oxespace.mobile.protocol.RemoteWorkspace
import com.oxespace.mobile.protocol.RemoteWorkspacesData
import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PolymorphicKind
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.StructureKind
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.0 A41, the phone half (F11, MOBILE; TECH LEAD 09/11). Written by the planner; the
 * executor must not edit it, and never the 1.4.3 fixture under `compat/v143/`.
 *
 * "A 1.4.3 APK with desktop 1.5.0 either works or shows its existing Update the app refusal, never a blank screen."
 * The desktop keeps protocol 1 (F11-SHIP proves that on its side), so a 1.4.3 phone stays connected and must read what
 * a 1.5.0 desktop sends it. Here every frame and every payload of the topics 1.4.3 follows is built from the 1.5.0
 * generated types with **every field set** (the descriptor walk below proves it, so a field added later turns this red
 * until it is covered), and decoded with exactly what 1.4.3 runs: its RemoteFrames and its generated classes, copied
 * from tag v1.4.3 into `compat/v143`.
 *
 * What would blank a 1.4.3 screen:
 * - a frame its RemoteFrames refuses (it then calls onUnreadable);
 * - a topic payload its store can't decode (decodeOrNull drops the whole list);
 * - an error that ends its session (revoked, unsupported-version, token-expired) sent where it isn't meant.
 *
 * Commands and topics added in 1.5.0 (agents, paneConversation, agent.markSeen, pane.conversation) only answer a phone
 * that asks for them; 1.4.3 never does, so they are out of scope.
 */
@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
class OldPhoneReadsNewDesktopTest {
    private val json = RemoteFrames.json

    private fun <T> data(serializer: KSerializer<T>, value: T): JsonElement = json.encodeToJsonElement(serializer, value)

    private fun text(frame: RemoteFrame): String = json.encodeToString(RemoteFrame.serializer(), frame)

    private fun read143(frame: RemoteFrame): FrameRead143 = RemoteFrames143.read(text(frame), FrameSource143.DESKTOP)

    // ---- The 1.5.0 payloads, every field set -------------------------------------------------------------------------

    private val pane = RemotePane(id = "p-1", title = "zsh", kind = "agent", agent = "claude", agentState = "working", phoneWrite = true, conversation = true)
    private val workspaces = RemoteWorkspacesData(listOf(RemoteWorkspace(id = "w-1", name = "oxespace", active = true, panes = listOf(pane), color = 4)))
    private val summary = RemoteThreadSummary(
        id = "t-1", workspaceId = "w-1", title = "Fix login", provider = "codex", status = "running",
        lastTurnStatus = "completed", backgroundRunning = 1, pendingRequests = 1, updatedAt = 1_700_000_000_000,
    )
    private val threads = RemoteThreadsSnapshot(listOf(summary))
    private val threadsEvent = RemoteThreadsEvent(upsert = listOf(summary), removed = listOf("t-0"))
    private val header = RemoteThreadHeader(
        id = "t-1", workspaceId = "w-1", title = "Fix login", provider = "codex", status = "running", lastTurnStatus = "completed",
        backgroundRunning = 1, pendingRequests = 1, updatedAt = 1_700_000_000_000, model = "gpt-5", queued = 1, canSteer = true,
        turnElapsedMs = 12_000, quietMs = 3_000, queuedPreview = listOf(RemoteQueuedPreview(id = "q-1", text = "and the tests", truncated = true)),
    )
    private val items = listOf(
        RemoteThreadItem.Message(id = "m-1", role = "user", text = "hi", truncated = true, attachments = 2),
        RemoteThreadItem.Reasoning(id = "r-1", text = "thinking", truncated = true, completed = true),
        RemoteThreadItem.Tool(
            id = "x-1", name = "bash", state = "completed", detail = "npm test", output = "ok", outputTruncated = true, exitCode = 0,
            filesChanged = 1, interrupted = false, redacted = 1,
            diff = RemoteToolDiff(files = listOf(RemoteToolDiffFile(path = "a.ts", additions = 1, deletions = 2)), patch = "@@", truncated = true),
        ),
        RemoteThreadItem.Plan(id = "pl-1", steps = listOf(RemoteThreadItem.Plan.Step(label = "Read", status = "completed"))),
        RemoteThreadItem.Request(id = "rq-1", requestId = "r-1", kind = "approval", title = "Run npm test", state = "pending"),
        RemoteThreadItem.Subagent(id = "s-1", state = "running", agents = 2),
        RemoteThreadItem.Completed(id = "c-1", status = "failed", errorCode = "rate-limited"),
    )
    private val thread = RemoteThreadSnapshot(thread = header, items = items.mapIndexed { i, item -> RemoteThreadSnapshot.Item(i.toLong(), item) }, hasMore = true)
    private val threadEvent = RemoteThreadEvent(thread = header, items = items.mapIndexed { i, item -> RemoteThreadEvent.Item(i.toLong(), item) })
    private val requests = RemotePendingRequestsData(
        listOf(
            RemotePendingRequest(
                threadId = "t-1", workspaceId = "w-1", threadTitle = "Fix login", requestId = "r-1", generation = 2, kind = "approval",
                title = "Run npm test", detail = "npm test", command = "npm test", cwd = ".", reason = "verify", toolName = "bash",
                paths = listOf("src/a.ts"), risk = "critical", warnings = listOf("Deletes files"), redacted = 1,
                questions = listOf(
                    RemotePendingRequest.Question(
                        id = "q-1", header = "Pick", question = "Which?", multiple = true, required = true,
                        options = listOf(RemotePendingRequest.Question.Option(label = "A", description = "the first")),
                    ),
                ),
                truncated = true, decisions = listOf("accept", "decline", "cancel"), answerable = true, createdAt = 1, expiresAt = 2,
            ),
        ),
    )
    private val terminal = RemoteTerminalData(data = "\u001b[32mok\u001b[0m\r\n", truncated = true, redacted = 1, snapshot = RemoteTerminalSnapshot(ansi = "ok", cols = 80, rows = 24))
    private val jobs = RemoteJobsData(listOf(RemoteJob(id = "j-1", workspaceId = "w-1", label = "npm run dev", status = "running", exitCode = 1, startedAt = 1, finishedAt = 2)))
    private val delegations = RemoteDelegationsData(
        listOf(RemoteDelegation(id = "d-1", workspaceId = "w-1", objective = "Plan", state = "failed", error = "boom", branch = "b", destinationThreadId = "t-2", updatedAt = 1)),
    )

    /** Each 1.4.3 topic's payloads as 1.5.0 builds them, with the 1.5.0 serializer (for the coverage walk). */
    private val payloads: List<Triple<String, JsonElement, SerialDescriptor>> = listOf(
        Triple("workspaces", data(RemoteWorkspacesData.serializer(), workspaces), RemoteWorkspacesData.serializer().descriptor),
        Triple("threads", data(RemoteThreadsSnapshot.serializer(), threads), RemoteThreadsSnapshot.serializer().descriptor),
        Triple("threads event", data(RemoteThreadsEvent.serializer(), threadsEvent), RemoteThreadsEvent.serializer().descriptor),
        Triple("thread", data(RemoteThreadSnapshot.serializer(), thread), RemoteThreadSnapshot.serializer().descriptor),
        Triple("thread event", data(RemoteThreadEvent.serializer(), threadEvent), RemoteThreadEvent.serializer().descriptor),
        Triple("pendingRequests", data(RemotePendingRequestsData.serializer(), requests), RemotePendingRequestsData.serializer().descriptor),
        Triple("terminal", data(RemoteTerminalData.serializer(), terminal), RemoteTerminalData.serializer().descriptor),
        Triple("jobs", data(RemoteJobsData.serializer(), jobs), RemoteJobsData.serializer().descriptor),
        Triple("delegations", data(RemoteDelegationsData.serializer(), delegations), RemoteDelegationsData.serializer().descriptor),
    )

    /** Every field a 1.5.0 class declares appears in its JSON: the fixture can't silently miss a new field. */
    private fun missingFields(element: JsonElement, descriptor: SerialDescriptor, path: String): List<String> = when {
        descriptor.kind == StructureKind.LIST && element is JsonArray ->
            element.flatMapIndexed { i, child -> missingFields(child, descriptor.getElementDescriptor(0), "$path[$i]") }
        descriptor.kind == StructureKind.CLASS && element is JsonObject ->
            (0 until descriptor.elementsCount).flatMap { i ->
                val name = descriptor.getElementName(i)
                val child = element[name]
                if (child == null) listOf("$path.$name") else missingFields(child, descriptor.getElementDescriptor(i), "$path.$name")
            }
        descriptor.kind == PolymorphicKind.SEALED && element is JsonObject -> {
            val type = (element["type"] as? kotlinx.serialization.json.JsonPrimitive)?.content
            val sub = descriptor.getElementDescriptor(1).let { subs -> (0 until subs.elementsCount).map { subs.getElementDescriptor(it) } }
                .firstOrNull { it.serialName == type || it.serialName.endsWith(".$type") }
            if (sub == null) listOf("$path(unknown type $type)") else missingFields(element, sub, path)
        }
        else -> emptyList()
    }

    @Test
    fun theFixtureSetsEveryFieldA150DesktopCanSend() {
        val missing = payloads.flatMap { (name, element, descriptor) -> missingFields(element, descriptor, name) }
        assertEquals("every 1.5.0 field is in the fixture, so 1.4.3 is tested against all of it", emptyList<String>(), missing)
        val types = items.map { json.encodeToJsonElement(RemoteThreadItem.serializer(), it).let { e -> (e as JsonObject)["type"].toString() } }.toSet()
        assertEquals("one item of every thread item type", RemoteThreadItem.serializer().descriptor.getElementDescriptor(1).elementsCount, types.size)
    }

    @Test
    fun a143PhoneReadsTheHelloOfA150DesktopAndStaysOnProtocol1() {
        val hello = RemoteHelloFrame(versions = listOf(REMOTE_PROTOCOL_VERSION.toLong()), desktopName = "Studio", challenge = "c".repeat(43), features = listOf("terminal.snapshotOnly", "pane.conversation"))
        val read = read143(hello)
        assertTrue("1.4.3 reads the 1.5.0 hello: $read", read is FrameRead143.Ok)
        assertEquals(listOf(1L), ((read as FrameRead143.Ok).frame as RemoteHelloFrame143).versions)
    }

    @Test
    fun a143PhoneReadsEverySnapshotAndEventFrameOfItsTopics() {
        val refused = payloads.flatMap { (name, element, _) ->
            listOf(
                RemoteSnapshotFrame(subscription = "s-$name", seq = 1, schemaVersion = 1, data = element, cursor = "c", page = RemoteSnapshotFrame.Page(index = 0, last = true)),
                RemoteEventFrame(subscription = "s-$name", seq = 2, schemaVersion = 1, data = element, cursor = "c"),
            ).mapNotNull { frame -> (read143(frame) as? FrameRead143.Refused)?.let { "$name: ${it.code}" } }
        }
        assertEquals(emptyList<String>(), refused)
    }

    @Test
    fun a143StoreDecodesEveryPayloadWhole() {
        val json143 = RemoteFrames143.json
        val decoded = mapOf(
            "workspaces" to runCatching { json143.decodeFromJsonElement(com.oxespace.mobile.compat.v143.RemoteWorkspacesData.serializer(), payloads[0].second) },
            "threads" to runCatching { json143.decodeFromJsonElement(com.oxespace.mobile.compat.v143.RemoteThreadsSnapshot.serializer(), payloads[1].second) },
            "threads event" to runCatching { json143.decodeFromJsonElement(com.oxespace.mobile.compat.v143.RemoteThreadsEvent.serializer(), payloads[2].second) },
            "thread" to runCatching { json143.decodeFromJsonElement(com.oxespace.mobile.compat.v143.RemoteThreadSnapshot.serializer(), payloads[3].second) },
            "thread event" to runCatching { json143.decodeFromJsonElement(com.oxespace.mobile.compat.v143.RemoteThreadEvent.serializer(), payloads[4].second) },
            "pendingRequests" to runCatching { json143.decodeFromJsonElement(com.oxespace.mobile.compat.v143.RemotePendingRequestsData.serializer(), payloads[5].second) },
            "terminal" to runCatching { json143.decodeFromJsonElement(com.oxespace.mobile.compat.v143.RemoteTerminalData.serializer(), payloads[6].second) },
            "jobs" to runCatching { json143.decodeFromJsonElement(com.oxespace.mobile.compat.v143.RemoteJobsData.serializer(), payloads[7].second) },
            "delegations" to runCatching { json143.decodeFromJsonElement(com.oxespace.mobile.compat.v143.RemoteDelegationsData.serializer(), payloads[8].second) },
        )
        assertEquals(payloads.size, decoded.size)
        val failed = decoded.filterValues { it.isFailure }.map { (name, result) -> "$name: ${result.exceptionOrNull()?.message?.lineSequence()?.first()}" }
        assertEquals("a store that can't decode drops the whole list: a blank screen", emptyList<String>(), failed)
    }

    @Test
    fun a143PhoneReadsEveryErrorA150DesktopSendsAndOnlyTheSessionEndersEndIt() {
        val enders143 = setOf(RemoteErrorCode143.REVOKED, RemoteErrorCode143.UNSUPPORTED_VERSION)
        val problems = RemoteErrorCode.entries.flatMap { code ->
            // An answer to a command or subscription, and a stream the desktop ends on its own (CR-34: no id).
            listOf(
                RemoteErrorFrame(id = "x-1", code = code, reason = "rewritten", retryAfterMs = 1_000),
                RemoteErrorFrame(subscription = "s-1", code = code, reason = "pane-hidden"),
            ).mapNotNull { frame ->
                when (val read = read143(frame)) {
                    is FrameRead143.Refused -> "${code.wire}: refused ${read.code}"
                    is FrameRead143.Ok -> {
                        val read143 = (read.frame as RemoteErrorFrame143).code
                        when {
                            // An unknown code reads as `internal` (1.4.3's withKnownErrorCode), never a session end.
                            com.oxespace.mobile.compat.v143.RemoteErrorCode.fromWire(code.wire) == null && read143 != RemoteErrorCode143.INTERNAL -> "${code.wire}: read as $read143"
                            read143 in enders143 && code.wire != read143.wire -> "${code.wire}: ends the 1.4.3 session as $read143"
                            else -> null
                        }
                    }
                }
            }
        }
        assertEquals(emptyList<String>(), problems)
    }

    @Test
    fun a143PhoneReadsTheAckOfA150Desktop() {
        val ack = RemoteAckFrame(id = "x-1", subscription = "s-1", result = data(RemoteThreadSnapshot.serializer(), thread))
        assertNotNull((read143(ack) as? FrameRead143.Ok)?.frame)
    }
}
