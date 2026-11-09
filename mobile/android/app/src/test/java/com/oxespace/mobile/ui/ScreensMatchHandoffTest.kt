package com.oxespace.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Frozen acceptance test for 1.5.0 CR-A42b-2 (A42, OXE program, phase F10). Written by the planner; the executor must
 * not edit it.
 *
 * rigor: source-assertion. CR-A42b met ScreensUseComponentsTest but not all of its notes (MOBILE's own gap, TECH LEAD
 * ruling 09/11), and DESIGN's F10-close review (#744) puts the rest of #627 HANDOFF-MOBILE.md's component table in A42.
 * What is asked is how each screen is built: a rendered screen can't tell a ComputerCard from a look-alike Column. So
 * this reads the screens' Kotlin, with comments stripped. The look is the re-recorded goldens, which DESIGN walks for
 * A70; this test also requires the goldens DESIGN asked for (Settings, the hidden pane, the unavailable conversation).
 *
 * Red at F10 @ e233a0d8: none of the components below is called on its screen (most don't exist), Settings uses
 * Material's RadioButton and Switch, the bottom navigation still draws the 1.4 icons, and there is no Settings golden.
 */
class ScreensMatchHandoffTest {
    /** Gradle runs unit tests from the module directory (`mobile/android/app`). */
    private val ui = File("src/main/java/com/oxespace/mobile/ui")
    private val goldens = File("src/test/snapshots/images")

    /** The file's code with `//` and block comments removed, so a mention in a comment never counts. */
    private fun code(path: String): String {
        val file = File(ui, path)
        assertTrue("$path exists", file.isFile)
        return file.readText()
            .replace(Regex("""/\*[\s\S]*?\*/"""), "")
            .lines().joinToString("\n") { line -> line.replace(Regex("""(?<!:)//.*$"""), "") }
    }

    private fun calls(code: String, name: String) = Regex("""(?<![A-Za-z0-9_.])$name\(""").containsMatchIn(code)

    private fun missing(path: String, vararg names: String): List<String> {
        val code = code(path)
        return names.filterNot { calls(code, it) }.map { "$path: $it(" }
    }

    /** The body of `fun name(`: from its declaration to the first line that closes it at column 0. */
    private fun body(code: String, name: String): String {
        val start = Regex("""fun $name\(""").find(code)?.range?.first ?: return ""
        val end = code.indexOf("\n}", start)
        return if (end < 0) code.substring(start) else code.substring(start, end)
    }

    @Test
    fun homeHasTheMarkTheComputerCardAndTheConnectingSkeleton() =
        assertEquals("M1: OxeMark, the computer card, a skeleton while connecting", emptyList<String>(), missing("HomeScreen.kt", "OxeMark", "ComputerCard", "Skeleton"))

    @Test
    fun pairingHasTheStepperTheViewfinderAndTheCodeBoxes() =
        assertEquals("M2", emptyList<String>(), missing("pairing/PairingScreen.kt", "PairingStepper", "Viewfinder", "CodeBoxes"))

    @Test
    fun liveRowsHaveTheGlyphTheAvatarAndTheWorkspaceChip() =
        assertEquals("M3, T-P1.5 / T-P1.6", emptyList<String>(), missing("live/LiveHome.kt", "StatusGlyph", "ProviderAvatar", "WorkspaceChip"))

    @Test
    fun theBottomNavigationDrawsThe15IconsNotThe14Drawables() {
        val code = code("live/LiveHome.kt")
        val old = listOf("ic_threads", "ic_requests", "ic_terminal", "ic_tasks").filter { Regex("""R\.drawable\.$it\b""").containsMatchIn(code) }
        assertEquals("OxeChat, the bell, OxeCode, Tasks and Agora replace the 1.4 tab drawables", emptyList<String>(), old)
    }

    @Test
    fun theConversationHasTheNowBannerTheGateCardAndTheStepsSummary() =
        assertEquals("M4", emptyList<String>(), missing("live/ThreadScreen.kt", "NowBanner", "GateCard", "StepsSummary", "ProviderAvatar"))

    @Test
    fun theRequestHasTheRiskChipAndTheCriticalDelayAllow() =
        assertEquals("M5: RiskChip in the header, CriticalDelayAllow with its 2 s ring", emptyList<String>(), missing("live/RequestScreen.kt", "RiskChip", "CriticalDelayAllow"))

    @Test
    fun theTerminalViewIsASegmentedRowAndTheKeysStayMono() {
        val code = code("live/TerminalScreen.kt")
        assertTrue("the View control is the segmented row", calls(code, "Segmented") || calls(code, "SingleChoiceSegmentedButtonRow"))
        assertTrue("the key labels keep Plex Mono (DESIGN #744: terminal = mono)", body(code, "KeyRow").contains("OxeFonts.mono"))
    }

    @Test
    fun settingsIsBuiltFromSettingsRowOxeSwitchAndSegmented() {
        assertEquals("M8", emptyList<String>(), missing("settings/SettingsScreen.kt", "SettingsRow", "OxeSwitch", "Segmented"))
        val code = code("settings/SettingsScreen.kt")
        assertEquals("no Material RadioButton or Switch", emptyList<String>(), listOf("RadioButton", "Switch").filter { calls(code, it) })
    }

    @Test
    fun theGoldensDesignAskedForAreRecorded() {
        val names = goldens.list().orEmpty().toList()
        val absent = listOf("_settings", "terminal-hidden", "conversation-unavailable").filter { key -> names.none { it.contains(key) } }
        assertEquals("goldens for Settings, the hidden pane and the unavailable conversation (DESIGN #744)", emptyList<String>(), absent)
    }
}
