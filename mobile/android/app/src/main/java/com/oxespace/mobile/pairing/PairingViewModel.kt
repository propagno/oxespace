package com.oxespace.mobile.pairing

import android.app.Application
import android.os.Build
import android.provider.Settings
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.oxespace.mobile.protocol.pairing.PairingClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.StateFlow

/** Holds one pairing attempt across rotations; the work happens in [PairingFlow]. */
class PairingViewModel(application: Application) : AndroidViewModel(application) {
    private val client = PairingClient()
    private val flow = PairingFlow(
        scope = viewModelScope,
        io = Dispatchers.IO,
        pairer = client::pair,
        keysFor = { alias -> AndroidKeystoreDeviceKeys(application, alias) },
        store = PreferencesPairedDesktopStore(application),
        deviceName = deviceName(application),
    )

    val state: StateFlow<PairingState> = flow.state

    fun onScanned(text: String) = flow.onScanned(text)

    fun scanAgain() = flow.scanAgain()

    private companion object {
        /** The name the person gave the phone, else its model: what the desktop asks "Pair …?" about. */
        fun deviceName(application: Application): String =
            Settings.Global.getString(application.contentResolver, Settings.Global.DEVICE_NAME)?.takeIf { it.isNotBlank() }
                ?: listOf(Build.MANUFACTURER, Build.MODEL).joinToString(" ").trim()
    }
}
