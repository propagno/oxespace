package com.oxespace.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * OXE-69 (BRD-07) CA-1 and CA-3, the static half (M1-api-e-criterios.md › BRD-07, items 1 and 3). A source scan of the
 * app's UI code (every file under `ui/`), comments left out:
 * - no text size under 11 sp (`\b([0-9]|10)\.sp\b`, with decimals or an `f`) and no autosize `minFontSize` under 11 sp;
 * - `RoundedCornerShape(` only receives `OxeRadius.*` tokens: 0 dp literals, no bare percent.
 * The one exemption is named once: `OxeMark.TILE_RADIUS_RATIO`, the app icon tile's corner, which is the launcher icon's
 * geometry (src/design/brand.ts TILE_RADIUS, 11 of 48) and so grows with the mark; it is a drawing of the icon, not a UI radius.
 */
class PhoneScaleSourceTest {
    /** Gradle runs unit tests from the module directory (`mobile/android/app`). */
    private val ui = File("src/main/java/com/oxespace/mobile/ui")

    private val iconTile = "components/Brand.kt" to "size * OxeMark.TILE_RADIUS_RATIO"

    private fun sources(): List<File> = ui.walkTopDown().filter { it.isFile && it.extension == "kt" }.sortedBy { it.path }.toList()

    private fun name(file: File) = file.relativeTo(ui).invariantSeparatorsPath

    /** The source without comments (a `//` after a colon, as in a URL, stays). */
    private fun code(file: File): String = file.readText()
        .replace(Regex("""/\*[\s\S]*?\*/"""), "")
        .lines().joinToString("\n") { line -> line.replace(Regex("""(?<!:)//.*$"""), "") }

    /** The argument text of every `RoundedCornerShape(…)` call, parentheses balanced. */
    private fun cornerArguments(code: String): List<String> =
        Regex("""(?<![A-Za-z0-9_])RoundedCornerShape\(""").findAll(code).map { match ->
            var depth = 1
            var i = match.range.last + 1
            val start = i
            while (i < code.length && depth > 0) {
                when (code[i]) {
                    '(' -> depth++
                    ')' -> depth--
                }
                i++
            }
            code.substring(start, i - 1).trim()
        }.toList()

    private val token = Regex("""^(\w+\s*=\s*)?OxeRadius\.\w+$""")

    private fun onlyTokens(arguments: String) = arguments.isNotEmpty() && arguments.split(',').all { token.matches(it.trim()) }

    @Test
    fun theScanFindsTheUiSourcesAndTheirCorners() {
        assertTrue("no Kotlin sources under ${ui.absolutePath}", sources().size > 10)
        assertTrue("the scan finds RoundedCornerShape calls", sources().sumOf { cornerArguments(code(it)).size } > 5)
    }

    @Test
    fun noTextUnder11Sp() {
        val under = Regex("""\b([0-9]|10)(\.[0-9]+)?f?\.sp\b""")
        val minFont = Regex("""minFontSize\s*=\s*([0-9]+(\.[0-9]+)?)f?\.sp""")
        val offenders = mutableListOf<String>()
        for (file in sources()) {
            val code = code(file)
            under.findAll(code).forEach { offenders += "${name(file)}: ${it.value} (under 11 sp)" }
            minFont.findAll(code).filter { it.groupValues[1].toFloat() < 11f }.forEach { offenders += "${name(file)}: ${it.value}" }
        }
        assertEquals("BRD-07: nothing under 11 sp under ui/", emptyList<String>(), offenders)
    }

    @Test
    fun cornersComeOnlyFromOxeRadius() {
        val dpLiteral = Regex("""\b[0-9]+(\.[0-9]+)?f?\.dp\b""")
        val offenders = mutableListOf<String>()
        var dpLiterals = 0
        var iconTileSeen = false
        for (file in sources()) {
            for (arguments in cornerArguments(code(file))) {
                dpLiterals += dpLiteral.findAll(arguments).count()
                if (name(file) == iconTile.first && arguments == iconTile.second) {
                    iconTileSeen = true
                    continue
                }
                if (!onlyTokens(arguments)) offenders += "${name(file)}: RoundedCornerShape($arguments)"
            }
        }
        assertEquals("BRD-07: RoundedCornerShape( under ui/ receives only OxeRadius tokens", emptyList<String>(), offenders)
        assertEquals("BRD-07: dp literals in RoundedCornerShape( under ui/", 0, dpLiterals)
        assertTrue("the OxeMark tile exemption is stale: drop it from this test", iconTileSeen)
    }
}
