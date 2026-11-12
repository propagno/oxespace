package com.oxespace.mobile.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import com.oxespace.mobile.ui.UnpairDialog
import com.oxespace.mobile.ui.components.OxeButton
import com.oxespace.mobile.ui.components.OxeButtonKind
import com.oxespace.mobile.ui.live.TerminalTextSize
import com.oxespace.mobile.ui.live.readTextSize
import com.oxespace.mobile.ui.live.sizeLabel
import com.oxespace.mobile.ui.live.terminalTextSize
import com.oxespace.mobile.ui.live.writeTextSize
import android.content.SharedPreferences
import androidx.core.content.edit
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.oxespace.mobile.R
import com.oxespace.mobile.notify.AlertKind
import com.oxespace.mobile.settings.PhonePreferences
import com.oxespace.mobile.settings.PreferenceStore
import com.oxespace.mobile.settings.ThemeChoice
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeSpace
import com.oxespace.mobile.ui.components.OxeSwitch
import com.oxespace.mobile.ui.components.Segmented
import com.oxespace.mobile.ui.components.SettingsRow

/** The SharedPreferences file `phone-prefs` behind [PhonePreferences] in the app. */
class SharedPreferenceStore(private val prefs: SharedPreferences) : PreferenceStore {
    override fun getString(key: String): String? = prefs.getString(key, null)
    override fun putString(key: String, value: String) {
        prefs.edit { putString(key, value) }
    }
}

/**
 * 1.5.0 F10 CR-A42b, T-P1.7 (M8): the phone's own Settings, reached from the app bar menu. The theme (System, Light,
 * Dark) and one switch per notification kind. Nothing here reaches the computer: no approvals, logins or secrets.
 * With a paired computer it also shows which one and how the connection is, with the ways out (its address,
 * unpairing, which asks first); the terminal's text size; and what the app is.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    preferences: PhonePreferences,
    computer: String? = null,
    connection: String? = null,
    version: String? = null,
    onEnterAddress: (() -> Unit)? = null,
    onUnpair: (() -> Unit)? = null,
    onBack: () -> Unit,
) {
    var theme by remember { mutableStateOf(preferences.theme) }
    val context = LocalContext.current
    var textSize by remember { mutableStateOf(terminalTextSize(readTextSize(context))) }
    var confirmingUnpair by remember { mutableStateOf(false) }
    if (confirmingUnpair && computer != null && onUnpair != null) {
        UnpairDialog(computer, onConfirm = { confirmingUnpair = false; onUnpair() }, onDismiss = { confirmingUnpair = false })
    }
    val alerts = remember { AlertKind.entries.associateWith { mutableStateOf(preferences.alertsEnabled(it)) } }
    Scaffold(
        containerColor = Oxe.colors.surfaceCanvas,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings_title), modifier = Modifier.semantics { heading() }) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(ImageVector.vectorResource(R.drawable.ic_back), contentDescription = stringResource(R.string.settings_back)) }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Oxe.colors.surfaceChrome),
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(vertical = OxeSpace.space3),
        ) {
            if (computer != null) {
                Section(stringResource(R.string.settings_computer_title))
                SettingsRow(title = computer, text = connection)
                if (onEnterAddress != null) {
                    SettingsRow(title = stringResource(R.string.home_enter_address), modifier = Modifier.clickable(role = Role.Button, onClick = onEnterAddress))
                }
                if (onUnpair != null) {
                    OxeButton(
                        stringResource(R.string.settings_computer_unpair),
                        onClick = { confirmingUnpair = true },
                        modifier = Modifier.padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space2),
                        kind = OxeButtonKind.DANGER,
                    )
                }
                HorizontalDivider(color = Oxe.colors.borderSubtle, modifier = Modifier.padding(vertical = OxeSpace.space2))
            }
            Section(stringResource(R.string.settings_theme_title))
            // CR-A42b-2 (M8): the theme is a Segmented, each notification kind a SettingsRow with its OxeSwitch.
            val choices = ThemeChoice.entries
            Segmented(
                options = choices.map { stringResource(themeLabel(it)) },
                selected = choices.indexOf(theme),
                onSelect = { i -> theme = choices[i]; preferences.theme = choices[i] },
                modifier = Modifier.padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space2),
            )
            HorizontalDivider(color = Oxe.colors.borderSubtle, modifier = Modifier.padding(vertical = OxeSpace.space2))
            Section(stringResource(R.string.settings_alerts_title))
            for (kind in AlertKind.entries) {
                val on = alerts.getValue(kind)
                SettingsRow(
                    title = stringResource(alertLabel(kind)),
                    checked = on.value,
                    onCheckedChange = { value -> on.value = value; preferences.setAlertsEnabled(kind, value) },
                    trailing = { OxeSwitch(on.value) },
                )
            }
            HorizontalDivider(color = Oxe.colors.borderSubtle, modifier = Modifier.padding(vertical = OxeSpace.space2))
            // The same choice as "Aa" on a terminal, here where the person looks for it.
            Section(stringResource(R.string.terminal_text_size))
            val sizes = TerminalTextSize.entries
            Segmented(
                options = sizes.map { stringResource(sizeLabel(it)) },
                selected = sizes.indexOf(textSize),
                onSelect = { i -> textSize = sizes[i]; writeTextSize(context, sizes[i]) },
                modifier = Modifier.padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space2),
            )
            HorizontalDivider(color = Oxe.colors.borderSubtle, modifier = Modifier.padding(vertical = OxeSpace.space2))
            Section(stringResource(R.string.settings_about_title))
            SettingsRow(title = stringResource(R.string.settings_about_app), text = version?.let { stringResource(R.string.settings_about_version, it) })
            Text(
                stringResource(R.string.settings_about_same_wifi),
                style = MaterialTheme.typography.bodySmall,
                color = Oxe.colors.textSecondary,
                modifier = Modifier.padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space2),
            )
        }
    }
}

@Composable
private fun Section(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.titleSmall,
        color = Oxe.colors.textMuted,
        modifier = Modifier.padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space2).semantics { heading() },
    )
}

private fun themeLabel(choice: ThemeChoice): Int = when (choice) {
    ThemeChoice.SYSTEM -> R.string.settings_theme_system
    ThemeChoice.LIGHT -> R.string.settings_theme_light
    ThemeChoice.DARK -> R.string.settings_theme_dark
}

private fun alertLabel(kind: AlertKind): Int = when (kind) {
    AlertKind.NEEDS_YOU -> R.string.settings_alerts_needs_you
    AlertKind.DONE -> R.string.settings_alerts_done
    AlertKind.FAILED -> R.string.settings_alerts_failed
}
