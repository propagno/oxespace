package com.oxespace.mobile.ui.theme

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Frozen acceptance test for 1.5.0 A42 (OXE program, phase F10). Written by the planner; the executor must not edit it.
 * CCR: docs/roadmap-1.5/ccr-phone-screens.md (#688), rule MG4: the sun (`attn*`) means "needs you" only. It's never the
 * colour of an error, a warning or a failure; those are `intentDanger*` / `intentWarning*` inside a Notice.
 *
 * A source scan, like the desktop's design-lint: every line of the app's UI code that uses an `attn` token is checked,
 * which catches a mapping such as `FAILED -> Oxe.colors.attn`. Only the line itself is read, so the "Needs you" badge
 * may sit next to the Failed chip.
 */
class AttnUsageTest {
    /** Gradle runs unit tests from the module directory (`mobile/android/app`). */
    private val ui = File("src/main/java/com/oxespace/mobile/ui")
    private val attnUse = Regex("""\.attn(Bg|Border|Fg)?\b""")
    private val notNeedsYou = Regex("""error|fail|danger|warn|refus|denied|lapsed|revoked""", RegexOption.IGNORE_CASE)

    private fun sources(): List<File> = ui.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()

    @Test
    fun theScanFindsTheUiSources() {
        assertTrue("no Kotlin sources under ${ui.absolutePath}", sources().size > 10)
    }

    @Test
    fun theSunIsNeverNextToAnErrorAWarningOrAFailure() {
        val offenders = mutableListOf<String>()
        for (file in sources().filter { it.name != "OxeTokens.kt" }) {
            file.readLines().forEachIndexed { index, line ->
                if (attnUse.containsMatchIn(line) && notNeedsYou.containsMatchIn(line)) offenders += "${file.name}:${index + 1}: ${line.trim()}"
            }
        }
        assertEquals(emptyList<String>(), offenders)
    }

    @Test
    fun theNoticeNeverUsesTheSun() {
        val notices = sources().filter { it.name.startsWith("Notice") }
        for (file in notices) assertTrue(file.name, !attnUse.containsMatchIn(file.readText()))
    }
}
