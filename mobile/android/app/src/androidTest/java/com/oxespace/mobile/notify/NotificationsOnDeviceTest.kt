package com.oxespace.mobile.notify

import android.Manifest
import android.app.NotificationManager
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** The real notification channels and alerts on a device: one channel per meaning, posted and taken down by key. */
@RunWith(AndroidJUnit4::class)
class NotificationsOnDeviceTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val system = context.getSystemService(NotificationManager::class.java)
    private val notifications = Notifications(context)
    private val key = AlertWatcher.requestKey("t-1", "r-1")

    @Before
    fun grant() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        }
        notifications.createChannels()
    }

    @After
    fun clean() = notifications.apply(AlertChange.Cancel(key))

    @Test
    fun eachMeaningHasItsOwnChannel() {
        assertEquals(NotificationManager.IMPORTANCE_MIN, system.getNotificationChannel(Notifications.SESSION).importance)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, system.getNotificationChannel(Notifications.NEEDS_YOU).importance)
        assertEquals(NotificationManager.IMPORTANCE_DEFAULT, system.getNotificationChannel(Notifications.DONE).importance)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, system.getNotificationChannel(Notifications.FAILED).importance)
    }

    @Test
    fun postsANeedsYouAlertAndTakesItDownWhenAnswered() {
        assertTrue(notifications.allowed())
        notifications.apply(AlertChange.Post(key, AlertKind.NEEDS_YOU, "Run npm test", "Fix login", AlertTarget.Request("t-1", "r-1")))
        // The system posts asynchronously: wait for it to show.
        val posted = waitFor { system.activeNotifications.firstOrNull { it.tag == key } }
        assertEquals(Notifications.NEEDS_YOU, posted.notification.channelId)
        assertTrue(posted.notification.contentIntent != null)
        notifications.apply(AlertChange.Cancel(key))
        waitFor { if (system.activeNotifications.none { it.tag == key }) true else null }
    }

    private fun <T : Any> waitFor(read: () -> T?): T {
        val until = System.currentTimeMillis() + 3_000
        while (System.currentTimeMillis() < until) {
            read()?.let { return it }
            Thread.sleep(50)
        }
        return checkNotNull(read()) { "not seen within 3 s" }
    }
}
