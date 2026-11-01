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

    @Test
    fun aBlockKeepsItsLinesButNothingHidden() {
        assertEquals("first line\n\tsecond", displaySafeBlock("first\u200B line\n\tsecond\u202E", max = 100))
        assertEquals("ab…", displaySafeBlock("abcdef", max = 3))
    }

    @Test
    fun whatWouldRunShowsItsHiddenCharactersInsteadOfObeyingThem() {
        // "rm -rf ~/\u202Etxt.sh" would read as ending in "hs.txt"; the person sees the override written out instead.
        assertEquals("rm -rf ~/⟨U+202E⟩txt.sh", showHidden("rm -rf ~/\u202Etxt.sh"))
        assertEquals("a⟨U+200B⟩b⟨U+0007⟩c", showHidden("a\u200Bb\u0007c"))
        assertEquals("git add .\nnpm\ttest", showHidden("git add .\nnpm\ttest"))
        assertEquals("tag⟨U+E0041⟩", showHidden("tag\uDB40\uDC41"))
    }
}
