package com.oxespace.mobile.notify

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.2 152p1c (phase F1, Jira OXE-382, the phone's session lifecycle). Written by the
 * planner; the executor must not edit it.
 * rigor: source-assertion — a foreground Service and Android's sleep clock can't run on the JVM; the criterion is
 * which clock and which lifecycle hook the code uses.
 *
 * - SessionService: coming back to the foreground (onStartCommand again) never starts a second collector of the status:
 *   the collector starts once (onCreate) or the previous one is cancelled first. Today every return adds one.
 * - The session's waits are measured on SystemClock.elapsedRealtime(), which keeps counting in deep sleep (Doze);
 *   System.nanoTime() stops there, so a token renewal or a back-off measured on it is late after the phone sleeps.
 * Gradle runs unit tests from the module directory (`mobile/android/app`).
 */
class P1cSessionLifecycleTest {
    private fun source(path: String): String = File("src/main/java/com/oxespace/mobile/$path").readText()

    /** The body of `fun <name>(` up to the next `override fun` or the end of the class. */
    private fun body(text: String, name: String): String {
        val start = text.indexOf("fun $name(")
        assertTrue("$name is in the file", start >= 0)
        val next = text.indexOf("override fun", start + 1)
        return text.substring(start, if (next < 0) text.length else next)
    }

    @Test
    fun aReturnToTheForegroundStartsNoSecondStatusCollector() {
        val service = source("notify/SessionService.kt")
        val start = body(service, "onStartCommand")
        val collectsHere = Regex("""\.collect\b""").containsMatchIn(start)
        val cancelsFirst = Regex("""\b\w*[Jj]ob\?\.cancel\(\)""").containsMatchIn(start) || Regex("""if \(\w*[Jj]ob\s*(==\s*null|\?\.isActive\s*!=\s*true)""").containsMatchIn(start)
        assertTrue("onStartCommand starts the status collector only once (onCreate, or a guarded job)", !collectsHere || cancelsFirst)
        assertTrue("the status is still collected by the service", Regex("""core\.status\.collect""").containsMatchIn(service))
    }

    @Test
    fun theSessionClocksKeepCountingInDeepSleep() {
        val controller = source("session/DesktopSessionController.kt")
        val core = source("session/SessionCore.kt")
        assertFalse("DesktopSessionController measures on System.nanoTime()", controller.contains("System.nanoTime()"))
        assertTrue("DesktopSessionController measures on SystemClock.elapsedRealtime()", controller.contains("elapsedRealtime"))
        assertTrue("SessionCore gives RemoteConnection the elapsedRealtime clock", Regex("""RemoteConnection\([^)]*now\s*=\s*(\{\s*SystemClock\.elapsedRealtime\(\)\s*\}|SystemClock::elapsedRealtime)""").containsMatchIn(core))
    }
}
