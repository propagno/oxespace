package com.oxespace.mobile.ui.settings

import com.oxespace.mobile.notify.AlertChange
import com.oxespace.mobile.notify.AlertKind
import com.oxespace.mobile.notify.AlertTarget
import com.oxespace.mobile.settings.PhonePreferences
import com.oxespace.mobile.settings.PreferenceStore
import com.oxespace.mobile.settings.ThemeChoice
import com.oxespace.mobile.settings.darkThemeFor
import com.oxespace.mobile.settings.filterAlerts
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Frozen acceptance test for 1.5.0 A42 (OXE program, phase F10). Written by the planner; the executor must not edit it.
 * CCR: docs/roadmap-1.5/ccr-phone-screens.md (#688) T-P1.7, Settings (M8): the theme defaults to System, and a
 * notification switch that's off suppresses only that channel's posts. `PhonePreferences` sits on SharedPreferences
 * `phone-prefs` in the app, through [PreferenceStore]; this test uses a map.
 */
class PhonePreferencesTest {
    private class MapStore : PreferenceStore {
        val values = mutableMapOf<String, String>()
        override fun getString(key: String): String? = values[key]
        override fun putString(key: String, value: String) { values[key] = value }
    }

    @Test
    fun theThemeIsSystemByDefaultAndKeepsTheChoice() {
        val store = MapStore()
        assertEquals(ThemeChoice.SYSTEM, PhonePreferences(store).theme)
        PhonePreferences(store).theme = ThemeChoice.DARK
        assertEquals(ThemeChoice.DARK, PhonePreferences(store).theme)
    }

    @Test
    fun aStoredThemeThisAppDoesNotKnowReadsAsSystem() {
        val store = MapStore()
        PhonePreferences(store).theme = ThemeChoice.LIGHT
        store.values.keys.toList().forEach { store.values[it] = "sepia" }
        assertEquals(ThemeChoice.SYSTEM, PhonePreferences(store).theme)
    }

    @Test
    fun systemFollowsThePhoneAndTheOthersDoNot() {
        assertTrue(darkThemeFor(ThemeChoice.SYSTEM, systemDark = true))
        assertFalse(darkThemeFor(ThemeChoice.SYSTEM, systemDark = false))
        assertTrue(darkThemeFor(ThemeChoice.DARK, systemDark = false))
        assertFalse(darkThemeFor(ThemeChoice.LIGHT, systemDark = true))
    }

    @Test
    fun everyNotificationSwitchIsOnByDefault() {
        val prefs = PhonePreferences(MapStore())
        for (kind in AlertKind.entries) assertTrue(kind.name, prefs.alertsEnabled(kind))
    }

    private val posts = listOf(
        AlertChange.Post("r:1", AlertKind.NEEDS_YOU, "Run npm test", "Fix login", AlertTarget.Request("t-1", "r-1")),
        AlertChange.Post("t:2", AlertKind.DONE, "Docs", "", AlertTarget.Thread("t-2")),
        AlertChange.Post("t:3", AlertKind.FAILED, "Build", "", AlertTarget.Thread("t-3")),
    )

    @Test
    fun aSwitchThatIsOffSuppressesOnlyThatChannelsPosts() {
        val prefs = PhonePreferences(MapStore())
        prefs.setAlertsEnabled(AlertKind.DONE, false)
        assertEquals(listOf("r:1", "t:3"), filterAlerts(posts, prefs).map { (it as AlertChange.Post).key })
        prefs.setAlertsEnabled(AlertKind.DONE, true)
        assertEquals(posts, filterAlerts(posts, prefs))
    }

    @Test
    fun aCancelAlwaysGoesThroughSoAnEarlierNotificationStillComesDown() {
        val prefs = PhonePreferences(MapStore())
        for (kind in AlertKind.entries) prefs.setAlertsEnabled(kind, false)
        val cancel = AlertChange.Cancel("r:1")
        assertEquals(listOf(cancel), filterAlerts(posts + cancel, prefs))
    }
}
