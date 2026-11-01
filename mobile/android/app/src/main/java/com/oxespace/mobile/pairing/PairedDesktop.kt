package com.oxespace.mobile.pairing

import android.content.Context
import androidx.core.content.edit
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

/**
 * What the phone keeps about the desktop it paired with. No token is ever stored: access tokens live in memory and
 * a new one is earned with the device key. `host` is where it answered last; the pin decides who it is.
 */
@Serializable
data class PairedDesktop(
    val deviceId: String,
    val host: String,
    val port: Int,
    val fingerprint: String,
    val desktopName: String?,
    val keyAlias: String,
    /** An address the person typed, for networks where the last one changed; tried after it. */
    val manualHost: String? = null,
)

interface PairedDesktopStore {
    fun load(): PairedDesktop?
    fun save(desktop: PairedDesktop)
    fun clear()
}

/** One paired desktop, in app-private preferences that every backup excludes (see data_extraction_rules.xml). */
class PreferencesPairedDesktopStore(context: Context) : PairedDesktopStore {
    private val preferences = context.getSharedPreferences("paired-desktop", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    override fun load(): PairedDesktop? {
        val text = preferences.getString(KEY, null) ?: return null
        return try {
            json.decodeFromString(PairedDesktop.serializer(), text)
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    override fun save(desktop: PairedDesktop) {
        preferences.edit { putString(KEY, json.encodeToString(PairedDesktop.serializer(), desktop)) }
    }

    override fun clear() {
        preferences.edit { remove(KEY) }
    }

    private companion object {
        const val KEY = "desktop"
    }
}
