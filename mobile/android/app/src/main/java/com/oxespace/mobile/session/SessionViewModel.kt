package com.oxespace.mobile.session

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.oxespace.mobile.pairing.AndroidKeystoreDeviceKeys
import com.oxespace.mobile.pairing.PreferencesPairedDesktopStore
import com.oxespace.mobile.protocol.session.RemoteConnection
import java.util.concurrent.Executors
import kotlinx.coroutines.flow.StateFlow

/** The session with the paired desktop, across rotations; started and stopped with the visible app. */
class SessionViewModel(application: Application) : AndroidViewModel(application) {
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private val controller = DesktopSessionController(
        scope = viewModelScope,
        store = PreferencesPairedDesktopStore(application),
        keysFor = { alias -> AndroidKeystoreDeviceKeys(application, alias) },
        linkFor = { target, keys, tokens -> RemoteConnection(target, keys::sign, tokens, scheduler) },
    )

    val status: StateFlow<DesktopStatus> = controller.status

    fun start() = controller.start()
    fun stop() = controller.stop()
    fun retry() = controller.retry()
    fun unpair() = controller.unpair()
    fun setManualHost(host: String): Boolean = controller.setManualHost(host)

    override fun onCleared() {
        controller.stop()
        scheduler.shutdownNow()
    }
}
