package com.oxespace.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.oxespace.mobile.approval.Presence
import com.oxespace.mobile.approval.PresenceCheck
import com.oxespace.mobile.approval.PresenceGate
import com.oxespace.mobile.approval.PresenceReason
import com.oxespace.mobile.pairing.PairedDesktop
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemotePane
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.live.TerminalBuffer
import com.oxespace.mobile.protocol.live.ThreadTimeline
import com.oxespace.mobile.session.LiveRepository
import com.oxespace.mobile.session.Watched
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeSpace

/** Data the screenshots show: what a real desktop would send, through the same stores the app uses. */
object Samples {
    private fun json(text: String) = RemoteFrames.json.parseToJsonElement(text)

    val desktop = PairedDesktop("dev-1", "192.168.0.12", 7443, "a".repeat(64), "Studio", "alias-1")

    private val header = """{"id":"t-1","workspaceId":"w-1","title":"Fix the login redirect","provider":"claude","status":"running","pendingRequests":1,"updatedAt":5,"model":"opus","queued":0,"canSteer":true}"""

    fun live(empty: Boolean = false) = LiveRepository().apply {
        if (empty) {
            workspaces.onSnapshot(listOf(json("""{"workspaces":[]}""")))
            threads.onSnapshot(listOf(json("""{"threads":[]}""")))
            pendingRequests.onSnapshot(listOf(json("""{"requests":[]}""")))
            jobs.onSnapshot(listOf(json("""{"jobs":[]}""")))
            delegations.onSnapshot(listOf(json("""{"delegations":[]}""")))
            return@apply
        }
        workspaces.onSnapshot(listOf(json("""{"workspaces":[{"id":"w-1","name":"oxespace","active":true,"panes":[
            {"id":"p-1","title":"Claude","kind":"agent","agent":"claude","agentState":"working","phoneWrite":false},
            {"id":"p-2","title":"npm run dev","kind":"terminal","phoneWrite":true}]},
            {"id":"w-2","name":"site","active":false,"panes":[{"id":"p-3","title":"zsh","kind":"terminal","phoneWrite":false}]}]}""")))
        threads.onSnapshot(listOf(json("""{"threads":[
            $header,
            {"id":"t-2","workspaceId":"w-1","title":"Add tests for the gateway","provider":"codex","status":"idle","lastTurnStatus":"completed","pendingRequests":0,"updatedAt":4},
            {"id":"t-3","workspaceId":"w-2","title":"Migrate the build to Vite 7","provider":"claude","status":"failed","pendingRequests":0,"updatedAt":3}]}""")))
        pendingRequests.onSnapshot(listOf(json("""{"requests":[${requestJson(risky = true)}]}""")))
        jobs.onSnapshot(listOf(json("""{"jobs":[
            {"id":"j-1","workspaceId":"w-1","label":"Dev server","status":"running","exitCode":null,"startedAt":1,"finishedAt":null},
            {"id":"j-2","workspaceId":"w-1","label":"Unit tests","status":"failed","exitCode":1,"startedAt":1,"finishedAt":2}]}""")))
        delegations.onSnapshot(listOf(json("""{"delegations":[{"id":"d-1","workspaceId":"w-1","objective":"Review the pairing contract and list gaps","state":"running","branch":"review/pairing","updatedAt":3}]}""")))
    }

    private fun requestJson(risky: Boolean) = if (risky) {
        """{"threadId":"t-1","workspaceId":"w-1","threadTitle":"Fix the login redirect","requestId":"r-1","generation":3,"kind":"approval",
        "title":"Delete the build output","command":"rm -rf dist build","cwd":".","toolName":"Bash","paths":["dist/","build/"],
        "reason":"The old bundle breaks the redirect test","risk":"critical","warnings":["Deletes files outside the change set"],"redacted":1,
        "decisions":["accept","decline"],"answerable":true,"createdAt":1}"""
    } else {
        """{"threadId":"t-1","workspaceId":"w-1","threadTitle":"Fix the login redirect","requestId":"r-2","generation":3,"kind":"question",
        "title":"Which environment?","questions":[{"id":"q1","question":"Run the migration against which database?","options":[{"label":"Staging","description":"Copy of last night"},{"label":"Local"}],"required":true}],
        "decisions":[],"answerable":true,"createdAt":1}"""
    }

    fun request(risky: Boolean = true): RemotePendingRequest =
        RemoteFrames.json.decodeFromJsonElement(RemotePendingRequest.serializer(), json(requestJson(risky)))

    fun timeline(loaded: Boolean = true) = Watched(ThreadTimeline()).apply {
        if (!loaded) return@apply
        onSnapshot(listOf(json("""{"thread":$header,"hasMore":true,"items":[
            {"seq":1,"item":{"type":"message","id":"m1","role":"user","text":"The login redirect loops after the session expires. Fix it and add a test."}},
            {"seq":2,"item":{"type":"reasoning","id":"r1","text":"The middleware reads the old cookie.","completed":true}},
            {"seq":3,"item":{"type":"tool","id":"x1","name":"Bash","state":"completed","detail":"npm test -- auth","output":"✓ 41 tests\nAPI_KEY=[hidden]","exitCode":0,"filesChanged":2,"redacted":1}},
            {"seq":4,"item":{"type":"plan","id":"p1","steps":[{"label":"Read the middleware","status":"completed"},{"label":"Fix the expiry check","status":"inProgress"},{"label":"Add a regression test","status":"pending"}]}},
            {"seq":5,"item":{"type":"message","id":"m2","role":"assistant","text":"The expiry check compared seconds with milliseconds. I fixed it and I'm adding a test now."}},
            {"seq":6,"item":{"type":"request","id":"q-1","requestId":"r-1","kind":"approval","title":"Delete the build output","state":"pending"}}]}""")))
    }

    /** Every risk wire value the phone may meet: the four levels, the older shell colours and a level added later. */
    val riskWires = listOf("low", "medium", "high", "critical", "green", "orange", "red", "catastrophic")

    @Composable
    fun RiskLevels(line: @Composable (String) -> Unit) {
        Column(Modifier.fillMaxWidth().background(Oxe.colors.surfaceBase).padding(OxeSpace.space4), verticalArrangement = Arrangement.spacedBy(OxeSpace.space3)) {
            riskWires.forEach { line(it) }
        }
    }

    /** Three minutes after the sample requests were made, so "há 3 min" in every shot, whatever the day. */
    val clock: () -> Long = { 1 + 3 * 60_000L }

    /** The presence window open: screens draw what the person sees right after confirming. */
    val presence = PresenceGate(object : PresenceCheck {
        override suspend fun confirm(reason: PresenceReason, ask: Boolean) = Presence.CONFIRMED
        override fun windowOpen() = true
    })
    val pane = RemotePane("p-2", "npm run dev", "terminal", phoneWrite = true)
    val readOnlyPane = RemotePane("p-3", "zsh", "terminal", phoneWrite = false)

    fun terminal(loaded: Boolean = true) = Watched(TerminalBuffer()).apply {
        if (!loaded) return@apply
        val esc = "\\u001b"
        onSnapshot(listOf(json("""{"data":"$ npm run dev\n\n  $esc[1;32mVITE v7.1.2$esc[0m  ready in 412 ms\n\n  ➜  Local:   $esc[36mhttp://localhost:5173/$esc[0m\n  TOKEN=[hidden]\n$esc[33mwarn$esc[0m deprecated option 'base'\n","truncated":false,"redacted":1}""")))
    }
}
