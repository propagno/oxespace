package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteAckFrame
import com.oxespace.mobile.protocol.RemoteCommand
import com.oxespace.mobile.protocol.RemoteCommandFrame
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemoteErrorFrame
import com.oxespace.mobile.protocol.RemoteFrame
import com.oxespace.mobile.protocol.RemoteFrames
import com.oxespace.mobile.protocol.RemoteLimits
import com.oxespace.mobile.protocol.RemoteTerminalWriteArgs
import com.oxespace.mobile.protocol.RemoteThreadInterruptArgs
import com.oxespace.mobile.protocol.RemoteThreadSendArgs
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CommandsTest {
    private val sent = CopyOnWriteArrayList<RemoteFrame>()
    private var ids = 0
    private val streams = LiveStreams(newId = { "c-${++ids}" }, answerTimeoutMs = 300)

    /** The real transport writes JSON; writing here too keeps the frame size check honest. */
    private fun attach() = streams.attach { frame -> RemoteFrames.write(frame); sent += frame }

    private suspend fun awaitSent(count: Int) { while (sent.size < count) delay(5) }

    @Test
    fun sendsTheCommandAndReturnsTheDesktopsAnswer() = runBlocking {
        attach()
        val result = async { streams.commands.send(RemoteThreadSendArgs("t-1", "run the tests", "client-1")) }
        awaitSent(1)
        val frame = sent.single() as RemoteCommandFrame
        assertEquals(RemoteCommand.THREAD_SEND, frame.command)
        assertEquals("client-1", frame.args["clientId"]?.jsonPrimitive?.content)
        assertTrue(streams.onFrame(RemoteAckFrame(id = frame.id, result = JsonPrimitive("queued"))))
        assertEquals(CommandResult.Done(JsonPrimitive("queued")), result.await())
    }

    @Test
    fun reportsTheDesktopsRefusalWithItsWait() = runBlocking {
        attach()
        val result = async { streams.commands.interrupt(RemoteThreadInterruptArgs("t-1")) }
        awaitSent(1)
        streams.onFrame(RemoteErrorFrame(id = (sent.single() as RemoteCommandFrame).id, code = RemoteErrorCode.RATE_LIMITED, retryAfterMs = 900))
        assertEquals(CommandResult.Refused(RemoteErrorCode.RATE_LIMITED, 900), result.await())
    }

    @Test
    fun sendsNothingWhileOffline() = runBlocking {
        assertEquals(CommandResult.Offline, streams.commands.interrupt(RemoteThreadInterruptArgs("t-1")))
        assertTrue(sent.isEmpty())
    }

    @Test
    fun aDropEndsWhatWasWaitingAndASilentDesktopTimesOut() = runBlocking {
        attach()
        val dropped = async { streams.commands.interrupt(RemoteThreadInterruptArgs("t-1")) }
        awaitSent(1)
        streams.detach()
        assertEquals(CommandResult.NoAnswer, dropped.await())
        attach()
        assertEquals(CommandResult.NoAnswer, streams.commands.interrupt(RemoteThreadInterruptArgs("t-1")))
    }

    @Test
    fun neverSendsAFrameOverTheLimit() = runBlocking {
        attach()
        val tooBig = "x".repeat(RemoteLimits.MAX_FRAME_BYTES)
        assertEquals(CommandResult.Refused(RemoteErrorCode.FRAME_TOO_LARGE), streams.commands.terminalWrite(RemoteTerminalWriteArgs("p-1", tooBig)))
        assertTrue(sent.isEmpty())
    }
}
