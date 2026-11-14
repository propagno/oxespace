package com.oxespace.mobile.ui.theme

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * OXE-69 (BRD-07) CA-2: the phone's Material roles sit on the brand scale (M1-api-e-criterios.md › BRD-07, item 2):
 * titleMedium 16 sp / 600, bodyMedium 13 sp, labelMedium 12 sp, labelSmall 11 sp, and no role under 11 sp.
 */
class OxeThemeTest {
    private val roles: Map<String, TextStyle> = with(OxeTypography) {
        mapOf(
            "displayLarge" to displayLarge, "displayMedium" to displayMedium, "displaySmall" to displaySmall,
            "headlineLarge" to headlineLarge, "headlineMedium" to headlineMedium, "headlineSmall" to headlineSmall,
            "titleLarge" to titleLarge, "titleMedium" to titleMedium, "titleSmall" to titleSmall,
            "bodyLarge" to bodyLarge, "bodyMedium" to bodyMedium, "bodySmall" to bodySmall,
            "labelLarge" to labelLarge, "labelMedium" to labelMedium, "labelSmall" to labelSmall,
        )
    }

    @Test
    fun `escala tipográfica`() {
        assertEquals("titleMedium is 16 sp", 16f, OxeTypography.titleMedium.fontSize.value, 0.01f)
        assertEquals("titleMedium is weight 600", FontWeight(600), OxeTypography.titleMedium.fontWeight)
        assertEquals("bodyMedium is 13 sp", 13f, OxeTypography.bodyMedium.fontSize.value, 0.01f)
        assertEquals("labelMedium is 12 sp", 12f, OxeTypography.labelMedium.fontSize.value, 0.01f)
        assertEquals("labelSmall is 11 sp", 11f, OxeTypography.labelSmall.fontSize.value, 0.01f)
        for ((name, style) in roles) {
            assertTrue("$name is in sp", style.fontSize.isSp)
            assertTrue("$name is ${style.fontSize.value} sp, under 11 sp", style.fontSize.value >= 11f)
        }
    }
}
