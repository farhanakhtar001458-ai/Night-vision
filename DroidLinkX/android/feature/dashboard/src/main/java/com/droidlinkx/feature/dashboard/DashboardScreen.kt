package com.droidlinkx.feature.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BatteryChargingFull
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.droidlinkx.core.common.Formatters
import com.droidlinkx.core.designsystem.component.DroidCard
import com.droidlinkx.core.designsystem.component.EmptyState
import com.droidlinkx.core.designsystem.component.MetricRow
import com.droidlinkx.core.designsystem.component.ScreenHeader
import com.droidlinkx.core.designsystem.component.SectionLabel
import com.droidlinkx.core.designsystem.component.StatusRow
import com.droidlinkx.core.designsystem.theme.DroidLinkColors
import com.droidlinkx.core.domain.model.Device
import com.droidlinkx.core.domain.model.InitializationStep
import com.droidlinkx.core.domain.model.LinkState

@Composable
fun DashboardRoute(
    onOpenDevices: () -> Unit,
    onOpenSettings: () -> Unit,
    viewModel: DashboardViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    DashboardScreen(
        state = state,
        onRefresh = viewModel::refresh,
        onReconnect = viewModel::reconnect,
        onOpenDevices = onOpenDevices,
        onOpenSettings = onOpenSettings,
    )
}

@Composable
fun DashboardScreen(
    state: DashboardUiState,
    onRefresh: () -> Unit,
    onReconnect: () -> Unit,
    onOpenDevices: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Spacer(Modifier.height(12.dp))
            ScreenHeader(
                title = "Hello, ${state.owner?.profile?.displayName ?: "owner"}",
                subtitle = "Your devices, one private connection.",
                trailing = {
                    IconButton(onClick = onRefresh) {
                        if (state.refreshing) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                        } else {
                            Icon(Icons.Filled.Refresh, contentDescription = "Refresh", tint = DroidLinkColors.TextSecondary)
                        }
                    }
                },
            )
        }

        item { LinkCard(state, onReconnect) }

        if (state.error != null) {
            item {
                DroidCard {
                    Text("Something needs attention", style = MaterialTheme.typography.titleMedium, color = DroidLinkColors.Warning)
                    Spacer(Modifier.height(4.dp))
                    Text(state.error, style = MaterialTheme.typography.bodyMedium, color = DroidLinkColors.TextSecondary)
                }
            }
        }

        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                DroidCard(modifier = Modifier.weight(1f)) {
                    SectionLabel("Online devices")
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "${state.onlineCount} / ${state.devices.size}",
                        style = MaterialTheme.typography.headlineMedium,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text("devices online", style = MaterialTheme.typography.labelSmall, color = DroidLinkColors.TextSecondary)
                }
                DroidCard(modifier = Modifier.weight(1f)) {
                    SectionLabel("This device")
                    Spacer(Modifier.height(6.dp))
                    Text(
                        state.telemetry.battery?.let { "$it%" } ?: "—",
                        style = MaterialTheme.typography.headlineMedium,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Filled.BatteryChargingFull,
                            contentDescription = null,
                            modifier = Modifier.size(12.dp),
                            tint = DroidLinkColors.BrandBright,
                        )
                        Text(
                            if (state.telemetry.charging == true) " charging" else " battery",
                            style = MaterialTheme.typography.labelSmall,
                            color = DroidLinkColors.TextSecondary,
                        )
                    }
                }
            }
        }

        item {
            DroidCard {
                SectionLabel("This device")
                Spacer(Modifier.height(8.dp))
                MetricRow("Device ID", state.localDevice?.deviceId?.take(8)?.plus("…") ?: "not enrolled")
                MetricRow("Network", state.telemetry.network ?: "—")
                MetricRow("IP address", state.telemetry.ip ?: "not reported")
                MetricRow("Storage free", Formatters.bytes(state.telemetry.storageFreeBytes))
                MetricRow("RAM used", Formatters.bytes(state.telemetry.ramUsedBytes))
                MetricRow("Uptime", Formatters.uptime(state.telemetry.uptimeSeconds))
            }
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SectionLabel("Enrolled devices")
                AssistChip(
                    onClick = onOpenDevices,
                    label = { Text("Manage", style = MaterialTheme.typography.labelSmall) },
                    colors = AssistChipDefaults.assistChipColors(labelColor = DroidLinkColors.BrandBright),
                )
            }
        }

        if (state.devices.isEmpty()) {
            item {
                EmptyState(
                    title = "No devices enrolled yet",
                    description = "Sign in on your other Android devices with the same owner account — each one registers itself automatically.",
                )
            }
        } else {
            items(state.devices, key = { it.id }) { device ->
                DeviceSummary(device)
            }
        }

        item {
            DroidCard {
                SectionLabel("Connection settings")
                Spacer(Modifier.height(8.dp))
                Text(
                    "Reconnection is paced with exponential backoff. Android may stop background work; DroidLink X uses a foreground service while you keep the link active.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = DroidLinkColors.TextSecondary,
                )
                Spacer(Modifier.height(8.dp))
                AssistChip(
                    onClick = onOpenSettings,
                    label = { Text("Open settings", style = MaterialTheme.typography.labelSmall) },
                    colors = AssistChipDefaults.assistChipColors(labelColor = DroidLinkColors.BrandBright),
                )
            }
        }

        item { Spacer(Modifier.height(24.dp)) }
    }
}

@Composable
private fun LinkCard(state: DashboardUiState, onReconnect: () -> Unit) {
    val (title, detail, online) = when (state.link.state) {
        LinkState.Authenticated -> Triple("Cloud link established", "Reachable from your other devices", true)
        LinkState.Connecting -> Triple("Connecting…", "Authenticating this device", false)
        LinkState.Reconnecting -> Triple("Reconnecting", state.link.lastError ?: "Network interrupted — retrying with backoff", false)
        LinkState.AuthorizationFailed -> Triple("Authorization failed", state.link.lastError ?: "Re-enroll this device", false)
        LinkState.Disconnected -> Triple("Not connected", state.link.lastError ?: "Open Settings and run the connection test", false)
    }
    DroidCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(
                    if (online) Icons.Filled.CloudDone else Icons.Filled.CloudOff,
                    contentDescription = null,
                    tint = if (online) DroidLinkColors.BrandBright else DroidLinkColors.Warning,
                )
                Column {
                    Text(title, style = MaterialTheme.typography.titleMedium)
                    Text(detail, style = MaterialTheme.typography.labelSmall, color = DroidLinkColors.TextSecondary)
                }
            }
            if (!online) {
                AssistChip(
                    onClick = onReconnect,
                    label = { Text("Retry", style = MaterialTheme.typography.labelSmall) },
                    colors = AssistChipDefaults.assistChipColors(labelColor = DroidLinkColors.BrandBright),
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        StatusRow(
            label = state.initialization.step.name,
            online = state.initialization.step == InitializationStep.Ready,
            detail = state.initialization.message,
        )
    }
}

@Composable
private fun DeviceSummary(device: Device) {
    DroidCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(device.name, style = MaterialTheme.typography.titleMedium)
                Text(device.displayModel, style = MaterialTheme.typography.labelSmall, color = DroidLinkColors.TextSecondary)
            }
            StatusRow(device.connectionQuality, device.online)
        }
        Spacer(Modifier.height(8.dp))
        MetricRow("Battery", device.telemetry.battery?.let { "$it%" } ?: "not reported")
        MetricRow("Last seen", Formatters.relativeTime(device.lastSeenAt))
    }
}
