package com.oxespace.mobile.ui.live

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * OXE-385 (part without design decisions): the phone's OxeChat at the desktop's level where no design is to decide.
 * - A terminal agent's messages in PaneConversationView go through displaySafeBlock (hidden and bidi characters written
 *   out) and the agent's Markdown (MarkdownText, with its copyable code blocks), selectable.
 * - The agent's prose and answer in ThreadScreen are selectable (SelectionContainer).
 * - A tool step's patch tints its added and removed lines with diffAddBg and diffDelBg.
 * - Settings keeps its open subpage across a rotation (rememberSaveable) and says so when Android blocks notifications.
 * The Composer with Stop and Steer together is OXE-417 (a design decision). Source assertions read the Kotlin with its
 * comments stripped, as AlertSwitchesWiredTest does: this module has no Robolectric.
 */
class PhoneChatParityTest {
    private fun code(path: String): String {
        val file = File(path)
        assertTrue("$path exists", file.isFile)
        return file.readText()
            .replace(Regex("""/\*[\s\S]*?\*/"""), "")
            .lines().joinToString("\n") { line -> line.replace(Regex("""(?<!:)//.*$"""), "") }
    }

    private val live = "src/main/java/com/oxespace/mobile/ui/live"

    @Test
    fun aPatchLineIsAddedRemovedOrNeither() {
        assertEquals(DiffLineKind.ADDED, diffLineKind("+  return limit"))
        assertEquals(DiffLineKind.REMOVED, diffLineKind("-  return null"))
        assertEquals(DiffLineKind.OTHER, diffLineKind("+++ b/src/auth/login.js"))
        assertEquals(DiffLineKind.OTHER, diffLineKind("--- a/src/auth/login.js"))
        assertEquals(DiffLineKind.OTHER, diffLineKind("@@ -1,4 +1,6 @@"))
        assertEquals(DiffLineKind.OTHER, diffLineKind(" unchanged"))
        assertEquals(DiffLineKind.OTHER, diffLineKind(""))
    }

    @Test
    fun aDiffTintsOnlyItsAddedAndRemovedLines() {
        val add = Color(0xFFE4F6E6)
        val del = Color(0xFFFFEBE9)
        val patch = "@@ -1 +1 @@\n-old line\n+new line\n context"
        val tinted = tintedLines(patch) { line ->
            when (diffLineKind(line)) { DiffLineKind.ADDED -> add; DiffLineKind.REMOVED -> del; DiffLineKind.OTHER -> null }
        }
        assertEquals("the text is the patch as it was", patch, tinted.text)
        val spans = tinted.spanStyles.map { Triple(tinted.text.substring(it.start, it.end), it.item.background, it.start) }
        assertEquals(listOf(Triple("-old line", del, patch.indexOf("-old")), Triple("+new line", add, patch.indexOf("+new"))), spans)
        val untinted = tintedLines("a\nb") { null }
        assertEquals("a\nb", untinted.text)
        assertTrue(untinted.spanStyles.isEmpty())
    }

    @Test
    fun theToolDiffUsesTheDiffTokens() {
        val extras = code("$live/ConversationExtrasViews.kt")
        assertTrue("ToolDiffView tints the patch with diffAddBg", Regex("""diffAddBg""").containsMatchIn(extras))
        assertTrue("ToolDiffView tints the patch with diffDelBg", Regex("""diffDelBg""").containsMatchIn(extras))
        assertTrue("the patch is still drawn as a CodeBlock (Copiar copies the plain text)", Regex("""CodeBlock\(showHidden\(patch\)\)""").containsMatchIn(extras))
    }

    @Test
    fun aTerminalAgentsMessagesAreSafeSelectableMarkdown() {
        val pane = code("$live/PaneConversationView.kt")
        val items = pane.substringAfter("items(state.items").substringBefore("if (!atBottom")
        assertTrue("each message goes through displaySafeBlock", Regex("""displaySafeBlock\(item\.text,\s*RemoteTextLimits\.ITEM_TEXT\)""").containsMatchIn(items))
        assertTrue("the agent's messages are its Markdown", Regex("""MarkdownText\(shown""").containsMatchIn(items))
        assertTrue("the messages are selectable", Regex("""SelectionContainer""").containsMatchIn(items))
        assertTrue("no raw item.text reaches a Text", !Regex("""Text\(\s*item\.text""").containsMatchIn(items))
    }

    @Test
    fun theAgentsProseAndAnswerAreSelectable() {
        val thread = code("$live/ThreadScreen.kt")
        assertTrue("the prose row is selectable", Regex("""TimelineRow\.Prose\s*->[^\n]*SelectionContainer\s*\{\s*MarkdownText""").containsMatchIn(thread))
        val answer = thread.substringAfter("private fun AnswerCard(").substringBefore("\n}\n")
        assertTrue("the answer card's Markdown is selectable", Regex("""SelectionContainer\s*\{\s*MarkdownText""").containsMatchIn(answer))
    }

    @Test
    fun settingsKeepsItsSubpageAndWarnsWhenNotificationsAreBlocked() {
        val settings = code("src/main/java/com/oxespace/mobile/ui/settings/SettingsScreen.kt")
        assertTrue("the open subpage survives a configuration change", Regex("""var destination by rememberSaveable""").containsMatchIn(settings))
        assertTrue("the permission is read again on resume", Regex("""LifecycleResumeEffect[\s\S]{0,200}alertsAllowed = notificationsAllowed\(\)""").containsMatchIn(settings))
        assertTrue("a Notice says notifications are blocked", Regex("""if \(!alertsAllowed\)\s*\{\s*Notice\(""").containsMatchIn(settings))
        val activity = code("src/main/java/com/oxespace/mobile/MainActivity.kt")
        assertTrue("the app passes Android's own answer", Regex("""notificationsAllowed = \{ Notifications\(this@MainActivity\)\.allowed\(\) \}""").containsMatchIn(activity))
        assertTrue("its action opens the app's settings", Regex("""settings_alerts_open_settings\)\)\s*\{\s*LocalNetworkAccess\.openAppSettings\(context\)""").containsMatchIn(settings))
    }
}
