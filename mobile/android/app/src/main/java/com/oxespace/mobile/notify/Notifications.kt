package com.oxespace.mobile.notify

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.oxespace.mobile.MainActivity
import com.oxespace.mobile.R

/**
 * The app's notifications, one channel per meaning so the person can tune each in the system settings: the quiet
 * "connected" line of the foreground service, "needs you", "finished" and "failed". Taps open the right screen.
 */
class Notifications(private val context: Context) {
    private val manager = NotificationManagerCompat.from(context)

    fun createChannels() {
        val system = context.getSystemService(NotificationManager::class.java)
        system.createNotificationChannels(
            listOf(
                NotificationChannel(SESSION, context.getString(R.string.notify_channel_session), NotificationManager.IMPORTANCE_MIN),
                NotificationChannel(NEEDS_YOU, context.getString(R.string.notify_channel_needs_you), NotificationManager.IMPORTANCE_HIGH),
                NotificationChannel(DONE, context.getString(R.string.notify_channel_done), NotificationManager.IMPORTANCE_DEFAULT),
                NotificationChannel(FAILED, context.getString(R.string.notify_channel_failed), NotificationManager.IMPORTANCE_HIGH),
            ),
        )
    }

    /** The foreground service's line: discreet, silent, no badge. */
    fun session(text: String): Notification =
        NotificationCompat.Builder(context, SESSION)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(text)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setContentIntent(open(null))
            .addAction(0, context.getString(R.string.notify_disconnect), PendingIntent.getService(
                context, 0, Intent(context, SessionService::class.java).setAction(SessionService.ACTION_STOP), PendingIntent.FLAG_IMMUTABLE,
            ))
            .build()

    /** Whether alerts can show: on Android 13+ the person grants POST_NOTIFICATIONS. */
    fun allowed(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun apply(change: AlertChange) {
        when (change) {
            is AlertChange.Cancel -> manager.cancel(change.key, ALERT_ID)
            is AlertChange.Post -> {
                if (!allowed()) return
                val (channel, title) = when (change.kind) {
                    AlertKind.NEEDS_YOU -> NEEDS_YOU to context.getString(R.string.notify_needs_you, change.title)
                    AlertKind.DONE -> DONE to context.getString(R.string.notify_done, change.title)
                    AlertKind.FAILED -> FAILED to context.getString(R.string.notify_failed, change.title)
                }
                // What a locked phone shows instead, on every launcher: the kind of alert, no title, no text.
                val public = NotificationCompat.Builder(context, channel)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setContentTitle(context.getString(channelName(change.kind)))
                    .build()
                val notification = NotificationCompat.Builder(context, channel)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setContentTitle(title)
                    .setContentText(change.text.ifEmpty { null })
                    .setCategory(if (change.kind == AlertKind.NEEDS_YOU) NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_STATUS)
                    // The command or file names stay off the lock screen.
                    .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                    .setPublicVersion(public)
                    .setAutoCancel(true)
                    .setContentIntent(open(change.target, change.key))
                    .build()
                @Suppress("MissingPermission") // checked by allowed()
                manager.notify(change.key, ALERT_ID, notification)
            }
        }
    }

    private fun open(target: AlertTarget?, key: String = "home"): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        when (target) {
            is AlertTarget.Request -> intent.putExtra(EXTRA_THREAD, target.threadId).putExtra(EXTRA_REQUEST, target.requestId)
            is AlertTarget.Thread -> intent.putExtra(EXTRA_THREAD, target.threadId)
            null -> Unit
        }
        return PendingIntent.getActivity(context, requestCode(key), NotificationTaps.sign(intent), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun channelName(kind: AlertKind): Int = when (kind) {
        AlertKind.NEEDS_YOU -> R.string.notify_channel_needs_you
        AlertKind.DONE -> R.string.notify_channel_done
        AlertKind.FAILED -> R.string.notify_channel_failed
    }

    companion object {
        /** One request code per alert key for the process's life, so two alerts never share (and rewrite) one PendingIntent. */
        private val requestCodes = mutableMapOf<String, Int>()

        @Synchronized
        internal fun requestCode(key: String): Int = requestCodes.getOrPut(key) { requestCodes.size + 1 }

        const val SESSION = "session"
        const val NEEDS_YOU = "needs-you"
        const val DONE = "done"
        const val FAILED = "failed"
        const val SESSION_ID = 1
        private const val ALERT_ID = 2
        const val EXTRA_THREAD = "thread"
        const val EXTRA_REQUEST = "request"
    }
}
