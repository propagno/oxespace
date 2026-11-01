package com.oxespace.mobile.ui.live

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.BuildConfig
import com.oxespace.mobile.R
import com.oxespace.mobile.ui.UnpairDialog
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeSpace

/**
 * The third tab (spec §8): the paired computer and its connection, the app's own language, the version, and unpair.
 * Nothing here reaches the desktop's settings.
 */
@Composable
fun MoreScreen(desktopName: String, connection: String, onEnterAddress: () -> Unit, onUnpair: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var confirmingUnpair by rememberSaveable { mutableStateOf(false) }
    if (confirmingUnpair) UnpairDialog(desktopName, onConfirm = { confirmingUnpair = false; onUnpair() }, onDismiss = { confirmingUnpair = false })
    Column(
        modifier.verticalScroll(rememberScrollState()).padding(OxeSpace.space4),
        verticalArrangement = Arrangement.spacedBy(OxeSpace.space3),
    ) {
        Label(stringResource(R.string.more_desktop))
        Text(desktopName, style = MaterialTheme.typography.titleMedium)
        Label(stringResource(R.string.more_connection))
        Text(connection, style = MaterialTheme.typography.bodyMedium)
        TextButton(onClick = onEnterAddress, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.home_enter_address)) }
        HorizontalDivider(color = Oxe.colors.borderSubtle)
        // Android 13+ keeps a language per app in its own settings (localeConfig); older versions follow the system.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Label(stringResource(R.string.more_language))
            Text(stringResource(R.string.more_language_hint), style = MaterialTheme.typography.bodyMedium, color = Oxe.colors.textSecondary)
            TextButton(
                onClick = { context.startActivity(Intent(Settings.ACTION_APP_LOCALE_SETTINGS, Uri.fromParts("package", context.packageName, null))) },
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.more_language)) }
            HorizontalDivider(color = Oxe.colors.borderSubtle)
        }
        Text(stringResource(R.string.more_version, BuildConfig.VERSION_NAME), style = MaterialTheme.typography.bodyMedium, color = Oxe.colors.textSecondary)
        OutlinedButton(onClick = { confirmingUnpair = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text(stringResource(R.string.home_unpair), color = Oxe.colors.intentDangerFg)
        }
    }
}

@Composable
private fun Label(text: String) {
    Text(text, style = MaterialTheme.typography.labelMedium, color = Oxe.colors.textSecondary, modifier = Modifier.semantics { heading() })
}
