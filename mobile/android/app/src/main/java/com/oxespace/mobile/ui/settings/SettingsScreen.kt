package com.oxespace.mobile.ui.settings

import android.content.Context
import android.content.SharedPreferences
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.content.edit
import com.oxespace.mobile.R
import com.oxespace.mobile.approval.CRITICAL_ALLOW_HOLD_MS
import com.oxespace.mobile.notify.AlertKind
import com.oxespace.mobile.settings.PhonePreferences
import com.oxespace.mobile.settings.PreferenceStore
import com.oxespace.mobile.settings.ThemeChoice
import com.oxespace.mobile.ui.UnpairDialog
import com.oxespace.mobile.ui.components.OxeButton
import com.oxespace.mobile.ui.components.OxeButtonKind
import com.oxespace.mobile.ui.components.OxeIconButton
import com.oxespace.mobile.ui.components.OxeSwitch
import com.oxespace.mobile.ui.components.Segmented
import com.oxespace.mobile.ui.components.SettingsCard
import com.oxespace.mobile.ui.components.SettingsRow
import com.oxespace.mobile.ui.icons.OxeIcons
import com.oxespace.mobile.ui.live.TerminalTextSize
import com.oxespace.mobile.ui.live.readTextSize
import com.oxespace.mobile.ui.live.sizeLabel
import com.oxespace.mobile.ui.live.terminalTextSize
import com.oxespace.mobile.ui.live.writeTextSize
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeSpace

/** The SharedPreferences file `phone-prefs` behind [PhonePreferences] in the app. */
class SharedPreferenceStore(private val prefs: SharedPreferences) : PreferenceStore {
    override fun getString(key: String): String? = prefs.getString(key, null)
    override fun putString(key: String, value: String) {
        prefs.edit { putString(key, value) }
    }
}

/** The top page and the two pages its rows open (A13: what they open leaves the top page). */
private enum class SettingsDestination { TOP, TYPING, CANT_CONNECT }

/**
 * The line under the paired computer's name (OXE-179, MARCA 15/11): its OS, "paired <date>" and [connection], joined
 * by " · ". The date is the phone's localized short date (no year in the current year, the medium date with the year
 * otherwise), never ISO. An older desktop sends no OS or pairing date; those parts are left out.
 */
fun computerSubtitle(context: Context, os: String?, pairedAt: Long?, connection: String?, now: Long): String {
    val paired = pairedAt?.let { context.getString(R.string.settings_computer_paired, pairingDate(context, it, now)) }
    return listOfNotNull(os?.trim()?.takeIf { it.isNotEmpty() }, paired, connection?.takeIf { it.isNotBlank() }).joinToString(" · ")
}

private fun pairingDate(context: Context, at: Long, now: Long): String {
    val locale = context.resources.configuration.locales[0]
    val zone = android.icu.util.TimeZone.getDefault()
    fun year(time: Long) = android.icu.util.Calendar.getInstance(zone, locale).apply { timeInMillis = time }.get(android.icu.util.Calendar.YEAR)
    val format = if (year(at) == year(now)) {
        android.icu.text.DateFormat.getInstanceForSkeleton("MMMd", locale)
    } else {
        android.icu.text.DateFormat.getDateInstance(android.icu.text.DateFormat.MEDIUM, locale)
    }
    format.timeZone = zone
    return format.format(java.util.Date(at))
}

/**
 * 1.5.0 F10 CR-A42b, T-P1.7 (M8); 1.5.2 A13 (OXE-102, MOB-3): the phone's own Settings, reached from the header's gear,
 * in seven cards: the paired computer (name, OS, pairing date, connection, and Unpair, which asks first); Answers, the
 * safety rules the phone states (presence on every answer, the critical requests' hold), never a switch; one switch per
 * notification kind; the theme; Typing in terminals and Can't connect?, rows that open their own page (the terminal's
 * text size; the computer's address); and what the app is. Nothing here reaches the computer: no approvals, logins or
 * secrets.
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
    var destination by remember { mutableStateOf(SettingsDestination.TOP) }
    if (confirmingUnpair && computer != null && onUnpair != null) {
        UnpairDialog(computer, onConfirm = { confirmingUnpair = false; onUnpair() }, onDismiss = { confirmingUnpair = false })
    }
    val alerts = remember { AlertKind.entries.associateWith { mutableStateOf(preferences.alertsEnabled(it)) } }
    val toTop = { destination = SettingsDestination.TOP }
    if (destination != SettingsDestination.TOP && LocalOnBackPressedDispatcherOwner.current != null) BackHandler(onBack = toTop)
    val pageTitle = when (destination) {
        SettingsDestination.TOP -> R.string.settings_title
        SettingsDestination.TYPING -> R.string.settings_typing_title
        SettingsDestination.CANT_CONNECT -> R.string.settings_cant_connect_title
    }
    Scaffold(
        containerColor = Oxe.colors.surfaceCanvas,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(pageTitle), modifier = Modifier.semantics { heading() }) },
                navigationIcon = {
                    OxeIconButton(
                        icon = ImageVector.vectorResource(R.drawable.ic_back),
                        contentDescription = stringResource(R.string.settings_back),
                        onClick = { if (destination == SettingsDestination.TOP) onBack() else toTop() },
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Oxe.colors.surfaceChrome),
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space3),
            verticalArrangement = Arrangement.spacedBy(OxeSpace.space2),
        ) {
            when (destination) {
                SettingsDestination.TOP -> {
                    // (1) The computer.
                    if (computer != null) {
                        SettingsCard {
                            SettingsRow(
                                title = computer,
                                text = connection,
                                leading = { Icon(OxeIcons.Monitor, contentDescription = stringResource(R.string.settings_computer_title), tint = Oxe.colors.textSecondary, modifier = Modifier.size(22.dp)) },
                            )
                        }
                        if (onUnpair != null) {
                            OxeButton(
                                stringResource(R.string.settings_computer_unpair),
                                onClick = { confirmingUnpair = true },
                                modifier = Modifier.fillMaxWidth(),
                                kind = OxeButtonKind.DANGER,
                            )
                        }
                    }
                    // (2) Answers: rules the phone states, not preferences. No switch, no tap target.
                    val seconds = (CRITICAL_ALLOW_HOLD_MS / 1000L).toInt()
                    SettingsCard(title = stringResource(R.string.settings_answers_title), icon = OxeIcons.Fingerprint) {
                        SettingsRow(
                            title = stringResource(R.string.settings_answers_presence),
                            text = stringResource(R.string.settings_answers_presence_body),
                            trailing = { Text(stringResource(R.string.settings_answers_always), style = MaterialTheme.typography.labelLarge, color = Oxe.colors.textSecondary) },
                        )
                        SettingsRow(
                            title = stringResource(R.string.settings_answers_critical),
                            text = stringResource(R.string.settings_answers_critical_body, seconds),
                        )
                    }
                    // (3) Notifications: one switch per kind (CR-A42b-2: a SettingsRow with its OxeSwitch).
                    SettingsCard(title = stringResource(R.string.settings_alerts_title), icon = OxeIcons.Bell) {
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
                    // (4) Appearance: the theme as a Segmented.
                    SettingsCard(title = stringResource(R.string.settings_theme_title), icon = OxeIcons.Appearance) {
                        val choices = ThemeChoice.entries
                        Segmented(
                            options = choices.map { stringResource(themeLabel(it)) },
                            selected = choices.indexOf(theme),
                            onSelect = { i -> theme = choices[i]; preferences.theme = choices[i] },
                            modifier = Modifier.padding(horizontal = OxeSpace.space3, vertical = OxeSpace.space2),
                        )
                    }
                    // (5) Typing in terminals and (6) Can't connect?: rows that open their own page.
                    SettingsCard {
                        SettingsRow(
                            title = stringResource(R.string.settings_typing_title),
                            text = stringResource(R.string.terminal_text_size),
                            modifier = Modifier.clickable(role = Role.Button) { destination = SettingsDestination.TYPING },
                            leading = { RowIcon(OxeIcons.Keyboard) },
                            trailing = { Chevron() },
                        )
                        SettingsRow(
                            title = stringResource(R.string.settings_cant_connect_title),
                            modifier = Modifier.clickable(role = Role.Button) { destination = SettingsDestination.CANT_CONNECT },
                            leading = { RowIcon(OxeIcons.WifiOff) },
                            trailing = { Chevron() },
                        )
                    }
                    // (7) About.
                    SettingsCard(title = stringResource(R.string.settings_about_title), icon = OxeIcons.Info) {
                        SettingsRow(title = stringResource(R.string.settings_about_app), text = version?.let { stringResource(R.string.settings_about_version, it) })
                    }
                }
                SettingsDestination.TYPING -> {
                    // The same choice as "Aa" on a terminal, here where the person looks for it.
                    SettingsCard(title = stringResource(R.string.terminal_text_size), icon = OxeIcons.Keyboard) {
                        val sizes = TerminalTextSize.entries
                        Segmented(
                            options = sizes.map { stringResource(sizeLabel(it)) },
                            selected = sizes.indexOf(textSize),
                            onSelect = { i -> textSize = sizes[i]; writeTextSize(context, sizes[i]) },
                            modifier = Modifier.padding(horizontal = OxeSpace.space3, vertical = OxeSpace.space2),
                        )
                    }
                }
                SettingsDestination.CANT_CONNECT -> {
                    SettingsCard {
                        Text(
                            stringResource(R.string.settings_about_same_wifi),
                            style = MaterialTheme.typography.bodyMedium,
                            color = Oxe.colors.textSecondary,
                            modifier = Modifier.padding(horizontal = OxeSpace.space4, vertical = OxeSpace.space3),
                        )
                        if (onEnterAddress != null) {
                            SettingsRow(
                                title = stringResource(R.string.home_enter_address),
                                modifier = Modifier.clickable(role = Role.Button, onClick = onEnterAddress),
                                leading = { RowIcon(OxeIcons.Monitor) },
                                trailing = { Chevron() },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RowIcon(icon: ImageVector) {
    Icon(icon, contentDescription = null, tint = Oxe.colors.textSecondary, modifier = Modifier.size(22.dp))
}

@Composable
private fun Chevron() {
    Icon(OxeIcons.ChevronRight, contentDescription = null, tint = Oxe.colors.textMuted, modifier = Modifier.size(20.dp))
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
