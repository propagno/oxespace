package com.oxespace.mobile.ui.live

import org.junit.Assert.assertEquals
import org.junit.Test

/** SECURITY #386: what reaches a terminal is what the person saw. */
class LineCheckTest {
    @Test
    fun aPlainLineGoes() {
        assertEquals(LineCheck.Clear, lineCheck("npm test -- auth"))
        assertEquals(LineCheck.Clear, lineCheck("npm test\n"))
    }

    @Test
    fun hiddenCharactersAreShownInsteadOfSent() {
        assertEquals(LineCheck.Hidden("ls ⟨U+202E⟩txt.sh"), lineCheck("ls \u202Etxt.sh"))
        assertEquals(LineCheck.Hidden("echo hi⟨U+001B⟩[2J"), lineCheck("echo hi\u001B[2J"))
        // A zero-width character hiding a second line is caught before the line count.
        assertEquals(LineCheck.Hidden("echo ok⟨U+200B⟩\nrm -rf ~"), lineCheck("echo ok\u200B\nrm -rf ~"))
    }

    @Test
    fun severalLinesAskFirst() {
        assertEquals(LineCheck.Lines(2), lineCheck("cd app\r\nnpm test"))
        assertEquals(LineCheck.Lines(3), lineCheck("a\nb\nc\n"))
    }
}
