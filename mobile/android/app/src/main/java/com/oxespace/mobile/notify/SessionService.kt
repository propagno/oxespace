package com.oxespace.mobile.notify

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.oxespace.mobile.OxeApplication
import com.oxespace.mobile.R
import com.oxespace.mobile.session.DesktopStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Keeps the session with the paired desktop while the app is in the background, so "needs you", "finished" and
 * "failed" reach the person without a cloud. Its own notification is the quiet "connected" line, with Disconnect.
 * It runs while a desktop is paired and stops when the person disconnects, unpairs or is revoked.
 */
class SessionService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val core = (application as OxeApplication).core
        if (intent?.action == ACTION_STOP) {
            core.disconnect()
            stopSelf()
            return START_NOT_STICKY
        }
        ServiceCompat.startForeground(
            this,
            Notifications.SESSION_ID,
            core.notifications.session(lineFor(core.status.value)),
            // The type exists from Android 10; on 9 a foreground service has none.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0,
        )
        scope.launch {
            core.status.collect { status ->
                if (status is DesktopStatus.Unpaired) {
                    stopSelf()
                } else {
                    @Suppress("MissingPermission") // the service's own notification
                    androidx.core.app.NotificationManagerCompat.from(this@SessionService).notify(Notifications.SESSION_ID, core.notifications.session(lineFor(status)))
                }
            }
        }
        core.start()
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun lineFor(status: DesktopStatus): String {
        val name = when (status) {
            is DesktopStatus.Connected -> status.desktopName ?: status.desktop.desktopName
            is DesktopStatus.Connecting -> status.desktop.desktopName
            is DesktopStatus.Reconnecting -> status.desktop.desktopName
            is DesktopStatus.Unreachable -> status.desktop.desktopName
            is DesktopStatus.OffNetwork -> status.desktop.desktopName
            is DesktopStatus.Incompatible -> status.desktop.desktopName
            is DesktopStatus.NotAccepted -> status.desktop.desktopName
            is DesktopStatus.Unpaired -> null
        } ?: getString(R.string.home_unknown_desktop)
        return getString(
            when (status) {
                is DesktopStatus.Connected -> R.string.notify_session_connected
                is DesktopStatus.OffNetwork -> R.string.notify_session_off_network
                is DesktopStatus.Incompatible, is DesktopStatus.NotAccepted -> R.string.notify_session_stopped
                else -> R.string.notify_session_reconnecting
            },
            name,
        )
    }

    companion object {
        const val ACTION_STOP = "com.oxespace.mobile.STOP_SESSION"

        /** From the foreground only: Android doesn't let a backgrounded app start a foreground service. */
        fun start(context: Context) = ContextCompat.startForegroundService(context, Intent(context, SessionService::class.java))
    }
}
