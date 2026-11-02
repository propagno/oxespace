package com.oxespace.mobile.ui

import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
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
    if (status is DesktopStatus.Unpaired) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(
                modifier = Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(OxeSpace.space6),
                verticalArrangement = Arrangement.spacedBy(OxeSpace.space3)
            ) {
                Unpaired(status, onPair)
            }
        }
        return
    }
    when (status) {
        is DesktopStatus.Unpaired -> Unit
        is DesktopStatus.Connecting -> Paired(status.desktop, null, onRetry, onManualHost, onUnpair, connecting = true)
        is DesktopStatus.Connected -> Paired(status.desktop, status.desktopName, onRetry, onManualHost, onUnpair, connecting = false)
        is DesktopStatus.Reconnecting -> Paired(status.desktop, null, onRetry, onManualHost, onUnpair, connecting = true, connectingText = R.string.home_status_reconnecting)
        is DesktopStatus.Unreachable -> Paired(status.desktop, null, onRetry, onManualHost, onUnpair, problem = R.string.home_status_unreachable, retryInMs = status.retryInMs, offerWifi = true)
        is DesktopStatus.OffNetwork -> Paired(status.desktop, null, onRetry, onManualHost, onUnpair, problem = R.string.home_status_off_network, offerWifi = true)
        is DesktopStatus.Incompatible -> Paired(status.desktop, null, onRetry, onManualHost, onUnpair, problem = R.string.home_status_incompatible)
        // The desktop no longer accepts this key: unpairing is the way forward here, so it stays on the page.
        is DesktopStatus.NotAccepted -> Paired(status.desktop, null, onRetry, onManualHost, onUnpair, problem = R.string.home_status_not_accepted, unpairOnPage = true)
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

/**
 * A paired desktop's page. The app bar keeps its name and the menu (type the address, unpair) on every state; a
 * problem offers the way back first (try again, the phone's Wi-Fi), never only "Desparear", which always asks first.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Paired(
    desktop: PairedDesktop,
    liveName: String?,
    onRetry: () -> Unit,
    onManualHost: (String) -> Boolean,
    onUnpair: () -> Unit,
    connecting: Boolean = false,
    connectingText: Int = R.string.home_status_connecting,
    problem: Int? = null,
    retryInMs: Long? = null,
    offerWifi: Boolean = false,
    unpairOnPage: Boolean = false,
) {
    val name = liveName ?: desktop.desktopName ?: stringResource(R.string.home_unknown_desktop)
    var askingAddress by rememberSaveable { mutableStateOf(false) }
    var confirmingUnpair by rememberSaveable { mutableStateOf(false) }
    var menu by rememberSaveable { mutableStateOf(false) }
    val context = LocalContext.current
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                actions = {
                    Box {
                        IconButton(onClick = { menu = true }) {
                            Icon(ImageVector.vectorResource(R.drawable.ic_more), contentDescription = stringResource(R.string.live_menu))
                        }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text(stringResource(R.string.home_enter_address)) }, onClick = { menu = false; askingAddress = true })
                            DropdownMenuItem(text = { Text(stringResource(R.string.home_unpair)) }, onClick = { menu = false; confirmingUnpair = true })
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(OxeSpace.space6),
            verticalArrangement = Arrangement.spacedBy(OxeSpace.space3),
        ) {
            PairedBody(name, connecting, connectingText, problem, retryInMs, offerWifi, unpairOnPage, onRetry, onWifi = { context.startActivity(wifiSettings()) }, onAddress = { askingAddress = true }, onUnpair = { confirmingUnpair = true })
        }
    }
    if (askingAddress) AddressDialog(initial = desktop.manualHost.orEmpty(), onSave = onManualHost, onDismiss = { askingAddress = false })
    if (confirmingUnpair) UnpairDialog(name, onConfirm = { confirmingUnpair = false; onUnpair() }, onDismiss = { confirmingUnpair = false })
}

@Composable
private fun PairedBody(
    name: String,
    connecting: Boolean,
    connectingText: Int,
    problem: Int?,
    retryInMs: Long?,
    offerWifi: Boolean,
    unpairOnPage: Boolean,
    onRetry: () -> Unit,
    onWifi: () -> Unit,
    onAddress: () -> Unit,
    onUnpair: () -> Unit,
) {
    Text(stringResource(R.string.home_paired_title, name), style = MaterialTheme.typography.headlineMedium, modifier = Modifier.semantics { heading() })
    val line = when {
        problem != null -> stringResource(problem, name)
        connecting -> stringResource(connectingText, name)
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
    retryInMs?.let {
        val seconds = ((it + 999) / 1_000).toInt()
        Text(pluralStringResource(R.plurals.home_status_retry_in, seconds, seconds), style = MaterialTheme.typography.bodyMedium, color = Oxe.colors.textSecondary)
    }
    if (problem != null && !unpairOnPage) {
        Button(onClick = onRetry, modifier = Modifier.fillMaxWidth().heightIn(min = TouchTarget)) { Text(stringResource(R.string.home_retry)) }
        if (offerWifi) {
            OutlinedButton(onClick = onWifi, modifier = Modifier.fillMaxWidth().heightIn(min = TouchTarget)) {
                Text(stringResource(R.string.home_open_wifi))
            }
        }
        TextButton(onClick = onAddress, modifier = Modifier.fillMaxWidth().heightIn(min = TouchTarget)) {
            Text(stringResource(R.string.home_enter_address))
        }
    }
    if (unpairOnPage) {
        OutlinedButton(onClick = onUnpair, modifier = Modifier.fillMaxWidth().heightIn(min = TouchTarget)) { Text(stringResource(R.string.home_unpair)) }
    }
}

/** The phone's Wi-Fi: the quick panel on Android 10+, the Wi-Fi settings page before. */
private fun wifiSettings(): Intent =
    Intent(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) Settings.Panel.ACTION_WIFI else Settings.ACTION_WIFI_SETTINGS)

/** Unpairing forgets the desktop and this phone's key for it; pairing again needs a new QR, so it asks first. */
@Composable
fun UnpairDialog(desktopName: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.home_unpair_confirm_title, desktopName)) },
        text = { Text(stringResource(R.string.home_unpair_confirm_body, desktopName), style = MaterialTheme.typography.bodyMedium) },
        confirmButton = {
            TextButton(onClick = onConfirm, modifier = Modifier.heightIn(min = TouchTarget)) {
                Text(stringResource(R.string.home_unpair), color = Oxe.colors.intentDangerFg)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = TouchTarget)) { Text(stringResource(R.string.home_cancel)) }
        },
    )
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
            status = DesktopStatus.Unreachable(PairedDesktop("d", "192.168.0.12", 7443, "a".repeat(64), "Studio", "k"), retryInMs = 8_000),
            onPair = {}, onRetry = {}, onManualHost = { true }, onUnpair = {},
        )
    }
}
