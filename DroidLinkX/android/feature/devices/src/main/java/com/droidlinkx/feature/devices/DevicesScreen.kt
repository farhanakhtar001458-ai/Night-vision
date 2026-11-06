package com.droidlinkx.feature.devices

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
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
import com.droidlinkx.core.designsystem.component.EmptyState
import com.droidlinkx.core.designsystem.component.MetricRow
import com.droidlinkx.core.designsystem.component.ScreenHeader
import com.droidlinkx.core.designsystem.component.SectionLabel
import com.droidlinkx.core.designsystem.component.StatusRow
import com.droidlinkx.core.designsystem.theme.DroidLinkColors
import com.droidlinkx.core.domain.model.Device

private val SENSITIVE_PERMISSIONS = listOf("screen_capture", "camera", "remote_control", "notifications", "clipboard", "files")

@Composable
fun DevicesRoute(viewModel: DevicesViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    DevicesScreen(
        state = state,
        onRefresh = viewModel::refresh,
        onRename = viewModel::rename,
        onTrust = viewModel::setTrusted,
        onPermission = viewModel::setPermission,
        onRevoke = viewModel::revoke,
        onRequestMirroring = viewModel::requestMirroring,
        onDismissMessage = viewModel::dismissMessage,
    )
}

@Composable
fun DevicesScreen(
    state: DevicesUiState,
    onRefresh: () -> Unit,
    onRename: (String, String) -> Unit,
    onTrust: (String, Boolean) -> Unit,
    onPermission: (String, String, Boolean) -> Unit,
    onRevoke: (String) -> Unit,
    onRequestMirroring: (String) -> Unit,
    onDismissMessage: () -> Unit,
) {
    var renameTarget by remember { mutableStateOf<Device?>(null) }
    var revokeTarget by remember { mutableStateOf<Device?>(null) }
    var expanded by remember { mutableStateOf<String?>(null) }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Spacer(Modifier.height(12.dp))
            ScreenHeader(
                title = "Devices",
                subtitle = "${state.devices.count { it.online }} online of ${state.devices.size} enrolled",
                trailing = {
                    AssistChip(
                        onClick = onRefresh,
                        label = { Text("Refresh", style = MaterialTheme.typography.labelSmall) },
                        colors = AssistChipDefaults.assistChipColors(labelColor = DroidLinkColors.BrandBright),
                    )
                },
            )
        }

        item {
            DroidCard {
                SectionLabel("This installation")
                Spacer(Modifier.height(8.dp))
                MetricRow("Device ID", state.localDevice?.deviceId ?: "not enrolled")
                MetricRow("Link state", state.link.state.name)
                state.link.lastError?.let { MetricRow("Last error", it, DroidLinkColors.Warning) }
            }
        }

        if (state.error != null) {
            item {
                DroidCard {
                    Text("Action failed", style = MaterialTheme.typography.titleMedium, color = DroidLinkColors.Danger)
                    Spacer(Modifier.height(4.dp))
                    Text(state.error, style = MaterialTheme.typography.bodyMedium, color = DroidLinkColors.TextSecondary)
                    TextButton(onClick = onDismissMessage) { Text("Dismiss") }
                }
            }
        }
        if (state.message != null) {
            item {
                DroidCard {
                    Text(state.message, style = MaterialTheme.typography.bodyMedium, color = DroidLinkColors.BrandBright)
                    TextButton(onClick = onDismissMessage) { Text("Dismiss") }
                }
            }
        }

        if (state.devices.isEmpty()) {
            item {
                EmptyState(
                    title = "Nobody else here yet",
                    description = "Install DroidLink X on another Android device, sign in with the same owner account and it joins this mesh automatically.",
                )
            }
        } else {
            items(state.devices, key = { it.id }) { device ->
                DeviceCard(
                    device = device,
                    expanded = expanded == device.id,
                    busy = state.busy,
                    onToggleExpand = { expanded = if (expanded == device.id) null else device.id },
                    onRequestMirroring = { onRequestMirroring(device.id) },
                    onRename = { renameTarget = device },
                    onRevoke = { revokeTarget = device },
                    onTrust = { onTrust(device.id, it) },
                    onPermission = { permission, granted -> onPermission(device.id, permission, granted) },
                )
            }
        }
        item { Spacer(Modifier.height(24.dp)) }
    }

    renameTarget?.let { device ->
        var value by remember(device.id) { mutableStateOf(device.name) }
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text("Rename device") },
            text = { OutlinedTextField(value = value, onValueChange = { value = it }, singleLine = true, label = { Text("Device name") }) },
            confirmButton = {
                TextButton(onClick = {
                    onRename(device.id, value)
                    renameTarget = null
                }) { Text("Save") }
            },
            dismissButton = { TextButton(onClick = { renameTarget = null }) { Text("Cancel") } },
        )
    }

    revokeTarget?.let { device ->
        AlertDialog(
            onDismissRequest = { revokeTarget = null },
            title = { Text("Revoke ${device.name}?") },
            text = { Text("Its credential and every session are revoked immediately. The device must be enrolled again to reconnect.") },
            confirmButton = {
                TextButton(onClick = {
                    onRevoke(device.id)
                    revokeTarget = null
                }) { Text("Revoke", color = DroidLinkColors.Danger) }
            },
            dismissButton = { TextButton(onClick = { revokeTarget = null }) { Text("Keep") } },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DeviceCard(
    device: Device,
    expanded: Boolean,
    busy: Boolean,
    onToggleExpand: () -> Unit,
    onRequestMirroring: () -> Unit,
    onRename: () -> Unit,
    onRevoke: () -> Unit,
    onTrust: (Boolean) -> Unit,
    onPermission: (String, Boolean) -> Unit,
) {
    DroidCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(device.name, style = MaterialTheme.typography.titleMedium)
                Text(device.displayModel, style = MaterialTheme.typography.labelSmall, color = DroidLinkColors.TextSecondary)
            }
            StatusRow(device.connectionQuality, device.online)
        }
        Spacer(Modifier.height(10.dp))
        MetricRow("Android", device.androidVersion ?: "not reported")
        MetricRow("Battery", device.telemetry.battery?.let { "$it%" } ?: "not reported")
        MetricRow("Last seen", Formatters.relativeTime(device.lastSeenAt))
        MetricRow("Trusted", if (device.trusted) "yes" else "no")

        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            Button(onClick = onRequestMirroring, enabled = device.online && !busy) { Text("Connect") }
            OutlinedButton(onClick = onRename) { Text("Rename") }
            OutlinedButton(onClick = onToggleExpand) { Text(if (expanded) "Hide" else "Capabilities") }
        }

        if (expanded) {
            Spacer(Modifier.height(10.dp))
            DividerSoft()
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("Trusted device", style = MaterialTheme.typography.bodyMedium)
                Switch(checked = device.trusted, onCheckedChange = { onTrust(it) })
            }
            SENSITIVE_PERMISSIONS.forEach { permission ->
                val granted = device.permissions[permission] == true
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text(permission.replace('_', ' '), style = MaterialTheme.typography.bodyMedium, color = DroidLinkColors.TextSecondary)
                    Switch(
                        checked = granted,
                        enabled = device.trusted,
                        onCheckedChange = { onPermission(permission, it) },
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onRevoke) { Text("Revoke this device", color = DroidLinkColors.Danger) }
        }
    }
}
