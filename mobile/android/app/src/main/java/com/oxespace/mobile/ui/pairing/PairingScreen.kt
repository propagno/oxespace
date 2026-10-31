package com.oxespace.mobile.ui.pairing

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeSpace
import com.oxespace.mobile.ui.theme.OxeTheme

/** Minimum touch target, for TalkBack and thumbs alike. */
private val TouchTarget = 48.dp

@Composable
fun PairingScreen(state: PairingState, onScanAgain: () -> Unit, onDone: () -> Unit, camera: @Composable (Modifier) -> Unit) {
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(OxeSpace.space6),
            verticalArrangement = Arrangement.spacedBy(OxeSpace.space4),
        ) {
            when (state) {
                PairingState.Scanning, is PairingState.BadCode -> Scanning(state as? PairingState.BadCode, camera)
                is PairingState.Waiting -> Waiting(state)
                is PairingState.Paired -> Result(
                    title = stringResource(R.string.pairing_paired_title),
                    body = stringResource(R.string.pairing_paired_body, state.desktop.desktopName ?: stringResource(R.string.home_unknown_desktop)),
                    action = stringResource(R.string.pairing_done),
                    onAction = onDone,
                )
                is PairingState.Failed -> Result(title = null, body = stringResource(failureText(state.failure)), action = stringResource(R.string.pairing_scan_again), onAction = onScanAgain)
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
    Title(stringResource(R.string.pairing_title))
    Text(stringResource(R.string.pairing_instructions), style = MaterialTheme.typography.bodyLarge)
    val frame = Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(OxeRadius.lg))
    camera(frame)
    if (badCode != null) {
        Text(
            stringResource(badCodeText(badCode.problem)),
            style = MaterialTheme.typography.bodyLarge,
            color = Oxe.colors.intentWarningFg,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
}

@Composable
private fun Waiting(state: PairingState.Waiting) {
    val desktop = state.desktopName ?: stringResource(R.string.home_unknown_desktop)
    Title(stringResource(R.string.pairing_waiting_title))
    Text(stringResource(R.string.pairing_waiting_body, desktop), style = MaterialTheme.typography.bodyLarge)
    Box(modifier = Modifier.fillMaxWidth().padding(vertical = OxeSpace.space6), contentAlignment = Alignment.Center) {
        if (state.verification.isEmpty()) {
            CircularProgressIndicator()
        } else {
            val spoken = stringResource(R.string.pairing_verification_description, state.verification.toList().joinToString(" "))
            Text(
                state.verification,
                fontFamily = FontFamily.Monospace,
                fontSize = 40.sp,
                letterSpacing = 6.sp,
                color = MaterialTheme.colorScheme.onSurface,
                textAlign = TextAlign.Center,
                // Read character by character, so "28T5CY" isn't spoken as a word.
                modifier = Modifier.clearAndSetSemantics { contentDescription = spoken },
            )
        }
    }
    if (state.verification.isNotEmpty()) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
}

@Composable
private fun Result(title: String?, body: String, action: String, onAction: () -> Unit) {
    if (title != null) Title(title)
    Text(body, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    Button(onClick = onAction, modifier = Modifier.fillMaxWidth().heightIn(min = TouchTarget)) { Text(action) }
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
            OutlinedButton(
                onClick = { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))) },
                modifier = Modifier.fillMaxWidth().heightIn(min = TouchTarget),
            ) { Text(stringResource(R.string.pairing_open_settings)) }
        } else {
            Button(onClick = { launcher.launch(Manifest.permission.CAMERA) }, modifier = Modifier.fillMaxWidth().heightIn(min = TouchTarget)) {
                Text(stringResource(R.string.pairing_allow_camera))
            }
        }
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
    PairingFailure.UNREACHABLE -> R.string.pairing_failed_unreachable
    PairingFailure.PROTOCOL -> R.string.pairing_failed_protocol
}

@Preview
@Composable
private fun WaitingPreview() {
    OxeTheme { PairingScreen(PairingState.Waiting("Studio", "28T5CY"), {}, {}, camera = {}) }
}
