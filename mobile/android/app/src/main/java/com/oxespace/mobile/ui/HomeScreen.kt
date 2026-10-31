package com.oxespace.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.oxespace.mobile.R
import com.oxespace.mobile.pairing.PairedDesktop
import com.oxespace.mobile.ui.theme.OxeSpace
import com.oxespace.mobile.ui.theme.OxeTheme

/** Says what the app is for and offers pairing; once paired, names the desktop and offers to unpair. */
@Composable
fun HomeScreen(paired: PairedDesktop?, onPair: () -> Unit, onUnpair: () -> Unit) {
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.safeDrawingPadding().padding(OxeSpace.space6),
            verticalArrangement = Arrangement.spacedBy(OxeSpace.space3)
        ) {
            if (paired == null) {
                Text(
                    text = stringResource(R.string.home_title),
                    style = MaterialTheme.typography.headlineMedium,
                    modifier = Modifier.semantics { heading() }
                )
                Text(text = stringResource(R.string.home_body), style = MaterialTheme.typography.bodyLarge)
                Button(onClick = onPair, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(stringResource(R.string.home_pair)) }
            } else {
                val desktop = paired.desktopName ?: stringResource(R.string.home_unknown_desktop)
                Text(
                    text = stringResource(R.string.home_paired_title, desktop),
                    style = MaterialTheme.typography.headlineMedium,
                    modifier = Modifier.semantics { heading() }
                )
                Text(text = stringResource(R.string.home_paired_body, desktop), style = MaterialTheme.typography.bodyLarge)
                OutlinedButton(onClick = onUnpair, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(stringResource(R.string.home_unpair)) }
            }
        }
    }
}

@Preview
@Composable
private fun HomeScreenPreview() {
    OxeTheme { HomeScreen(paired = null, onPair = {}, onUnpair = {}) }
}
