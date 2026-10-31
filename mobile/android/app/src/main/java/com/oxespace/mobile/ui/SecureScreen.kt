package com.oxespace.mobile.ui

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import com.oxespace.mobile.BuildConfig

/**
 * Screens that show what the person must keep to themselves: a request's command and paths, the pairing verification
 * code, terminal output. While one is on screen the window is FLAG_SECURE: the Recents thumbnail is blank and screen
 * capture and recording get nothing. Leaving the screen lifts it, so the rest of the app behaves normally.
 *
 * The only way around it is [CaptureForHomologation], and only in a debug build: release builds always protect.
 */
@Composable
fun SecureScreen() {
    val activity = LocalContext.current.findActivity() ?: return
    DisposableEffect(activity) {
        val protect = !CaptureForHomologation.allowed
        if (protect) SecureWindow.acquire(activity)
        onDispose { if (protect) SecureWindow.release(activity) }
    }
}

/** Counts the secure screens showing, so two nested ones don't lift the flag early. */
internal object SecureWindow {
    private val holders = mutableMapOf<Activity, Int>()

    fun acquire(activity: Activity) {
        val count = holders.getOrDefault(activity, 0) + 1
        holders[activity] = count
        if (count == 1) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    fun release(activity: Activity) {
        val count = (holders[activity] ?: return) - 1
        if (count > 0) {
            holders[activity] = count
            return
        }
        holders.remove(activity)
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
}

/**
 * Homologation evidence needs screenshots of those screens. A debug build started with
 * `adb shell am start -n com.oxespace.mobile/.MainActivity --ez allow_capture true` allows them for that process;
 * a release build ignores the extra.
 */
object CaptureForHomologation {
    const val EXTRA = "allow_capture"

    @Volatile var allowed = false
        private set

    fun read(requested: Boolean) {
        allowed = BuildConfig.DEBUG && requested
    }
}

private fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
