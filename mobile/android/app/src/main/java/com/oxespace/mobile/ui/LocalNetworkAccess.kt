package com.oxespace.mobile.ui

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.oxespace.mobile.R
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeSpace

/**
 * Android 17's local network protection. An app that targets API 37 needs `ACCESS_LOCAL_NETWORK` to open a socket to
 * a LAN address. Without it the OS refuses the connection on the phone (EPERM), before anything leaves. The phone
 * only ever talks to the paired computer on the local network, so it asks for this before the QR scan and before the
 * session connects. 1.4.1 never asked: on an Android 17 phone pairing failed at once with "Couldn't reach your
 * computer".
 */
object LocalNetworkAccess {
    const val PERMISSION = "android.permission.ACCESS_LOCAL_NETWORK"

    /** The first Android version that enforces it for an app targeting it. */
    const val FIRST_SDK = 37

    /** Whether this phone asks at all. Older Android doesn't know the permission, so there's nothing to ask. */
    fun required(sdk: Int = Build.VERSION.SDK_INT): Boolean = sdk >= FIRST_SDK

    fun granted(context: Context, sdk: Int = Build.VERSION.SDK_INT): Boolean =
        !required(sdk) || ContextCompat.checkSelfPermission(context, PERMISSION) == PackageManager.PERMISSION_GRANTED

    fun openAppSettings(context: Context) {
        context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)))
    }
}

/** Where the person stands with the permission, as the gate shows it. */
enum class LocalNetworkAsk { NOT_ASKED, DENIED }

/**
 * Shows [content] once local network access is granted, or right away where Android doesn't ask for it. Otherwise
 * it explains why the app needs it and asks. After a refusal it names the permission and offers the app's settings,
 * because Android stops showing its own prompt after the second refusal.
 */
@Composable
fun LocalNetworkGate(onGranted: () -> Unit = {}, content: @Composable () -> Unit) {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(LocalNetworkAccess.granted(context)) }
    var ask by remember { mutableStateOf(LocalNetworkAsk.NOT_ASKED) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { result ->
        granted = result
        if (result) onGranted() else ask = LocalNetworkAsk.DENIED
    }
    // Back from the app's settings with the permission turned on: carry on without another tap.
    LifecycleResumeEffect(Unit) {
        val now = LocalNetworkAccess.granted(context)
        if (now && !granted) { granted = true; onGranted() }
        onPauseOrDispose { }
    }
    if (granted) {
        content()
        return
    }
    LocalNetworkPrompt(
        ask = ask,
        onAllow = { launcher.launch(LocalNetworkAccess.PERMISSION) },
        onOpenSettings = { LocalNetworkAccess.openAppSettings(context) },
    )
}

/** The gate's words and buttons alone, so screenshots can show both states without a permission system. */
@Composable
fun LocalNetworkPrompt(ask: LocalNetworkAsk, onAllow: () -> Unit, onOpenSettings: () -> Unit, modifier: Modifier = Modifier) {
    // Its own surface: the pairing screen puts this where the camera goes, on a dark box, and the words must stay
    // readable there (they were dark on dark) with the button inside the margins.
    Surface(modifier, color = Oxe.colors.surfaceRaised, contentColor = Oxe.colors.textPrimary, shape = RoundedCornerShape(OxeRadius.lg)) {
    Column(Modifier.padding(OxeSpace.space4), verticalArrangement = Arrangement.spacedBy(OxeSpace.space3)) {
        Text(stringResource(R.string.local_network_title), style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
        when (ask) {
            LocalNetworkAsk.NOT_ASKED -> {
                Text(stringResource(R.string.local_network_needed), style = MaterialTheme.typography.bodyLarge)
                Button(onClick = onAllow, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(stringResource(R.string.local_network_allow)) }
            }
            LocalNetworkAsk.DENIED -> {
                Text(stringResource(R.string.local_network_denied), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                OutlinedButton(onClick = onOpenSettings, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(stringResource(R.string.local_network_open_settings)) }
            }
        }
    }
    }
}

/** A paired phone without local network access: nothing else can work, so this is the whole screen until it's granted. */
@Composable
fun LocalNetworkScreen(onGranted: () -> Unit) {
    Surface(Modifier.fillMaxSize(), color = Oxe.colors.surfaceCanvas) {
        Column(Modifier.safeDrawingPadding().padding(OxeSpace.space6)) {
            LocalNetworkGate(onGranted = onGranted) { }
        }
    }
}
