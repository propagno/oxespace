package com.oxespace.mobile.notify

import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.oxespace.mobile.MainActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

/** MB-M-07 with real intents: the exported launcher acts on a thread or request id only from the app's own notification. */
@RunWith(AndroidJUnit4::class)
class NotificationTapsOnDeviceTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun tap() = Intent(context, MainActivity::class.java)
        .putExtra(Notifications.EXTRA_THREAD, "t-1")
        .putExtra(Notifications.EXTRA_REQUEST, "r-1")

    @Test
    fun readsOnlyIntentsTheAppSigned() {
        assertEquals(TapTarget("t-1", "r-1"), NotificationTaps.read(NotificationTaps.sign(tap())))
        assertNull("another app's intent", NotificationTaps.read(tap()))
        assertNull(NotificationTaps.read(tap().putExtra("tap", "guess")))
        assertNull(NotificationTaps.read(null))
    }

    @Test
    fun aForeignIntentJustOpensTheApp() {
        // What another app could send: the launcher with ids it chose. The app starts as usual and nothing breaks.
        ActivityScenario.launch<MainActivity>(tap().addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)).use { scenario ->
            scenario.onActivity { activity -> assertEquals(false, activity.isFinishing) }
        }
    }
}
