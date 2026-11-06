package com.droidlinkx.feature.tools

import android.app.Activity
import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.droidlinkx.core.designsystem.component.DroidCard
import com.droidlinkx.core.designsystem.component.EmptyState
import com.droidlinkx.core.designsystem.component.MetricRow
import com.droidlinkx.core.designsystem.component.ScreenHeader
import com.droidlinkx.core.designsystem.component.SectionLabel
import com.droidlinkx.core.designsystem.theme.DroidLinkColors
import com.droidlinkx.core.domain.model.MirroringState

private const val PAGE_HUB = "hub"
private const val PAGE_MIRRORING = "mirroring"
private const val PAGE_NOTIFICATIONS = "notifications"

@Composable
fun ToolsRoute(viewModel: ToolsViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var page by rememberSaveable { mutableStateOf(PAGE_HUB) }

    BackHandler(enabled = page != PAGE_HUB) { page = PAGE_HUB }

    when (page) {
        PAGE_MIRRORING -> MirroringPage(state = state, viewModel = viewModel, onBack = { page = PAGE_HUB })
        PAGE_NOTIFICATIONS -> NotificationsPage(state = state, viewModel = viewModel, onBack = { page = PAGE_HUB })
        else -> HubPage(
            state = state,
            onOpenMirroring = { page = PAGE_MIRRORING },
            onOpenNotifications = { page = PAGE_NOTIFICATIONS },
        )
    }
}

@Composable
private fun HubPage(
    state: ToolsUiState,
    onOpenMirroring: () -> Unit,
    onOpenNotifications: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Spacer(Modifier.height(16.dp))
            ScreenHeader(
                title = "Tools",
                subtitle = "Screen mirroring and notification sharing between your own devices.",
            )
        }
        item {
            ToolCard(
                title = "Screen mirroring",
                description = "Share this screen with another of your devices over WebRTC. Capture only starts after the system consent dialog.",
                status = when {
                    state.mirroring.sharing -> "Sharing · ${state.mirroring.status}"
                    state.mirroring.watching -> "Watching · ${state.mirroring.status}"
                    else -> "Idle"
                },
                onClick = onOpenMirroring,
            ) {
                Icon(Icons.Filled.Cast, contentDescription = null)
            }
        }
        item {
            ToolCard(
                title = "Notification sharing",
                description = "Notifications posted here appear on your other devices. Private and one-time-code content is redacted before it leaves this phone.",
                status = when {
                    state.sharingEnabled && state.relayEnabled -> "Sharing + receiving"
                    state.sharingEnabled -> "Sharing this device"
                    state.relayEnabled -> "Receiving only"
                    else -> "Off"
                },
                onClick = onOpenNotifications,
            ) {
                Icon(Icons.Filled.NotificationsActive, contentDescription = null)
            }
        }
        item {
            DroidCard {
                SectionLabel("How it works")
                Spacer(Modifier.height(8.dp))
                Text(
                    "Both tools use your own Supabase project: notifications are rows in your account and " +
                        "mirroring only exchanges SDP/ICE envelopes — the video itself is peer-to-peer and never stored.",
                    style = MaterialTheme.typography.bodySmall,
                    color = DroidLinkColors.TextSecondary,
                )
            }
        }
        item { Spacer(Modifier.height(18.dp)) }
    }
}

@Composable
private fun ToolCard(
    title: String,
    description: String,
    status: String,
    onClick: () -> Unit,
    leading: @Composable () -> Unit,
) {
    DroidCard {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            leading()
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                Text(status, style = MaterialTheme.typography.labelSmall, color = DroidLinkColors.BrandBright)
                Spacer(Modifier.height(4.dp))
                Text(description, style = MaterialTheme.typography.bodySmall, color = DroidLinkColors.TextSecondary)
            }
            IconButton(onClick = onClick) {
                Icon(Icons.Filled.ChevronRight, contentDescription = "Open $title")
            }
        }
    }
}

@Composable
private fun MirroringPage(state: ToolsUiState, viewModel: ToolsViewModel, onBack: () -> Unit) {
    val context = LocalContext.current
    val projectionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        if (result.resultCode == Activity.RESULT_OK && data != null) {
            viewModel.startSharingScreen(data)
        }
    }
    var watchTarget by rememberSaveable { mutableStateOf<String?>(null) }
    val renderer = remember { viewModel.createRenderer() }

    DisposableEffect(Unit) {
        onDispose {
            renderer?.let(viewModel::releaseRenderer)
            viewModel.stopWatching()
        }
    }

    LaunchedEffect(watchTarget) {
        val target = watchTarget ?: return@LaunchedEffect
        val surface = renderer ?: return@LaunchedEffect
        viewModel.watch(target, surface)
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Spacer(Modifier.height(16.dp))
            ScreenHeader(
                title = "Screen mirroring",
                subtitle = "Peer-to-peer screen sharing between your devices.",
                trailing = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
            )
        }

        state.message?.let { text -> item { InfoCard(text, DroidLinkColors.BrandBright) } }
        state.error?.let { text -> item { InfoCard(text, MaterialTheme.colorScheme.error) } }

        item {
            DroidCard {
                SectionLabel("Share this screen")
                Spacer(Modifier.height(8.dp))
                MetricRow("Sharing", if (state.mirroring.sharing) "yes" else "no")
                MetricRow("Status", state.mirroring.status)
                MetricRow("Ice", state.mirroring.iceState ?: "—")
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (state.mirroring.sharing) {
                        OutlinedButton(onClick = viewModel::stopSharingScreen) { Text("Stop sharing") }
                    } else {
                        Button(
                            onClick = {
                                val manager = context.getSystemService(android.media.projection.MediaProjectionManager::class.java)
                                if (manager == null) {
                                    viewModel.clearMessage()
                                } else {
                                    projectionLauncher.launch(manager.createScreenCaptureIntent())
                                }
                            },
                        ) { Text("Start sharing") }
                    }
                }
            }
        }

        item { SectionLabel("Your devices") }

        if (state.devices.isEmpty()) {
            item { EmptyState("No devices", "Enrol a second device with the same owner account to mirror to it.") }
        } else {
            items(state.devices, key = { it.id }) { device ->
                DroidCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(device.name, style = MaterialTheme.typography.titleSmall)
                            Text(
                                when {
                                    device.isThisDevice -> "this device"
                                    device.online -> "online"
                                    else -> "offline"
                                },
                                style = MaterialTheme.typography.labelSmall,
                                color = if (device.online) DroidLinkColors.BrandBright else DroidLinkColors.TextSecondary,
                            )
                        }
                        when {
                            device.isThisDevice -> Text("—", color = DroidLinkColors.TextSecondary)
                            watchTarget == device.id -> OutlinedButton(onClick = {
                                viewModel.stopWatching()
                                watchTarget = null
                            }) { Text("Stop") }
                            else -> OutlinedButton(
                                onClick = { watchTarget = device.id },
                                enabled = device.online && renderer != null,
                            ) { Text("Watch") }
                        }
                    }
                }
            }
        }

        if (watchTarget != null && renderer != null) {
            item {
                DroidCard {
                    SectionLabel("Mirroring ${state.devices.firstOrNull { it.id == watchTarget }?.name ?: "device"}")
                    Spacer(Modifier.height(8.dp))
                    AndroidView(
                        factory = { renderer },
                        modifier = Modifier.fillMaxWidth().height(240.dp),
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Waiting for the other device to accept. The video is peer-to-peer: it is never uploaded.",
                        style = MaterialTheme.typography.labelSmall,
                        color = DroidLinkColors.TextSecondary,
                    )
                }
            }
        }

        item { Spacer(Modifier.height(18.dp)) }
    }
}

@Composable
private fun NotificationsPage(state: ToolsUiState, viewModel: ToolsViewModel, onBack: () -> Unit) {
    val context = LocalContext.current

    LaunchedEffect(Unit) {
        viewModel.refreshNotificationAccess()
        viewModel.refreshRecent()
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Spacer(Modifier.height(16.dp))
            ScreenHeader(
                title = "Notification sharing",
                subtitle = "Only your own devices, only while you keep it switched on.",
                trailing = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
            )
        }

        state.message?.let { text -> item { InfoCard(text, DroidLinkColors.BrandBright) } }
        state.error?.let { text -> item { InfoCard(text, MaterialTheme.colorScheme.error) } }

        item {
            DroidCard {
                SectionLabel("Permission")
                Spacer(Modifier.height(6.dp))
                Text(
                    if (state.notificationAccess) {
                        "Notification access granted. Only titles and text of new notifications are read."
                    } else {
                        "Android needs notification access before this app can see your notifications."
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = DroidLinkColors.TextSecondary,
                )
                Spacer(Modifier.height(10.dp))
                OutlinedButton(
                    onClick = {
                        runCatching {
                            context.startActivity(
                                Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                            )
                        }
                    },
                ) { Text(if (state.notificationAccess) "Review access" else "Grant access") }
            }
        }

        item {
            DroidCard {
                ToggleRow(
                    title = "Share this device's notifications",
                    detail = "Uploads new notifications to your Supabase account so your other devices can show them.",
                    checked = state.sharingEnabled,
                    onCheckedChange = viewModel::setSharingEnabled,
                )
                Spacer(Modifier.height(10.dp))
                ToggleRow(
                    title = "Show notifications from my other devices",
                    detail = "Runs a visible foreground relay that posts them here. Off by default.",
                    checked = state.relayEnabled,
                    onCheckedChange = viewModel::setRelayEnabled,
                )
            }
        }

        item { SectionLabel("Recent shared notifications") }

        if (state.recent.isEmpty()) {
            item { EmptyState("Nothing yet", "Notifications from your other devices appear here once sharing is on.") }
        } else {
            items(state.recent, key = { it.id }) { item ->
                DroidCard {
                    Text(item.appName, style = MaterialTheme.typography.titleSmall)
                    val body = listOfNotNull(item.title, item.content).filter { it.isNotBlank() }.joinToString(" · ")
                    if (body.isNotBlank()) {
                        Spacer(Modifier.height(4.dp))
                        Text(body, style = MaterialTheme.typography.bodySmall, color = DroidLinkColors.TextSecondary)
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(item.postedAt, style = MaterialTheme.typography.labelSmall, color = DroidLinkColors.TextSecondary)
                }
            }
        }

        item { Spacer(Modifier.height(18.dp)) }
    }
}

@Composable
private fun ToggleRow(
    title: String,
    detail: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(2.dp))
            Text(detail, style = MaterialTheme.typography.bodySmall, color = DroidLinkColors.TextSecondary)
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun InfoCard(text: String, color: androidx.compose.ui.graphics.Color) {
    DroidCard {
        Text(text, style = MaterialTheme.typography.bodySmall, color = color)
    }
}
