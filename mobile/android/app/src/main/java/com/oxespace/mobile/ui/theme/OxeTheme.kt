package com.oxespace.mobile.ui.theme

import android.provider.Settings
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import com.oxespace.mobile.R
import androidx.compose.ui.unit.TextUnit

val LocalOxeColors = staticCompositionLocalOf { LightOxeColors }
val LocalOxeMotion = staticCompositionLocalOf { StandardOxeMotion }

/** The desktop's tokens, for what Material 3 has no slot for (intents, identity, terminal colors, motion). */
object Oxe {
    val colors: OxeColors
        @Composable @ReadOnlyComposable get() = LocalOxeColors.current
    val motion: OxeMotion
        @Composable @ReadOnlyComposable get() = LocalOxeMotion.current
}

/** Material 3 slots filled from the Mandacaru roles, so stock components already look like the desktop. */
fun oxeColorScheme(colors: OxeColors, dark: Boolean): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = colors.accent,
        onPrimary = colors.textOnAccent,
        primaryContainer = colors.accentSoft,
        onPrimaryContainer = colors.textAccent,
        inversePrimary = colors.brandSun,
        secondary = colors.brandMark,
        onSecondary = colors.textOnSolid,
        secondaryContainer = colors.fillSelected,
        onSecondaryContainer = colors.textPrimary,
        tertiary = colors.intentInfoSolid,
        onTertiary = colors.textOnSolid,
        tertiaryContainer = colors.intentInfoBg,
        onTertiaryContainer = colors.intentInfoFg,
        background = colors.surfaceCanvas,
        onBackground = colors.textPrimary,
        surface = colors.surfaceBase,
        onSurface = colors.textPrimary,
        surfaceVariant = colors.surfaceChrome,
        onSurfaceVariant = colors.textSecondary,
        surfaceTint = colors.accent,
        inverseSurface = colors.surfaceInverse,
        inverseOnSurface = colors.surfaceBase,
        error = colors.intentDangerSolid,
        onError = colors.textOnSolid,
        errorContainer = colors.intentDangerBg,
        onErrorContainer = colors.intentDangerFg,
        outline = colors.borderDefault,
        outlineVariant = colors.borderSubtle,
        scrim = colors.scrim,
        surfaceBright = colors.surfaceOverlay,
        surfaceDim = colors.surfaceSunken,
        surfaceContainerLowest = colors.surfaceSunken,
        surfaceContainerLow = colors.surfaceCanvas,
        surfaceContainer = colors.surfaceBase,
        surfaceContainerHigh = colors.surfaceRaised,
        surfaceContainerHighest = colors.surfaceOverlay
    )
}

/**
 * The desktop's three Mandacaru families (`--font-ui`, `--font-mono`, `--font-display`), bundled in res/font from the
 * same @fontsource files the desktop ships (SIL OFL; licence in assets/licenses). Spec: docs/design/mobile-conversation.md §1.
 */
object OxeFonts {
    /** IBM Plex Sans: the interface and every body text. */
    val ui = FontFamily(
        Font(R.font.ibm_plex_sans_regular, FontWeight(400)),
        Font(R.font.ibm_plex_sans_medium, FontWeight(500)),
        Font(R.font.ibm_plex_sans_semibold, FontWeight(600)),
        Font(R.font.ibm_plex_sans_bold, FontWeight(700)),
    )

    /** IBM Plex Mono: commands, paths, code and the terminal. */
    val mono = FontFamily(
        Font(R.font.ibm_plex_mono_regular, FontWeight(400)),
        Font(R.font.ibm_plex_mono_medium, FontWeight(500)),
    )

    /** Bricolage Grotesque: screen titles and the request title only. */
    val display = FontFamily(
        Font(R.font.bricolage_grotesque_semibold, FontWeight(600)),
        Font(R.font.bricolage_grotesque_extrabold, FontWeight(800)),
    )
}

private fun style(size: TextUnit, leading: Float, weight: FontWeight, family: FontFamily = OxeFonts.ui) =
    TextStyle(fontFamily = family, fontSize = size, lineHeight = size * leading, fontWeight = weight)

/** Inline code, code blocks, commands and paths (spec §1, the role the desktop calls `--font-mono` at `sm`). */
val OxeCodeStyle = style(OxeType.textSm, OxeType.leadingNormal, OxeType.weightRegular, OxeFonts.mono)

/**
 * The desktop's type scale on Material's roles. Phones read at arm's length, so body text starts at `lg` (16 sp)
 * where the desktop's compact density uses `md`.
 */
val OxeTypography = Typography(
    displaySmall = style(OxeType.textDisplay, OxeType.leadingTight, OxeType.weightSemibold, OxeFonts.display),
    headlineMedium = style(OxeType.textDisplay, OxeType.leadingTight, OxeType.weightSemibold, OxeFonts.display),
    headlineSmall = style(OxeType.textXl, OxeType.leadingTight, OxeType.weightSemibold, OxeFonts.display),
    titleLarge = style(OxeType.textXl, OxeType.leadingSnug, OxeType.weightSemibold, OxeFonts.display),
    titleMedium = style(OxeType.textLg, OxeType.leadingSnug, OxeType.weightSemibold),
    titleSmall = style(OxeType.textMd, OxeType.leadingSnug, OxeType.weightMedium),
    bodyLarge = style(OxeType.textLg, OxeType.leadingNormal, OxeType.weightRegular),
    bodyMedium = style(OxeType.textMd, OxeType.leadingNormal, OxeType.weightRegular),
    bodySmall = style(OxeType.textSm, OxeType.leadingNormal, OxeType.weightRegular),
    labelLarge = style(OxeType.textMd, OxeType.leadingSnug, OxeType.weightMedium),
    labelMedium = style(OxeType.textXs, OxeType.leadingSnug, OxeType.weightMedium),
    labelSmall = style(OxeType.text2xs, OxeType.leadingSnug, OxeType.weightMedium)
)

/** Animations off in the developer options or the accessibility settings: transitions become instant. */
@Composable
private fun reducedMotion(): Boolean {
    if (LocalInspectionMode.current) return false
    val resolver = LocalContext.current.contentResolver
    return Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
}

/** Follows the system light or dark mode, with the desktop's colors, type and motion. */
@Composable
fun OxeTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val colors = if (darkTheme) DarkOxeColors else LightOxeColors
    val motion = if (reducedMotion()) ReducedOxeMotion else StandardOxeMotion
    CompositionLocalProvider(LocalOxeColors provides colors, LocalOxeMotion provides motion) {
        MaterialTheme(colorScheme = oxeColorScheme(colors, darkTheme), typography = OxeTypography, content = content)
    }
}
