package com.oxespace.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.R
import com.oxespace.mobile.pairing.PairedDesktop
import com.oxespace.mobile.session.DesktopStatus
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeSpace
import com.oxespace.mobile.ui.theme.OxeTheme

private val TouchTarget = 48.dp

/** Says what the app is for and offers pairing; once paired, shows the connection and what to do about it. */
@Composable
fun HomeScreen(
    status: DesktopStatus,
    onPair: () -> Unit,
    onRetry: () -> Unit,
    onManualHost: (String) -> Boolean,
    onUnpair: () -> Unit,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(OxeSpace.space6),
            verticalArrangement = Arrangement.spacedBy(OxeSpace.space3)
        ) {
            when (status) {
                is DesktopStatus.Unpaired -> Unpaired(status, onPair)
                is DesktopStatus.Connecting -> Paired(status.desktop, null, onRetry, onManualHost, onUnpair, connecting = true)
                is DesktopStatus.Connected -> Paired(status.desktop, status.desktopName, onRetry, onManualHost, onUnpair, connecting = false)
                is DesktopStatus.Unreachable -> Paired(status.desktop, null, onRetry, onManualHost, onUnpair, problem = R.string.home_status_unreachable)
                is DesktopStatus.Incompatible -> Paired(status.desktop, null, onRetry, onManualHost, onUnpair, problem = R.string.home_status_incompatible)
                is DesktopStatus.NotAccepted -> Paired(status.desktop, null, onRetry, onManualHost, onUnpair, problem = R.string.home_status_not_accepted)
            }
        }
    }
}

@Composable
private fun Unpaired(status: DesktopStatus.Unpaired, onPair: () -> Unit) {
    if (status.revoked) {
        Text(
            stringResource(R.string.home_revoked, status.revokedFrom ?: stringResource(R.string.home_unknown_desktop)),
            style = MaterialTheme.typography.bodyLarge,
            color = Oxe.colors.intentWarningFg,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
    Text(stringResource(R.string.home_title), style = MaterialTheme.typography.headlineMedium, modifier = Modifier.semantics { heading() })
    Text(stringResource(R.string.home_body), style = MaterialTheme.typography.bodyLarge)
    Button(onClick = onPair, modifier = Modifier.fillMaxWidth().heightIn(min = TouchTarget)) { Text(stringResource(R.string.home_pair)) }
}

@Composable
private fun Paired(
    desktop: PairedDesktop,
    liveName: String?,
    onRetry: () -> Unit,
    onManualHost: (String) -> Boolean,
    onUnpair: () -> Unit,
    connecting: Boolean = false,
    problem: Int? = null,
) {
    val name = liveName ?: desktop.desktopName ?: stringResource(R.string.home_unknown_desktop)
    var askingAddress by rememberSaveable { mutableStateOf(false) }
    Text(stringResource(R.string.home_paired_title, name), style = MaterialTheme.typography.headlineMedium, modifier = Modifier.semantics { heading() })
    val line = when {
        problem != null -> stringResource(problem, name)
        connecting -> stringResource(R.string.home_status_connecting, name)
        else -> stringResource(R.string.home_status_connected, name)
    }
    Text(
        line,
        style = MaterialTheme.typography.bodyLarge,
        color = if (problem != null) Oxe.colors.intentWarningFg else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
    if (connecting) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
    if (problem == null && !connecting) Text(stringResource(R.string.home_paired_body, name), style = MaterialTheme.typography.bodyLarge)
    if (problem != null) {
        Button(onClick = onRetry, modifier = Modifier.fillMaxWidth().heightIn(min = TouchTarget)) { Text(stringResource(R.string.home_retry)) }
        OutlinedButton(onClick = { askingAddress = true }, modifier = Modifier.fillMaxWidth().heightIn(min = TouchTarget)) {
            Text(stringResource(R.string.home_enter_address))
        }
    }
    OutlinedButton(onClick = onUnpair, modifier = Modifier.fillMaxWidth().heightIn(min = TouchTarget)) { Text(stringResource(R.string.home_unpair)) }
    if (askingAddress) AddressDialog(initial = desktop.manualHost.orEmpty(), onSave = onManualHost, onDismiss = { askingAddress = false })
}

@Composable
fun AddressDialog(initial: String, onSave: (String) -> Boolean, onDismiss: () -> Unit) {
    var text by rememberSaveable { mutableStateOf(initial) }
    var invalid by rememberSaveable { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.home_address_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(OxeSpace.space2)) {
                Text(stringResource(R.string.home_address_hint), style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it; invalid = false },
                    label = { Text(stringResource(R.string.home_address_title)) },
                    singleLine = true,
                    isError = invalid,
                    supportingText = if (invalid) ({ Text(stringResource(R.string.home_address_invalid)) }) else null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { if (onSave(text)) onDismiss() else invalid = true }, modifier = Modifier.heightIn(min = TouchTarget)) {
                Text(stringResource(R.string.home_save))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = TouchTarget)) { Text(stringResource(R.string.home_cancel)) }
        },
    )
}

@Preview
@Composable
private fun HomeScreenPreview() {
    OxeTheme {
        HomeScreen(
            status = DesktopStatus.Unreachable(PairedDesktop("d", "192.168.0.12", 7443, "a".repeat(64), "Studio", "k")),
            onPair = {}, onRetry = {}, onManualHost = { true }, onUnpair = {},
        )
    }
}
