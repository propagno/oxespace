package com.oxespace.mobile.ui.live

import com.oxespace.mobile.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Frozen acceptance test for 1.5.0 CR-34 (HML-F10-1), the phone side, phase F10. Written by the planner; the executor
 * must not edit it. DESIGN's copy for an open pane that the desktop hid from the phone: an info Notice replaces the
 * screen, with one way back. `%1$s` is the computer's name. The strings come from shared/locales/{en,pt-BR}/mobile.json
 * through npm run android:generate.
 */
class PaneHiddenStringsTest {
    private val english = File("src/main/res/values/strings.xml")
    private val portuguese = File("src/main/res/values-pt-rBR/strings.xml")

    private fun nameOf(id: Int): String = R.string::class.java.fields.first { it.getInt(null) == id }.name

    private fun strings(file: File): Map<String, String> =
        Regex("""<string name="([a-z0-9_]+)">([^<]*)</string>""").findAll(file.readText()).associate { it.groupValues[1] to it.groupValues[2] }

    /** strings.xml escapes an apostrophe; compare the words a person reads. */
    private fun read(value: String?) = value?.replace("\\'", "'")

    @Test
    fun theHiddenNoticeSaysWhereItWasHiddenInBothLanguages() {
        val key = nameOf(R.string.terminal_hidden_on_desktop)
        assertEquals("This terminal was hidden from the phone on %1\$s.", read(strings(english)[key]))
        assertEquals("Este terminal foi ocultado do celular em %1\$s.", read(strings(portuguese)[key]))
    }

    @Test
    fun itsOnlyActionGoesBackToTheTerminals() {
        val key = nameOf(R.string.terminal_hidden_back)
        assertEquals("Back to terminals", read(strings(english)[key]))
        assertEquals("Voltar aos terminais", read(strings(portuguese)[key]))
    }

    @Test
    fun theNoticeNamesNoPaneAndKeepsNoneOfItsText() {
        // Nothing of the pane stays (DESIGN): the words carry the computer's name only, never the pane's title.
        for (file in listOf(english, portuguese)) {
            val text = strings(file)[nameOf(R.string.terminal_hidden_on_desktop)].orEmpty()
            assertTrue(file.path, Regex("""%\d\${'$'}s""").findAll(text).count() == 1)
        }
    }
}
