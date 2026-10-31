package com.oxespace.mobile.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Material slots keep the desktop's AA contrast: every "on" color is readable on the slot it sits on. */
class OxeColorSchemeTest {
    private fun contrast(a: Color, b: Color): Double {
        val (light, dark) = listOf(a.luminance().toDouble(), b.luminance().toDouble()).sortedDescending()
        return (light + 0.05) / (dark + 0.05)
    }

    @Test
    fun everyTextSlotIsAaOnItsBackground() {
        for ((name, dark) in listOf("light" to false, "dark" to true)) {
            val colors = if (dark) DarkOxeColors else LightOxeColors
            val scheme = oxeColorScheme(colors, dark)
            val pairs = mapOf(
                "onPrimary/primary" to (scheme.onPrimary to scheme.primary),
                "onPrimaryContainer/primaryContainer" to (scheme.onPrimaryContainer to scheme.primaryContainer),
                "onBackground/background" to (scheme.onBackground to scheme.background),
                "onSurface/surface" to (scheme.onSurface to scheme.surface),
                "onSurface/surfaceContainerHighest" to (scheme.onSurface to scheme.surfaceContainerHighest),
                "onSurfaceVariant/surface" to (scheme.onSurfaceVariant to scheme.surface),
                "onSurfaceVariant/surfaceVariant" to (scheme.onSurfaceVariant to scheme.surfaceVariant),
                "onError/error" to (scheme.onError to scheme.error),
                "onErrorContainer/errorContainer" to (scheme.onErrorContainer to scheme.errorContainer),
                "onTertiaryContainer/tertiaryContainer" to (scheme.onTertiaryContainer to scheme.tertiaryContainer),
                "inverseOnSurface/inverseSurface" to (scheme.inverseOnSurface to scheme.inverseSurface)
            )
            for ((pair, colorsOf) in pairs) {
                val ratio = contrast(colorsOf.first, colorsOf.second)
                assertTrue("$name $pair is ${"%.2f".format(ratio)}:1", ratio >= 4.5)
            }
        }
    }

    @Test
    fun followsTheDesktopAccentPerMode() {
        assertEquals(LightOxeColors.accent, oxeColorScheme(LightOxeColors, dark = false).primary)
        assertEquals(DarkOxeColors.accent, oxeColorScheme(DarkOxeColors, dark = true).primary)
        assertEquals(LightOxeColors.surfaceCanvas, oxeColorScheme(LightOxeColors, dark = false).background)
    }

    @Test
    fun reducedMotionMakesTransitionsInstant() {
        assertEquals(0, ReducedOxeMotion.durationFast)
        assertEquals(0, ReducedOxeMotion.durationBase)
        assertEquals(0, ReducedOxeMotion.durationSlow)
        assertTrue(ReducedOxeMotion.durationSpin > StandardOxeMotion.durationSpin)
        assertEquals(200, StandardOxeMotion.durationBase)
    }
}
