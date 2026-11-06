package com.droidlinkx.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.droidlinkx.core.common.Formatters
import com.droidlinkx.core.designsystem.component.DroidCard
import com.droidlinkx.core.designsystem.component.DividerSoft
import com.droidlinkx.core.designsystem.component.MetricRow
import com.droidlinkx.core.designsystem.component.ScreenHeader
import com.droidlinkx.core.designsystem.component.SectionLabel
import com.droidlinkx.core.designsystem.theme.DroidLinkColors

@Composable
fun SettingsRoute(
    onOpenBatterySettings: () -> Unit,
    onSignedOut: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    SettingsScreen(
        state = state,
        onSaveServerUrl = viewModel::saveServerUrl,
        onTelemetryInterval = viewModel::setTelemetryInterval,
        onKeepAlive = viewModel::setKeepAlive,
        onForgetDevice = viewModel::forgetDevice,
        onLogout = {
            viewModel.logout()
            onSignedOut()
        },
        onOpenBatterySettings = onOpenBatterySettings,
        onDismiss = viewModel::dismiss,
    )
}

@Composable
fun SettingsScreen(
    state: SettingsUiState,
    onSaveServerUrl: (String) -> Unit,
    onTelemetryInterval: (Long) -> Unit,
    onKeepAlive: (Boolean) -> Unit,
    onForgetDevice: () -> Unit,
    onLogout: () -> Unit,
    onOpenBatterySettings: () -> Unit,
    onDismiss: () -> Unit,
) {
    var serverUrl by remember(state.apiBaseUrl) { mutableStateOf(state.apiBaseUrl) }
    var confirmForget by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Spacer(Modifier.height(12.dp))
            ScreenHeader(title = "Settings", subtitle = "Account, connection and privacy controls for this device.")
        }

        state.message?.let { info ->
            item {
                DroidCard {
                    Text(info, style = MaterialTheme.typography.bodyMedium, color = DroidLinkColors.BrandBright)
                    TextButton(onClick = onDismiss) { Text("Dismiss") }
                }
            }
        }
        state.error?.let { err ->
            item {
                DroidCard {
                    Text(err, style = MaterialTheme.typography.bodyMedium, color = DroidLinkColors.Danger)
                    TextButton(onClick = onDismiss) { Text("Dismiss") }
                }
            }
        }

        item {
            DroidCard {
                SectionLabel("Owner account")
                Spacer(Modifier.height(8.dp))
                MetricRow("Display name", state.owner?.profile?.displayName ?: "signed out")
                MetricRow("Email", state.owner?.profile?.email ?: "—")
                MetricRow("Access token expires", state.owner?.tokens?.accessExpiresAtEpochMillis?.let {
                    com.droidlinkx.core.common.Formatters.relativeTime(java.time.Instant.ofEpochMilli(it).toString())
                } ?: "—")
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = onLogout) { Text("Sign out") }
            }
        }

        item {
            DroidCard {
                SectionLabel("Server configuration")
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = serverUrl,
                    onValueChange = { serverUrl = it },
                    label = { Text("Backend URL") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "HTTPS is required for public servers. Local development addresses (10.0.2.2, 192.168.x.x, localhost) may use HTTP.",
                    style = MaterialTheme.typography.labelSmall,
                    color = DroidLinkColors.TextSecondary,
                )
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { onSaveServerUrl(serverUrl) }) { Text("Save") }
                    AssistChip(
                        onClick = { serverUrl = "https://api.droidlinkx.example/" },
                        label = { Text("Example HTTPS", style = MaterialTheme.typography.labelSmall) },
                        colors = AssistChipDefaults.assistChipColors(labelColor = DroidLinkColors.BrandBright),
                    )
                }
            }
        }

        item {
            DroidCard {
                SectionLabel("Connection")
                Spacer(Modifier.height(8.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Foreground connection", style = MaterialTheme.typography.bodyMedium)
                        Text(
                            "Keeps an authenticated WebSocket alive with a visible notification while you need this device reachable.",
                            style = MaterialTheme.typography.labelSmall,
                            color = DroidLinkColors.TextSecondary,
                        )
                    }
                    Switch(checked = state.keepAliveEnabled, onCheckedChange = onKeepAlive)
                }
                DividerSoft()
                Spacer(Modifier.height(8.dp))
                Text("Telemetry interval", style = MaterialTheme.typography.bodyMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(30L, 60L, 300L).forEach { seconds ->
                        AssistChip(
                            onClick = { onTelemetryInterval(seconds) },
                            label = { Text("${seconds}s", style = MaterialTheme.typography.labelSmall) },
                            colors = AssistChipDefaults.assistChipColors(
                                labelColor = if (state.telemetryIntervalSeconds == seconds) DroidLinkColors.BrandBright else DroidLinkColors.TextSecondary,
                            ),
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "Android may still restrict background network access. Battery optimisation can be exempted for this app to improve reliability — DroidLink X never bypasses Doze.",
                    style = MaterialTheme.typography.labelSmall,
                    color = DroidLinkColors.TextSecondary,
                )
                TextButton(onClick = onOpenBatterySettings) { Text("Battery optimisation settings") }
            }
        }

        item {
            DroidCard {
                SectionLabel("This device")
                Spacer(Modifier.height(8.dp))
                MetricRow("Device ID", state.device?.deviceId ?: "not enrolled")
                MetricRow("Enrolled", state.device?.enrolledAtEpochMillis?.let {
                    Formatters.relativeTime(java.time.Instant.ofEpochMilli(it).toString())
                } ?: "—")
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { confirmForget = true }, enabled = state.device != null) {
                    Text("Remove this device from the account")
                }
            }
        }

        item {
            DroidCard {
                SectionLabel("Privacy")
                Spacer(Modifier.height(8.dp))
                Text(
                    "Screen capture, camera, notifications and clipboard sync only run when you enable the capability on the device and approve Android's own permission dialog. Nothing is recorded silently and no accessibility input is injected unless you enable it.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = DroidLinkColors.TextSecondary,
                )
                Spacer(Modifier.height(8.dp))
                MetricRow("App version", "1.0.0")
                MetricRow("Platform", "Android ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT})")
            }
        }
        item { Spacer(Modifier.height(24.dp)) }
    }

    if (confirmForget) {
        AlertDialog(
            onDismissRequest = { confirmForget = false },
            title = { Text("Remove this device?") },
            text = { Text("The credential and token for this device are deleted locally and revoked on the server.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmForget = false
                    onForgetDevice()
                }) { Text("Remove", color = DroidLinkColors.Danger) }
            },
            dismissButton = { TextButton(onClick = { confirmForget = false }) { Text("Cancel") } },
        )
    }
}
