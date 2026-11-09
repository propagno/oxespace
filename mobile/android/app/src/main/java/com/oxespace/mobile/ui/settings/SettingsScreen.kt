package com.oxespace.mobile.ui.settings

import android.content.SharedPreferences
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.R
import com.oxespace.mobile.notify.AlertKind
import com.oxespace.mobile.settings.PhonePreferences
import com.oxespace.mobile.settings.PreferenceStore
import com.oxespace.mobile.settings.ThemeChoice
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeSpace

/** The SharedPreferences file `phone-prefs` behind [PhonePreferences] in the app. */
class SharedPreferenceStore(private val prefs: SharedPreferences) : PreferenceStore {
    override fun getString(key: String): String? = prefs.getString(key, null)
    override fun putString(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }
}

/**
 * 1.5.0 F10 CR-A42b, T-P1.7 (M8): the phone's own Settings, reached from the app bar menu. The theme (System, Light,
 * Dark) and one switch per notification kind. Nothing here reaches the computer: no approvals, logins or secrets.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(preferences: PhonePreferences, onBack: () -> Unit) {
    var theme by remember { mutableStateOf(preferences.theme) }
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
            Section(stringResource(R.string.settings_theme_title))
            Column(Modifier.selectableGroup()) {
                for (choice in ThemeChoice.entries) {
                    val selected = theme == choice
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 56.dp)
                            .selectable(selected = selected, role = Role.RadioButton) { theme = choice; preferences.theme = choice }
                            .padding(horizontal = OxeSpace.space4),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(OxeSpace.space3),
                    ) {
                        RadioButton(selected = selected, onClick = null)
                        Text(stringResource(themeLabel(choice)), style = MaterialTheme.typography.bodyLarge, color = Oxe.colors.textPrimary)
                    }
                }
            }
            HorizontalDivider(color = Oxe.colors.borderSubtle, modifier = Modifier.padding(vertical = OxeSpace.space2))
            Section(stringResource(R.string.settings_alerts_title))
            for (kind in AlertKind.entries) {
                val on = alerts.getValue(kind)
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 56.dp)
                        .toggleable(value = on.value, role = Role.Switch) { value -> on.value = value; preferences.setAlertsEnabled(kind, value) }
                        .padding(horizontal = OxeSpace.space4),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(OxeSpace.space3),
                ) {
                    Text(stringResource(alertLabel(kind)), style = MaterialTheme.typography.bodyLarge, color = Oxe.colors.textPrimary, modifier = Modifier.weight(1f))
                    Switch(
                        checked = on.value,
                        onCheckedChange = null,
                        colors = SwitchDefaults.colors(checkedTrackColor = Oxe.colors.accent, checkedThumbColor = Oxe.colors.textOnAccent),
                    )
                }
            }
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
