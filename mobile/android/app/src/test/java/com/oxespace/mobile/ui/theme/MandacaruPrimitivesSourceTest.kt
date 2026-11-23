package com.oxespace.mobile.ui.theme

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Guardrails for the Android Mandacaru Compose design system (OXE-373):
 * - No hardcoded hex `Color(0x...)` literals outside theme token files (`OxeTokens.kt` / `OxeTheme.kt` / `Theme.kt`).
 * - No hardcoded numeric `.sp` literals outside theme token files.
 * - No raw Material 3 `Button`, `OutlinedButton`, `TextButton`, or `IconButton` imports/usages outside
 *   `OxeButton.kt` and `OxeIconButton.kt`.
 */
class MandacaruPrimitivesSourceTest {
    /** Gradle runs unit tests from the module directory (`mobile/android/app`). */
    private val mainSources = File("src/main/java/com/oxespace/mobile")

    private val themeTokenFiles = setOf("OxeTokens.kt", "OxeTheme.kt", "Theme.kt")
    private val buttonPrimitiveFiles = setOf("OxeButton.kt", "OxeIconButton.kt")

    private val rawButtonImport = Regex("""import\s+androidx\.compose\.material3\.(Button|OutlinedButton|TextButton|IconButton)\b""")
    private val rawButtonCall = Regex("""(?<![A-Za-z0-9_.])(Button|OutlinedButton|TextButton|IconButton)\(""")
    private val spLiteral = Regex("""(?<![\w.])\d+(?:\.\d+)?\.sp\b""")
    private val hexColorLiteral = Regex("""Color\(0x""")

    private fun sources(): List<File> =
        mainSources.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()

    private fun stripComments(file: File): String = file.readText()
        .replace(Regex("""/\*[\s\S]*?\*/"""), "")
        .lines()
        .joinToString("\n") { line -> line.replace(Regex("""(?<!:)//.*$"""), "") }

    @Test
    fun scanFindsAndroidKotlinSources() {
        assertTrue("expected Kotlin sources under ${mainSources.absolutePath}", sources().size > 10)
    }

    @Test
    fun noHardcodedHexColorsOutsideThemeTokens() {
        val offenders = sources()
            .filter { it.name !in themeTokenFiles }
            .flatMap { file ->
                stripComments(file).lines().mapIndexedNotNull { idx, line ->
                    if (hexColorLiteral.containsMatchIn(line)) "${file.name}:${idx + 1}: ${line.trim()}" else null
                }
            }
        assertEquals("hardcoded Color(0x...) must live only in OxeTokens.kt / Theme.kt", emptyList<String>(), offenders)
    }

    @Test
    fun noHardcodedSpLiteralsOutsideThemeTokens() {
        val offenders = sources()
            .filter { it.name !in themeTokenFiles }
            .flatMap { file ->
                stripComments(file).lines().mapIndexedNotNull { idx, line ->
                    if (spLiteral.containsMatchIn(line)) "${file.name}:${idx + 1}: ${line.trim()}" else null
                }
            }
        assertEquals("hardcoded .sp literals must live only in OxeTokens.kt / Theme.kt", emptyList<String>(), offenders)
    }

    @Test
    fun noRawMaterialButtonsOutsideMandacaruPrimitives() {
        val offenders = sources()
            .filter { it.name !in buttonPrimitiveFiles }
            .flatMap { file ->
                stripComments(file).lines().mapIndexedNotNull { idx, line ->
                    if (rawButtonImport.containsMatchIn(line) || rawButtonCall.containsMatchIn(line)) {
                        "${file.name}:${idx + 1}: ${line.trim()}"
                    } else {
                        null
                    }
                }
            }
        assertEquals(
            "raw Material 3 Button/OutlinedButton/TextButton/IconButton must not be used outside OxeButton.kt and OxeIconButton.kt",
            emptyList<String>(),
            offenders,
        )
    }
}
