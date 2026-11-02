package com.oxespace.mobile.approval

import android.app.Activity
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.oxespace.mobile.MainActivity
import com.oxespace.mobile.protocol.RemoteCommand
import com.oxespace.mobile.protocol.RemoteCommandFrame
import com.oxespace.mobile.protocol.RemoteFrame
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.RemoteTerminalWriteArgs
import com.oxespace.mobile.protocol.RemoteThreadSendArgs
import com.oxespace.mobile.protocol.RemoteThreadSteerArgs
import com.oxespace.mobile.protocol.live.LiveStreams
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The rule of M5 on a real device: an answer to a Thread request, a message and terminal input leave the phone only
 * after the system's biometric or credential prompt succeeds. On this test device nothing is enrolled, so the real
 * gates can't confirm, and not a single command frame may go out.
 */
@RunWith(AndroidJUnit4::class)
class NoFrameWithoutBiometricsTest {
    private val sent = CopyOnWriteArrayList<RemoteFrame>()
    private val streams = LiveStreams().apply { attach { sent += it } }

    private fun withActivity(block: (Activity) -> Unit) = ActivityScenario.launch(MainActivity::class.java).use { scenario ->
        var activity: Activity? = null
        scenario.onActivity { activity = it }
        block(activity!!)
    }

    private fun commandsSent() = sent.filterIsInstance<RemoteCommandFrame>().map { it.command }

    @Test
    fun anAnswerNeverLeavesThePhoneWithoutConfirmation() = withActivity { activity ->
        val responder = RequestResponder(BiometricApprovalGate(activity), streams.commands::respondRequest)
        val request = RemotePendingRequest(
            threadId = "t-1", workspaceId = "w", threadTitle = "Fix login", requestId = "r-1", generation = 1,
            kind = "approval", title = "Run rm -rf build", command = "rm -rf build", decisions = listOf("accept", "decline"),
            answerable = true, createdAt = 1,
        )
        for (decision in listOf("accept", "decline")) {
            val outcome = runBlocking { withTimeout(15_000) { responder.answer(request, decision = decision) } }
            assertEquals(decision, AnswerOutcome.Blocked(AnswerBlock.NOT_CONFIRMED), outcome)
        }
        assertTrue("no respondRequest frame left the phone", RemoteCommand.THREAD_RESPOND_REQUEST !in commandsSent())
        assertTrue(sent.isEmpty())
    }

    /** MB-M-01: the Keystore window can't open on a phone with no screen lock, so nothing is typed or sent from it. */
    @Test
    fun noMessageOrTerminalInputLeavesThePhoneWithoutPresence() = withActivity { activity ->
        val gate = PresenceGate(KeystorePresence(activity))
        val outcomes = runBlocking {
            withTimeout(30_000) {
                listOf(
                    gate.run(PresenceReason.SEND) { streams.commands.send(RemoteThreadSendArgs("t-1", "hello", "c-1")) },
                    gate.run(PresenceReason.SEND) { streams.commands.steer(RemoteThreadSteerArgs("t-1", "stop that", "c-2")) },
                    gate.run(PresenceReason.TYPE) { streams.commands.terminalWrite(RemoteTerminalWriteArgs("pane-1", "ls\r")) },
                )
            }
        }
        for (outcome in outcomes) {
            assertTrue("$outcome", outcome is Gated.Blocked && (outcome.reason == Presence.NO_SCREEN_LOCK || outcome.reason == Presence.NOT_CONFIRMED))
        }
        assertTrue("no send, steer or terminal.write frame left the phone", commandsSent().none { it in setOf(RemoteCommand.THREAD_SEND, RemoteCommand.THREAD_STEER, RemoteCommand.TERMINAL_WRITE) })
        assertTrue(sent.isEmpty())
    }
}
