package com.oxespace.mobile.approval

import android.app.Activity
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.oxespace.mobile.MainActivity
import com.oxespace.mobile.protocol.RemoteCommand
import com.oxespace.mobile.protocol.RemoteCommandFrame
import com.oxespace.mobile.protocol.RemoteFrame
import com.oxespace.mobile.protocol.RemotePendingRequest
import com.oxespace.mobile.protocol.live.LiveStreams
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The rule of M5 on a real device: an answer to a Thread request leaves the phone only after the system's biometric
 * or credential prompt succeeds. On this test device nothing is enrolled, so the real gate can't confirm, and not a
 * single command frame may go out.
 */
@RunWith(AndroidJUnit4::class)
class NoFrameWithoutBiometricsTest {
    @Test
    fun anAnswerNeverLeavesThePhoneWithoutConfirmation() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            var activity: Activity? = null
            scenario.onActivity { activity = it }
            val sent = CopyOnWriteArrayList<RemoteFrame>()
            val streams = LiveStreams().apply { attach { sent += it } }
            val responder = RequestResponder(BiometricApprovalGate(activity!!), streams.commands::respondRequest)
            val request = RemotePendingRequest(
                threadId = "t-1", workspaceId = "w", threadTitle = "Fix login", requestId = "r-1", generation = 1,
                kind = "approval", title = "Run rm -rf build", command = "rm -rf build", decisions = listOf("accept", "decline"),
                answerable = true, createdAt = 1,
            )
            for (decision in listOf("accept", "decline")) {
                val outcome = runBlocking { withTimeout(15_000) { responder.answer(request, decision = decision) } }
                assertEquals(decision, AnswerOutcome.Blocked(AnswerBlock.NOT_CONFIRMED), outcome)
            }
            assertTrue("no respondRequest frame left the phone", sent.none { it is RemoteCommandFrame && it.command == RemoteCommand.THREAD_RESPOND_REQUEST })
            assertTrue(sent.isEmpty())
        }
    }
}
