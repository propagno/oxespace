package com.oxespace.mobile.settings

import com.oxespace.mobile.notify.AlertChange
import com.oxespace.mobile.notify.AlertKind

/** Where the phone's own preferences live: SharedPreferences `phone-prefs` in the app, a map in tests. */
interface PreferenceStore {
    fun getString(key: String): String?
    fun putString(key: String, value: String)
}

enum class ThemeChoice { SYSTEM, LIGHT, DARK }

/** The phone's own settings: the theme (System by default) and one switch per notification kind (on by default). */
class PhonePreferences(private val store: PreferenceStore) {
    var theme: ThemeChoice
        get() {
            val stored = store.getString(THEME_KEY) ?: return ThemeChoice.SYSTEM
            return ThemeChoice.entries.firstOrNull { it.name.equals(stored, ignoreCase = true) } ?: ThemeChoice.SYSTEM
        }
        set(value) = store.putString(THEME_KEY, value.name.lowercase())

    /** Only a stored "off" turns a channel off; nothing stored, or a value this app doesn't know, keeps it on. */
    fun alertsEnabled(kind: AlertKind): Boolean = store.getString(alertKey(kind)) != OFF

    fun setAlertsEnabled(kind: AlertKind, on: Boolean) {
        store.putString(alertKey(kind), if (on) ON else OFF)
    }

    private fun alertKey(kind: AlertKind) = "alerts.${kind.name.lowercase()}"

    private companion object {
        const val THEME_KEY = "theme"
        const val ON = "on"
        const val OFF = "off"
    }
}

/** System follows the phone; Light and Dark don't. */
fun darkThemeFor(choice: ThemeChoice, systemDark: Boolean): Boolean = when (choice) {
    ThemeChoice.SYSTEM -> systemDark
    ThemeChoice.LIGHT -> false
    ThemeChoice.DARK -> true
}

/** Drops the posts of a kind that's switched off; a Cancel always goes through. */
fun filterAlerts(changes: List<AlertChange>, prefs: PhonePreferences): List<AlertChange> = changes.filter { change ->
    when (change) {
        is AlertChange.Post -> prefs.alertsEnabled(change.kind)
        is AlertChange.Cancel -> true
    }
}
