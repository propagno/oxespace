package com.oxespace.mobile.session

import android.content.Context
import com.oxespace.mobile.notify.AlertChange
import com.oxespace.mobile.notify.AlertWatcher
import com.oxespace.mobile.notify.Notifications
import com.oxespace.mobile.pairing.AndroidKeystoreDeviceKeys
import com.oxespace.mobile.pairing.PreferencesPairedDesktopStore
import com.oxespace.mobile.protocol.session.RemoteConnection
import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * The phone's one session with its paired desktop, for the whole process: the screens observe it and the
 * foreground service keeps it alive in the background. It also turns the live lists into notifications, which are
 * held back while the app is on screen (the badge and the lists already show it all).
 */
class SessionCore(context: Context) {
    private val app = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private val network = NetworkMonitor(app)
    private val alerts = AlertWatcher()
    private val store = PreferencesPairedDesktopStore(app)

    val notifications = Notifications(app).also { it.createChannels() }
    val live = LiveRepository()
    private val controller = DesktopSessionController(
        scope = scope,
        store = store,
        keysFor = { alias -> AndroidKeystoreDeviceKeys(app, alias) },
        linkFor = { target, keys, tokens -> RemoteConnection(target, keys::sign, tokens, scheduler, streams = live.streams) },
        onLan = network.onLan,
    )

    val status: StateFlow<DesktopStatus> = controller.status

    /** True while one of the app's screens is visible. */
    @Volatile var inForeground = false

    init {
        scope.launch {
            live.pendingRequests.items.collect { requests -> alerts.onRequests(requests).forEach(::notify) }
        }
        scope.launch {
            live.threads.threads.collect { threads -> alerts.onThreads(threads).forEach(::notify) }
        }
    }

    private fun notify(change: AlertChange) {
        if (change is AlertChange.Post && inForeground) return
        notifications.apply(change)
    }

    fun isPaired(): Boolean = store.load() != null

    fun start() = controller.start()
    fun retry() = controller.retry()
    fun setManualHost(host: String): Boolean = controller.setManualHost(host)

    /** The person chose Disconnect: no session until the app is opened again. */
    fun disconnect() = controller.stop()

    fun unpair() = controller.unpair()
}
