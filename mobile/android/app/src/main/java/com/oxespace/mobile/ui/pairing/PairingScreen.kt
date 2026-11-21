package com.oxespace.mobile.ui.pairing

import com.oxespace.mobile.ui.theme.OxeFonts
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.oxespace.mobile.R
import com.oxespace.mobile.pairing.PairingFailure
import com.oxespace.mobile.pairing.PairingState
import com.oxespace.mobile.protocol.pairing.PairingQrProblem
import com.oxespace.mobile.ui.SecureScreen
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeSpace
import com.oxespace.mobile.ui.theme.OxeTheme
import com.oxespace.mobile.ui.components.CodeBoxes
import com.oxespace.mobile.ui.components.Notice
import com.oxespace.mobile.ui.components.PairingStepper
import com.oxespace.mobile.ui.components.Viewfinder
import com.oxespace.mobile.ui.components.NoticeIntent
import com.oxespace.mobile.ui.components.OxeButton
import com.oxespace.mobile.ui.components.OxeButtonKind
import com.oxespace.mobile.ui.icons.OxeIcons
import com.oxespace.mobile.ui.live.LocalClock
import kotlinx.coroutines.delay

/** Minimum touch target, for TalkBack and thumbs alike. */
private val TouchTarget = 48.dp

/** The code's time left ticks once a second. */
private const val TICK_MS = 1_000L

/** A14 (MOB-7): Back at the left of the title, on every pairing state, above the steps. */
@Composable
private fun TopBar(onBack: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(OxeSpace.space2),
    ) {
        IconButton(onClick = onBack, modifier = Modifier.size(TouchTarget)) {
            Icon(OxeIcons.ArrowLeft, contentDescription = stringResource(R.string.pairing_back), tint = Oxe.colors.textPrimary)
        }
        Text(
            stringResource(R.string.pairing_title),
            style = MaterialTheme.typography.titleMedium,
            color = Oxe.colors.textPrimary,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
    }
}

/**
 * A14 (OXE-179 CA-2): ms left on the code, from the QR's `exp` and LocalClock, ticking each second; null when the
 * desktop sent no expiry (an older one).
 */
@Composable
private fun codeTimeLeft(expiresAt: Long?): Long? {
    if (expiresAt == null) return null
    val read = LocalClock.current
    var now by remember(expiresAt, read) { mutableLongStateOf(read()) }
    LaunchedEffect(expiresAt, read) {
        while (now < expiresAt) {
            delay(TICK_MS)
            now = read()
        }
    }
    return expiresAt - now
}

/** The whole seconds left, rounded up, as m:ss ("2:00", "0:07"). */
private fun minutesSeconds(leftMs: Long): String {
    val seconds = (leftMs.coerceAtLeast(0L) + 999) / 1000
    return "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
}

@Composable
fun PairingScreen(state: PairingState, onScanAgain: () -> Unit, onDone: () -> Unit, camera: @Composable (Modifier) -> Unit) {
    // A14: Back and Cancel do what the phone's Back does, so MainActivity's BackHandler leaves pairing.
    val dispatcher = LocalOnBackPressedDispatcherOwner.current?.onBackPressedDispatcher
    val onBack: () -> Unit = { dispatcher?.onBackPressed() }
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(OxeSpace.space6),
            verticalArrangement = Arrangement.spacedBy(OxeSpace.space4),
        ) {
            TopBar(onBack)
            // CR-A42b-2 (M2): the four steps above every state; a failure marks the step it happened at.
            PairingStepper(
                labels = listOf(
                    stringResource(R.string.pairing_step_scan),
                    stringResource(R.string.pairing_step_connect),
                    stringResource(R.string.pairing_step_confirm),
                    stringResource(R.string.pairing_step_done),
                ),
                current = stepOf(state),
                failed = state is PairingState.Failed,
            )
            when (state) {
                PairingState.Scanning, is PairingState.BadCode -> Scanning(state as? PairingState.BadCode, camera)
                is PairingState.AskingLocalNetwork -> AskingLocalNetwork(camera)
                is PairingState.Contacting -> Contacting(state)
                is PairingState.Waiting -> Waiting(state, onScanAgain = onScanAgain, onCancel = onBack)
                is PairingState.Paired -> Result(
                    title = stringResource(R.string.pairing_paired_title),
                    body = stringResource(R.string.pairing_paired_body, state.desktop.desktopName ?: stringResource(R.string.home_unknown_desktop)),
                    action = stringResource(R.string.pairing_done),
                    onAction = onDone,
                )
                is PairingState.Failed -> Failure(stringResource(failureText(state.failure)), action = stringResource(R.string.pairing_scan_again), onAction = onScanAgain)
            }
        }
    }
}

@Composable
private fun Title(text: String) {
    Text(text, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
}

@Composable
private fun Scanning(badCode: PairingState.BadCode?, camera: @Composable (Modifier) -> Unit) {
    // The camera preview shows the desktop's pairing QR, a one-time secret: not for a screen recording either.
    SecureScreen()
    Text(stringResource(R.string.pairing_instructions), style = MaterialTheme.typography.bodyLarge)
    // CR-A42b-2 (M2): the camera in the viewfinder; its guides turn to warning when the last code was wrong.
    Viewfinder(warning = badCode != null, modifier = Modifier.fillMaxWidth().aspectRatio(1f)) { inside -> camera(inside) }
    if (badCode != null) {
        // A code that isn't a pairing code is a problem, so it's a Notice (MG5).
        Notice(NoticeIntent.WARNING, title = stringResource(badCodeText(badCode.problem)), modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    }
}

/**
 * A15 (MOB-1): step 2 (Conectar), before the phone first talks to the computer. The camera's dark area holds the
 * slot, where MainActivity puts the local network prompt instead of the camera.
 */
@Composable
private fun AskingLocalNetwork(camera: @Composable (Modifier) -> Unit) {
    Box(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(OxeRadius.xl)).background(Oxe.colors.termBg).padding(OxeSpace.space4),
    ) {
        camera(Modifier.fillMaxWidth())
    }
}

/** Reaching the desktop: no code yet, because the computer can't be asking before it has the request. */
@Composable
private fun Contacting(state: PairingState.Contacting) {
    val desktop = state.desktopName ?: stringResource(R.string.home_unknown_desktop)
    Title(stringResource(R.string.pairing_contacting_title, desktop))
    Text(stringResource(R.string.pairing_contacting_body), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    Box(modifier = Modifier.fillMaxWidth().padding(vertical = OxeSpace.space6), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
}

@Composable
private fun Waiting(state: PairingState.Waiting, onScanAgain: () -> Unit, onCancel: () -> Unit) {
    // The verification code is what the person compares with the desktop: not for Recents or a screen recording.
    SecureScreen()
    val left = codeTimeLeft(state.expiresAt)
    if (left != null && left <= 0L) {
        // A14: at 0 the code and its countdown go; the existing lapsed text and a new code take over.
        Text(stringResource(R.string.home_lapsed), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        OxeButton(stringResource(R.string.pairing_scan_again), onClick = onScanAgain, modifier = Modifier.fillMaxWidth())
        return
    }
    val desktop = state.desktopName ?: stringResource(R.string.home_unknown_desktop)
    Title(stringResource(R.string.pairing_waiting_title))
    Text(stringResource(R.string.pairing_waiting_body, desktop), style = MaterialTheme.typography.bodyLarge)
    Box(modifier = Modifier.fillMaxWidth().padding(vertical = OxeSpace.space6), contentAlignment = Alignment.Center) {
        if (state.verification.isEmpty()) {
            CircularProgressIndicator()
        } else {
            // Read character by character, so "28T5CY" isn't spoken as a word.
            val spoken = stringResource(R.string.pairing_verification_description, state.verification.toList().joinToString(" "))
            CodeBoxes(state.verification, spoken)
        }
    }
    Text(
        stringResource(R.string.pairing_waiting_computer),
        style = MaterialTheme.typography.bodyMedium,
        color = Oxe.colors.textSecondary,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
    )
    if (left != null) {
        // m:ss in tabular digits, so the line doesn't jitter as it ticks.
        Text(
            stringResource(R.string.pairing_code_expires_in, minutesSeconds(left)),
            style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"),
            color = Oxe.colors.textSecondary,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
    OxeButton(stringResource(R.string.pairing_cancel), onClick = onCancel, modifier = Modifier.fillMaxWidth(), kind = OxeButtonKind.SECONDARY)
}

@Composable
private fun Result(title: String?, body: String, action: String, onAction: () -> Unit) {
    if (title != null) Title(title)
    Text(body, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    OxeButton(action, onClick = onAction, modifier = Modifier.fillMaxWidth())
}

/** A pairing that failed: a danger Notice that says why, with the one way forward. */
@Composable
private fun Failure(reason: String, action: String, onAction: () -> Unit) {
    Notice(NoticeIntent.DANGER, title = reason, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    OxeButton(action, onClick = onAction, modifier = Modifier.fillMaxWidth())
}

/** Asks for the camera, then shows it; explains a refusal and offers the system settings. */
@Composable
fun CameraWithPermission(description: String, onText: (String) -> Unit, modifier: Modifier) {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var asked by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { result ->
        granted = result
        asked = true
    }
    if (granted) {
        QrScanner(description, onText, modifier)
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(OxeSpace.space3)) {
        Text(stringResource(if (asked) R.string.pairing_camera_denied else R.string.pairing_camera_needed), style = MaterialTheme.typography.bodyLarge)
        if (asked) {
            OxeButton(
                stringResource(R.string.pairing_open_settings),
                onClick = { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))) },
                modifier = Modifier.fillMaxWidth(),
                kind = OxeButtonKind.SECONDARY,
            )
        } else {
            OxeButton(stringResource(R.string.pairing_allow_camera), onClick = { launcher.launch(Manifest.permission.CAMERA) }, modifier = Modifier.fillMaxWidth())
        }
    }
}

/** Which of the four steps a pairing is at; a failure is placed at the step it happened at. */
private fun stepOf(state: PairingState): Int = when (state) {
    PairingState.Scanning, is PairingState.BadCode -> 0
    is PairingState.AskingLocalNetwork -> 1
    is PairingState.Contacting -> 1
    is PairingState.Waiting -> 2
    is PairingState.Paired -> 4
    is PairingState.Failed -> when (state.failure) {
        PairingFailure.CODE_EXPIRED, PairingFailure.CODE_USED, PairingFailure.CODE_INVALID, PairingFailure.REFUSED_ON_DESKTOP,
        PairingFailure.TOO_MANY_DEVICES, PairingFailure.RESERVED_NAME, PairingFailure.LOCKED -> 2
        else -> 1
    }
}

private fun badCodeText(problem: PairingQrProblem): Int = when (problem) {
    PairingQrProblem.NOT_PAIRING -> R.string.pairing_bad_code_not_pairing
    PairingQrProblem.UNSUPPORTED_VERSION -> R.string.pairing_bad_code_unsupported_version
    PairingQrProblem.PUBLIC_HOST -> R.string.pairing_bad_code_public_host
    PairingQrProblem.MALFORMED -> R.string.pairing_bad_code_malformed
}

private fun failureText(failure: PairingFailure): Int = when (failure) {
    PairingFailure.CODE_EXPIRED -> R.string.pairing_failed_code_expired
    PairingFailure.CODE_USED -> R.string.pairing_failed_code_used
    PairingFailure.CODE_INVALID -> R.string.pairing_failed_code_invalid
    PairingFailure.REFUSED_ON_DESKTOP -> R.string.pairing_failed_refused_on_desktop
    PairingFailure.LOCKED -> R.string.pairing_failed_locked
    PairingFailure.TOO_MANY_DEVICES -> R.string.pairing_failed_too_many_devices
    PairingFailure.WRONG_CERTIFICATE -> R.string.pairing_failed_wrong_certificate
    PairingFailure.LOCAL_NETWORK_BLOCKED -> R.string.pairing_failed_local_network_blocked
    PairingFailure.REFUSED_BY_COMPUTER -> R.string.pairing_failed_refused_by_computer
    PairingFailure.TIMED_OUT -> R.string.pairing_failed_timed_out
    PairingFailure.UNREACHABLE -> R.string.pairing_failed_unreachable
    PairingFailure.PROTOCOL -> R.string.pairing_failed_protocol
    PairingFailure.RESERVED_NAME -> R.string.pairing_failed_reserved_name
}

@Preview
@Composable
private fun WaitingPreview() {
    OxeTheme { PairingScreen(PairingState.Waiting("Studio", "28T5CY"), {}, {}, camera = {}) }
}
