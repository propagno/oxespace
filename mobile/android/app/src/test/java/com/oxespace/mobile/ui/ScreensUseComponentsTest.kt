package com.oxespace.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Frozen acceptance test for 1.5.0 CR-A42b (A42, OXE program, phase F10). Written by the planner; the executor must not
 * edit it.
 *
 * rigor: source-assertion. What A42 asks is a property of how each screen is built ("the screens use the tokens and
 * components of #627"), and a rendered screen can't tell a Notice from an ad-hoc card that looks alike. So this reads
 * the screens' Kotlin, with comments stripped: problems drawn as a Notice, empty lists as an EmptyState, actions as an
 * OxeButton instead of Material's Button / OutlinedButton, and no literal colour. The look itself is the re-recorded
 * goldens, which DESIGN reviews at the F10 close.
 *
 * Red at F10 @ 1fbdccb4: no screen calls Notice or EmptyState, five screens still use Material buttons, there is no
 * Settings screen, and RequestScreen's "No undo." line draws the U+26A0 text glyph.
 */
class ScreensUseComponentsTest {
    /** Gradle runs unit tests from the module directory (`mobile/android/app`). */
    private val ui = File("src/main/java/com/oxespace/mobile/ui")

    private val home = "HomeScreen.kt"
    private val pairing = "pairing/PairingScreen.kt"
    private val live = "live/LiveHome.kt"
    private val thread = "live/ThreadScreen.kt"
    private val request = "live/RequestScreen.kt"
    private val terminal = "live/TerminalScreen.kt"
    private val settings = "settings/SettingsScreen.kt"
    private val screens = listOf(home, pairing, live, thread, request, terminal, settings)

    /** The file's code with `//` and block comments removed, so a mention in a comment never counts. */
    private fun code(path: String): String {
        val file = File(ui, path)
        assertTrue("$path exists", file.isFile)
        return file.readText()
            .replace(Regex("""/\*[\s\S]*?\*/"""), "")
            .lines().joinToString("\n") { line -> line.replace(Regex("""(?<!:)//.*$"""), "") }
    }

    private fun calls(code: String, name: String) = Regex("""(?<![A-Za-z0-9_.])$name\(""").containsMatchIn(code)

    @Test
    fun everyScreenOfA42Exists() {
        for (path in screens) assertTrue(path, File(ui, path).isFile)
    }

    @Test
    fun noScreenUsesMaterialsButtonOrOutlinedButtonForItsActions() {
        val offenders = screens.filter { File(ui, it).isFile }.flatMap { path ->
            val code = code(path)
            listOf("Button", "OutlinedButton").filter { calls(code, it) }.map { "$path: $it(" }
        }
        assertEquals("actions are OxeButton (#627 HANDOFF-MOBILE)", emptyList<String>(), offenders)
    }

    @Test
    fun noScreenHasALiteralColour() {
        val offenders = screens.filter { File(ui, it).isFile }.filter { Regex("""Color\(0x""").containsMatchIn(code(it)) }
        assertEquals("colours come from the generated OxeTokens (no hex in Compose)", emptyList<String>(), offenders)
    }

    @Test
    fun homeDrawsItsConnectionProblemsAsANotice() = assertTrue(calls(code(home), "Notice"))

    @Test
    fun pairingDrawsItsFailuresAsANotice() = assertTrue(calls(code(pairing), "Notice"))

    @Test
    fun theConversationDrawsItsProblemsAsANotice() = assertTrue(calls(code(thread), "Notice"))

    @Test
    fun theRequestScreenDrawsDesktopOnlyAndTruncatedAsANotice() = assertTrue(calls(code(request), "Notice"))

    @Test
    fun theTerminalDrawsHiddenAndUnavailableAsANotice() = assertTrue(calls(code(terminal), "Notice"))

    @Test
    fun liveHomeDrawsEmptyListsAsAnEmptyState() = assertTrue(calls(code(live), "EmptyState"))

    @Test
    fun theNoUndoLineUsesTheNoticeWarningIconNotATextGlyph() {
        val code = code(request)
        assertFalse("no U+26A0 text glyph (an emoji font ignores intentWarningFg)", code.contains("\\u26A0") || code.contains("⚠"))
        assertTrue("the warning icon comes from noticeIcon(NoticeIntent.WARNING)", Regex("""noticeIcon\(\s*NoticeIntent\.WARNING\s*\)""").containsMatchIn(code))
    }
}
