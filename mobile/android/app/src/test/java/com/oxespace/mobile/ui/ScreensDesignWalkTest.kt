package com.oxespace.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Frozen acceptance test for 1.5.0 CR-A42b-3 (A42, A47; program CR-F10-10, OXE phase F10). Written by the planner; the
 * executor must not edit it.
 *
 * rigor: source-assertion, plus the shipped copy. DESIGN's A70 walk of #744 @ 9edfbdf5 (TECH LEAD rulings 09/11):
 * 1. RiskChip on the intent scale of M5 / HANDOFF-MOBILE: Low success, Medium info, High warning, Critical solid danger.
 * 2. The composer while the agent works, per SPEC A47: the placeholder "Steer: read after the current step", the button
 *    "Send", and Stop with the danger tint.
 * 3. Agents while loading: the skeleton, not "Carregando…", and no "0" counts on the chips.
 * 4. A hidden terminal's app bar has a neutral title, "Terminal": never the pane's name (CR-34 privacy rule).
 * A rendered screen can't tell which token or resource drew it, so this reads the Kotlin (comments stripped) and the
 * generated strings; the look is the re-recorded goldens DESIGN re-walks.
 *
 * Red at F10 @ 9edfbdf5: High is a soft danger badge, Medium warning and Low neutral; the steer button reads "Steer" and
 * the placeholder "Message the agent"; Stop is SECONDARY; Agents shows "Carregando…" and counts from 0; the hidden
 * terminal keeps the pane title.
 */
class ScreensDesignWalkTest {
    /** Gradle runs unit tests from the module directory (`mobile/android/app`). */
    private val main = File("src/main")
    private val ui = File(main, "java/com/oxespace/mobile/ui")

    private fun code(file: File): String {
        assertTrue("${file.path} exists", file.isFile)
        return file.readText()
            .replace(Regex("""/\*[\s\S]*?\*/"""), "")
            .lines().joinToString("\n") { line -> line.replace(Regex("""(?<!:)//.*$"""), "") }
    }

    private fun string(locale: String, name: String): String? {
        val dir = if (locale == "en") "values" else "values-$locale"
        val xml = File(main, "res/$dir/strings.xml").readText()
        return Regex("""<string name="$name">([^<]*)</string>""").find(xml)?.groupValues?.get(1)
    }

    /** The line of `badgeStyle` for a level: what that level's badge is drawn with. */
    private fun badgeLine(level: String): String {
        val code = code(File(ui, "live/Risk.kt"))
        val start = code.indexOf("fun badgeStyle(")
        assertTrue("Risk.kt has badgeStyle", start >= 0)
        return code.substring(start).lineSequence().firstOrNull { it.contains("RemoteApprovalRisk.$level ->") }.orEmpty()
    }

    @Test
    fun theRiskChipFollowsTheIntentScale() {
        val wrong = mapOf("LOW" to "intentSuccess", "MEDIUM" to "intentInfo", "HIGH" to "intentWarning", "CRITICAL" to "intentDangerSolid")
            .filterNot { (level, intent) -> badgeLine(level).contains(intent) }.keys
        assertEquals("M5: Low success, Medium info, High warning, Critical solid danger", emptySet<String>(), wrong)
    }

    @Test
    fun theComposerWhileWorkingReadsAsTheSpecSays() {
        assertEquals("A47: the steer button sends", "Send", string("en", "composer_steer"))
        assertEquals("Enviar", string("pt-rBR", "composer_steer"))
        assertEquals("Steer: read after the current step", string("en", "composer_steer_placeholder"))
        val thread = code(File(ui, "live/ThreadScreen.kt"))
        assertTrue("the steer mode shows the steer placeholder", thread.contains("R.string.composer_steer_placeholder"))
        val stop = Regex("""text = stopLabel,[\s\S]{0,200}?kind = OxeButtonKind\.(\w+)""").find(thread)?.groupValues?.get(1)
        assertEquals("Stop has the danger tint", "DANGER", stop)
    }

    @Test
    fun agentsWhileLoadingIsASkeletonWithNoZeroCounts() {
        val agents = code(File(main, "java/com/oxespace/mobile/agents/AgentsScreen.kt"))
        assertFalse("no \"Carregando…\" line", agents.contains("R.string.live_loading"))
        assertTrue("the skeleton while loading", Regex("""(?<![A-Za-z0-9_.])Skeleton\(""").containsMatchIn(agents))
        assertTrue("a chip's count is absent until the list has loaded", Regex("""fun Chip\([^)]*count: Int\?""").containsMatchIn(agents))
    }

    @Test
    fun aHiddenTerminalHasANeutralTitle() {
        assertEquals("Terminal", string("en", "terminal_hidden_title"))
        assertEquals("Terminal", string("pt-rBR", "terminal_hidden_title"))
        assertTrue("the hidden pane's app bar uses it", code(File(ui, "live/TerminalScreen.kt")).contains("R.string.terminal_hidden_title"))
    }
}
