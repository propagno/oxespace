package com.oxespace.mobile.notify

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Frozen acceptance test for 1.5.0 CR-A42c (A42, OXE program, phase F10). Written by the planner; the executor must not
 * edit it.
 *
 * rigor: source-assertion. Settings (T-P1.7) stores one switch per notification kind in PhonePreferences, and
 * filterAlerts drops the posts of a kind switched off (PhonePreferencesTest proves that on real code). What is missing
 * is the wiring: SessionCore turns the live lists into notifications and never asks the switches. SessionCore needs an
 * Android Context and this module has no Robolectric, so a JVM test can't run it; this reads its Kotlin, with comments
 * stripped, instead.
 *
 * Red at F10 @ 156eccf1: SessionCore never calls filterAlerts and never reads PhonePreferences.
 */
class AlertSwitchesWiredTest {
    /** Gradle runs unit tests from the module directory (`mobile/android/app`). */
    private val sessionCore = File("src/main/java/com/oxespace/mobile/session/SessionCore.kt")

    /** The file's code with `//` and block comments removed, so a mention in a comment never counts. */
    private fun code(): String {
        assertTrue("SessionCore.kt exists", sessionCore.isFile)
        return sessionCore.readText()
            .replace(Regex("""/\*[\s\S]*?\*/"""), "")
            .lines().joinToString("\n") { line -> line.replace(Regex("""(?<!:)//.*$"""), "") }
    }

    @Test
    fun theRequestAlertsPassThroughTheSettingsSwitches() {
        assertTrue(
            "the alerts of the pending requests go through filterAlerts before they reach the notifier",
            Regex("""filterAlerts\(\s*alerts\.onRequests\(""").containsMatchIn(code()),
        )
    }

    @Test
    fun theConversationAlertsPassThroughTheSettingsSwitches() {
        assertTrue(
            "the alerts of the conversations (done, failed) go through filterAlerts before they reach the notifier",
            Regex("""filterAlerts\(\s*alerts\.onThreads\(""").containsMatchIn(code()),
        )
    }

    @Test
    fun theSwitchesAreReadFromTheFileTheSettingsScreenWrites() {
        val code = code()
        assertTrue("SessionCore reads PhonePreferences", Regex("""(?<![A-Za-z0-9_])PhonePreferences\(""").containsMatchIn(code))
        assertTrue(
            "from SharedPreferences phone-prefs, the file MainActivity gives the Settings screen",
            Regex("""getSharedPreferences\(\s*"phone-prefs"""").containsMatchIn(code),
        )
    }
}
