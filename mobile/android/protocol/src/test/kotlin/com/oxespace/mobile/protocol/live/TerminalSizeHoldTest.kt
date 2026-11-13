package com.oxespace.mobile.protocol.live

import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.RemoteTerminalGrid
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 1.5.0 · The phone holds the size of the terminal it has open so a full-screen CLI draws for the phone: what it sends
 * (`terminal.resize`, renewed, and `terminal.release`), and that it sends nothing to a desktop that did not list the
 * feature in its hello.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TerminalSizeHoldTest {
    /** A desktop that records what the phone sent and answers resize from [answer]. */
    private class Desk {
        val sent = mutableListOf<String>()
        var listed = true
        var answer: CommandResult = CommandResult.Done(null)
    }

    private fun TestScope.hold(desk: Desk) = TerminalSizeHold(
        scope = backgroundScope,
        supported = { desk.listed },
        resize = { args -> desk.sent += "resize ${args.paneId} ${args.cols}x${args.rows}"; desk.answer },
        release = { args -> desk.sent += "release ${args.paneId}"; CommandResult.Done(null) },
    )

    @Test
    fun theGridIsWholeCellsThatFitInsideTheDesktopsBounds() {
        assertEquals(TerminalGrid(45, 30), terminalGridFor(widthPx = 1000, heightPx = 1500, cellWidthPx = 22, cellHeightPx = 50))
        assertEquals(TerminalGrid(RemoteTerminalGrid.MIN_COLS, RemoteTerminalGrid.MIN_ROWS), terminalGridFor(100, 100, 22, 50))
        assertEquals(TerminalGrid(RemoteTerminalGrid.MAX_COLS, RemoteTerminalGrid.MAX_ROWS), terminalGridFor(100_000, 100_000, 1, 1))
        assertNull(terminalGridFor(0, 1500, 22, 50))
        assertNull(terminalGridFor(1000, 1500, 0, 50))
    }

    @Test
    fun anOpenScreenAsksForItsGridAndRenewsIt() = runTest {
        val desk = Desk()
        val hold = hold(desk)
        hold.hold("p1", TerminalGrid(45, 30)); runCurrent()
        assertEquals(listOf("resize p1 45x30"), desk.sent)
        assertEquals(SizeHold.HELD, hold.state.value)
        advanceTimeBy(TerminalSizeHold.RENEW_MS + 1); runCurrent()
        assertEquals(listOf("resize p1 45x30", "resize p1 45x30"), desk.sent)
    }

    @Test
    fun theSameGridAgainSendsNothingAndANewGridIsSentAtOnce() = runTest {
        val desk = Desk()
        val hold = hold(desk)
        hold.hold("p1", TerminalGrid(45, 30)); runCurrent()
        hold.hold("p1", TerminalGrid(45, 30)); runCurrent()
        assertEquals(1, desk.sent.size)
        hold.hold("p1", TerminalGrid(96, 18)); runCurrent()
        assertEquals(listOf("resize p1 45x30", "resize p1 96x18"), desk.sent)
    }

    @Test
    fun leavingLetsGoAndStopsRenewing() = runTest {
        val desk = Desk()
        val hold = hold(desk)
        hold.hold("p1", TerminalGrid(45, 30)); runCurrent()
        hold.release("p1"); runCurrent()
        assertEquals(listOf("resize p1 45x30", "release p1"), desk.sent)
        assertEquals(SizeHold.NONE, hold.state.value)
        advanceTimeBy(TerminalSizeHold.RENEW_MS * 3); runCurrent()
        assertEquals(2, desk.sent.size)
        // Releasing a pane that is not held sends nothing.
        hold.release("p2"); runCurrent()
        assertEquals(2, desk.sent.size)
    }

    @Test
    fun openingAnotherTerminalLetsGoOfTheFirst() = runTest {
        val desk = Desk()
        val hold = hold(desk)
        hold.hold("p1", TerminalGrid(45, 30)); runCurrent()
        hold.hold("p2", TerminalGrid(45, 30)); runCurrent()
        assertEquals(setOf("resize p1 45x30", "release p1", "resize p2 45x30"), desk.sent.toSet())
        assertEquals(3, desk.sent.size)
    }

    @Test
    fun anOlderDesktopIsSentNothingNotEvenARelease() = runTest {
        val desk = Desk().apply { listed = false }
        val hold = hold(desk)
        hold.hold("p1", TerminalGrid(45, 30)); runCurrent()
        advanceTimeBy(TerminalSizeHold.RENEW_MS * 2); runCurrent()
        hold.release("p1"); runCurrent()
        assertEquals(emptyList<String>(), desk.sent)
        assertEquals(SizeHold.NONE, hold.state.value)
    }

    @Test
    fun aDesktopThatConnectsLaterIsAskedThen() = runTest {
        val desk = Desk().apply { listed = false }
        val hold = hold(desk)
        hold.hold("p1", TerminalGrid(45, 30)); runCurrent()
        desk.listed = true
        advanceTimeBy(TerminalSizeHold.RETRY_MS + 1); runCurrent()
        assertEquals(listOf("resize p1 45x30"), desk.sent)
    }

    @Test
    fun aSizeTakenBackOnTheDesktopIsNotAskedAgainUntilThePhoneLeaves() = runTest {
        val desk = Desk().apply { answer = CommandResult.Refused(RemoteErrorCode.FORBIDDEN) }
        val hold = hold(desk)
        hold.hold("p1", TerminalGrid(45, 30)); runCurrent()
        assertEquals(SizeHold.TAKEN_BACK, hold.state.value)
        advanceTimeBy(TerminalSizeHold.RENEW_MS * 3); runCurrent()
        // A rotated phone has another grid; the desktop would refuse it too.
        hold.hold("p1", TerminalGrid(96, 18)); runCurrent()
        assertEquals(listOf("resize p1 45x30"), desk.sent)
        // Leaving tells the desktop, which ends the refusal; opening again asks again.
        hold.release("p1"); runCurrent()
        desk.answer = CommandResult.Done(null)
        hold.hold("p1", TerminalGrid(45, 30)); runCurrent()
        assertEquals(listOf("resize p1 45x30", "release p1", "resize p1 45x30"), desk.sent)
        assertEquals(SizeHold.HELD, hold.state.value)
    }

    @Test
    fun aPaneHiddenFromThePhoneIsNotAskedAgain() = runTest {
        val desk = Desk().apply { answer = CommandResult.Refused(RemoteErrorCode.PANE_NOT_SHARED) }
        val hold = hold(desk)
        hold.hold("p1", TerminalGrid(45, 30)); runCurrent()
        advanceTimeBy(TerminalSizeHold.RENEW_MS * 3); runCurrent()
        assertEquals(listOf("resize p1 45x30"), desk.sent)
        assertEquals(SizeHold.NONE, hold.state.value)
    }

    @Test
    fun aDroppedConnectionIsAskedAgainSoon() = runTest {
        val desk = Desk().apply { answer = CommandResult.Offline }
        val hold = hold(desk)
        hold.hold("p1", TerminalGrid(45, 30)); runCurrent()
        assertEquals(SizeHold.NONE, hold.state.value)
        desk.answer = CommandResult.Done(null)
        advanceTimeBy(TerminalSizeHold.RETRY_MS + 1); runCurrent()
        assertEquals(listOf("resize p1 45x30", "resize p1 45x30"), desk.sent)
        assertEquals(SizeHold.HELD, hold.state.value)
    }
}
