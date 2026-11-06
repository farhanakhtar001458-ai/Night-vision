package com.droidlinkx.app.crash

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.droidlinkx.core.designsystem.theme.DroidLinkColors

/**
 * Shown on the launch that follows a crash. The app deliberately stays on this screen until the
 * owner dismisses it, so the message can be read (and copied) instead of dying again immediately.
 */
@Composable
fun CrashScreen(
    report: String,
    onCopy: () -> Unit,
    onDismiss: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Last launch failed", style = MaterialTheme.typography.headlineMedium, color = DroidLinkColors.Danger)
        Text(
            "DroidLink X stopped unexpectedly last time. The exact error is below — copy it and send it over, " +
                "or press Continue to use the app anyway.",
            style = MaterialTheme.typography.bodyMedium,
            color = DroidLinkColors.TextSecondary,
        )
        Text(
            report,
            style = MaterialTheme.typography.labelSmall,
            color = DroidLinkColors.TextPrimary,
            modifier = Modifier.fillMaxWidth(),
        )
        Button(onClick = onCopy, modifier = Modifier.fillMaxWidth()) {
            Text("Copy error")
        }
        OutlinedButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
            Text("Continue to app")
        }
    }
}
