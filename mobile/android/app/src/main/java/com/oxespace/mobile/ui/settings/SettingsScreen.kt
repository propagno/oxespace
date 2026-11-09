package com.oxespace.mobile.ui.settings

import android.content.SharedPreferences
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
