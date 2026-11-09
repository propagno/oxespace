package com.oxespace.mobile.session

import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.live.PANE_HIDDEN_REASON
import com.oxespace.mobile.protocol.live.TerminalBuffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 1.5.0 F10 CR-F10-8: an ended stream reaches the watched store, and the screen hears of it. */
class WatchedEndedTest {
    @Test
    fun aPaneHiddenEndClearsTheTerminalAndTicksWithoutARefusal() {
        val watched = Watched(TerminalBuffer())
        val before = watched.changes.value
        watched.onEnded(RemoteErrorCode.NOT_FOUND, PANE_HIDDEN_REASON)
        assertTrue(watched.store.hiddenOnDesktop)
        assertTrue(watched.changes.value > before)
        assertNull(watched.refused.value)
    }

    @Test
    fun anyOtherEndIsARefusal() {
        val watched = Watched(TerminalBuffer())
        watched.onEnded(RemoteErrorCode.FORBIDDEN, null)
        assertFalse(watched.store.hiddenOnDesktop)
        assertEquals(RemoteErrorCode.FORBIDDEN, watched.refused.value)
    }
}
