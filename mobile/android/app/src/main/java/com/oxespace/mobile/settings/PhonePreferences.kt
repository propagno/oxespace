@file:Suppress("UNUSED_PARAMETER", "unused")

package com.oxespace.mobile.settings

import com.oxespace.mobile.notify.AlertChange
import com.oxespace.mobile.notify.AlertKind

/*
 * 1.5.0 F10 API skeleton (A42, Settings M8), no behaviour; MOB-A42 replaces the TODOs. Test: PhonePreferencesTest.
 */

/** Where the phone's own preferences live: SharedPreferences `phone-prefs` in the app, a map in tests. */
interface PreferenceStore {
    fun getString(key: String): String?
    fun putString(key: String, value: String)
}

enum class ThemeChoice { SYSTEM, LIGHT, DARK }

/** The phone's own settings: the theme (System by default) and one switch per notification kind (on by default). */
class PhonePreferences(store: PreferenceStore) {
    var theme: ThemeChoice
        get() = TODO("F10 A42")
        set(value) = TODO("F10 A42")

    fun alertsEnabled(kind: AlertKind): Boolean = TODO("F10 A42")

    fun setAlertsEnabled(kind: AlertKind, on: Boolean) {
        TODO("F10 A42")
    }
}

/** System follows the phone; Light and Dark don't. */
fun darkThemeFor(choice: ThemeChoice, systemDark: Boolean): Boolean = TODO("F10 A42")

/** Drops the posts of a kind that's switched off; a Cancel always goes through. */
fun filterAlerts(changes: List<AlertChange>, prefs: PhonePreferences): List<AlertChange> = TODO("F10 A42")
