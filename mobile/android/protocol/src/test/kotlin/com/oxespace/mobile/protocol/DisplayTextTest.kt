package com.oxespace.mobile.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DisplayTextTest {
    @Test
    fun dropsCharactersThatReorderOrHideText() {
        // A right-to-left override can make "report.exe" read as a .txt; isolates, zero-width and tags hide text too.
        assertEquals("Open reportexe.txt", displaySafe("Open report‮exe.txt‬"))
        assertEquals("Approve deploy", displaySafe("⁦Approve⁩ ​deploy﻿󠁁"))
        assertEquals("line one line two", displaySafe("line one\u0007 line two"))
        assertEquals("", displaySafe("‎‏\u0000"))
    }

    @Test
    fun cutsLongTextWithAnEllipsisWithoutSplittingACharacter() {
        val cut = displaySafe("é".repeat(200), max = 10)
        assertEquals("ééééééééé…", cut)
        val emoji = displaySafe("🚀".repeat(20), max = 5)
        assertEquals(5, emoji.codePointCount(0, emoji.length))
        assertTrue(emoji.endsWith("…"))
        assertEquals("short", displaySafe("short", max = 10))
    }
}
