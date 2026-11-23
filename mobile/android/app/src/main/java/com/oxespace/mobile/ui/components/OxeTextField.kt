package com.oxespace.mobile.ui.components

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import com.oxespace.mobile.ui.theme.Oxe
import com.oxespace.mobile.ui.theme.OxeRadius
import com.oxespace.mobile.ui.theme.OxeType

/**
 * Standardized Mandacaru text field built on Material 3 [OutlinedTextField] using [Oxe.colors], [OxeRadius],
 * and [OxeType], with focus styling via `borderFocus` and error styling via `intentDangerSolid`/`intentDangerFg`.
 */
@Composable
fun OxeTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    supportingText: String? = null,
    isError: Boolean = false,
    enabled: Boolean = true,
    readOnly: Boolean = false,
    singleLine: Boolean = false,
    maxLines: Int = if (singleLine) 1 else Int.MAX_VALUE,
    textStyle: TextStyle = MaterialTheme.typography.bodyLarge.copy(
        fontSize = OxeType.textLg,
        fontWeight = OxeType.weightRegular,
    ),
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    val c = Oxe.colors
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier,
        enabled = enabled,
        readOnly = readOnly,
        textStyle = textStyle,
        label = label?.let { { Text(it, style = MaterialTheme.typography.bodyMedium) } },
        placeholder = placeholder?.let { { Text(it, style = textStyle, color = c.textMuted) } },
        supportingText = supportingText?.let {
            {
                Text(
                    it,
                    style = MaterialTheme.typography.labelMedium,
                    color = if (isError) c.intentDangerFg else c.textMuted,
                )
            }
        },
        isError = isError,
        singleLine = singleLine,
        maxLines = maxLines,
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        shape = RoundedCornerShape(OxeRadius.md),
        colors = OutlinedTextFieldDefaults.colors(
            focusedTextColor = c.textPrimary,
            unfocusedTextColor = c.textPrimary,
            disabledTextColor = c.textDisabled,
            errorTextColor = c.textPrimary,
            focusedContainerColor = c.surfaceRaised,
            unfocusedContainerColor = c.surfaceRaised,
            disabledContainerColor = c.surfaceSunken,
            errorContainerColor = c.surfaceRaised,
            cursorColor = c.accent,
            errorCursorColor = c.intentDangerSolid,
            focusedBorderColor = c.borderFocus,
            unfocusedBorderColor = c.borderControl,
            disabledBorderColor = c.borderSubtle,
            errorBorderColor = c.intentDangerSolid,
            focusedLabelColor = c.textAccent,
            unfocusedLabelColor = c.textSecondary,
            disabledLabelColor = c.textDisabled,
            errorLabelColor = c.intentDangerFg,
            focusedPlaceholderColor = c.textMuted,
            unfocusedPlaceholderColor = c.textMuted,
            disabledPlaceholderColor = c.textDisabled,
            errorPlaceholderColor = c.textMuted,
            focusedSupportingTextColor = c.textMuted,
            unfocusedSupportingTextColor = c.textMuted,
            disabledSupportingTextColor = c.textDisabled,
            errorSupportingTextColor = c.intentDangerFg,
        ),
    )
}
