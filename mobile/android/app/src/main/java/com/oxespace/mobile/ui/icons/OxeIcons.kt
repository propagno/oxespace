package com.oxespace.mobile.ui.icons

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/*
 * 1.5.0 F10 CR-A42: the phone's stroke icons on a 24 grid, the #606 / playground icons.ts paths, one ImageVector each.
 * The stroke is drawn in black and the Icon's tint colours it, so no colour lives here. Material icons stay only for
 * the generic actions (back, more, send, check).
 */

private fun strokeIcon(name: String, vararg paths: String): ImageVector {
    val builder = ImageVector.Builder(
        name = name,
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 24f,
        viewportHeight = 24f,
    )
    for (d in paths) {
        builder.addPath(
            pathData = addPathNodes(d),
            stroke = SolidColor(Color.Black),
            strokeLineWidth = 2f,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        )
    }
    return builder.build()
}

private const val CIRCLE = "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0"

object OxeIcons {
    /** The info Notice. */
    val Info: ImageVector by lazy { strokeIcon("Info", CIRCLE, "M12 16v-4", "M12 8h0.01") }

    /** The success Notice. */
    val CheckCircle: ImageVector by lazy { strokeIcon("CheckCircle", CIRCLE, "M9 12l2 2l4 -4") }

    /** The warning Notice and the "No undo." line. */
    val Warning: ImageVector by lazy {
        strokeIcon(
            "Warning",
            "M21.73 18l-8 -14a2 2 0 0 0 -3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73 -3z",
            "M12 9v4",
            "M12 17h0.01",
        )
    }

    /** The danger Notice. */
    val Danger: ImageVector by lazy { strokeIcon("Danger", CIRCLE, "M15 9l-6 6", "M9 9l6 6") }

    /** The empty lists. */
    val Inbox: ImageVector by lazy {
        strokeIcon(
            "Inbox",
            "M22 12h-6l-2 3h-4l-2 -3H2",
            "M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2 -2v-6l-3.45 -6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0 -1.79 1.11z",
        )
    }

    /** The computer (Home's computer card, the request's "where"). */
    val Monitor: ImageVector by lazy {
        strokeIcon("Monitor", "M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2H4a2 2 0 0 1 -2 -2V5a2 2 0 0 1 2 -2z", "M8 21h8", "M12 17v4")
    }

    val Wifi: ImageVector by lazy {
        strokeIcon("Wifi", "M12 20h0.01", "M2 8.82a15 15 0 0 1 20 0", "M5 12.86a10 10 0 0 1 14 0", "M8.5 16.43a5 5 0 0 1 7 0")
    }

    val WifiOff: ImageVector by lazy {
        strokeIcon("WifiOff", "M12 20h0.01", "M8.5 16.43a5 5 0 0 1 7 0", "M5 12.86a10 10 0 0 1 5.17 -2.69", "M2 8.82a15 15 0 0 1 4.18 -2.65", "M2 2l20 20")
    }

    val Qr: ImageVector by lazy {
        strokeIcon(
            "Qr",
            "M4 3h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1H4a1 1 0 0 1 -1 -1V4a1 1 0 0 1 1 -1z",
            "M16 3h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1V4a1 1 0 0 1 1 -1z",
            "M4 15h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1H4a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1z",
            "M21 16h-3a2 2 0 0 0 -2 2v3",
            "M21 21v0.01",
            "M12 7v3a2 2 0 0 1 -2 2H7",
            "M3 12h0.01",
            "M12 3h0.01",
            "M12 16v0.01",
            "M16 12h1",
            "M21 12v0.01",
            "M12 21v-1",
        )
    }

    val Fingerprint: ImageVector by lazy {
        strokeIcon(
            "Fingerprint",
            "M12 10a2 2 0 0 0 -2 2c0 1.02 -0.1 2.51 -0.26 4",
            "M14 13.12c0 2.38 0 6.38 -1 8.88",
            "M17.29 21.02c0.12 -0.6 0.43 -2.3 0.5 -3.02",
            "M2 12a10 10 0 0 1 18 -6",
            "M2 16h0.01",
            "M21.8 16c0.2 -2 0.13 -5.35 0 -6",
            "M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 0.34 -2",
            "M8.65 22c0.21 -0.66 0.45 -1.32 0.57 -2",
            "M9 6.8a6 6 0 0 1 9 5.2v2",
        )
    }
}
