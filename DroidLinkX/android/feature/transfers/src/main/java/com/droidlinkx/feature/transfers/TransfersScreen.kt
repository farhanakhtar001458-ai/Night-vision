package com.droidlinkx.feature.transfers

import android.content.Intent
import android.net.Uri
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.droidlinkx.core.common.Formatters
import com.droidlinkx.core.designsystem.component.DroidCard
import com.droidlinkx.core.designsystem.component.EmptyState
import com.droidlinkx.core.designsystem.component.MetricRow
import com.droidlinkx.core.designsystem.component.ScreenHeader
import com.droidlinkx.core.designsystem.component.SectionLabel
import com.droidlinkx.core.designsystem.theme.DroidLinkColors
import com.droidlinkx.core.domain.model.RemoteFile
import com.droidlinkx.core.domain.model.TransferProgress

@Composable
fun TransfersRoute(viewModel: TransfersViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        viewModel.upload(uris)
    }

    LaunchedEffect(state.downloadUrl) {
        val url = state.downloadUrl ?: return@LaunchedEffect
        runCatching {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        viewModel.consumeDownloadUrl()
    }

    TransfersScreen(
        state = state,
        onPickFiles = { picker.launch(arrayOf("*/*")) },
        onPause = viewModel::pause,
        onResume = viewModel::resume,
        onCancel = viewModel::cancel,
        onRefresh = viewModel::refresh,
        onDownload = viewModel::download,
        onDelete = viewModel::delete,
        onDismissMessage = viewModel::clearMessage,
    )
}

@Composable
private fun TransfersScreen(
    state: TransfersUiState,
    onPickFiles: () -> Unit,
    onPause: (String) -> Unit,
    onResume: (String) -> Unit,
    onCancel: (String) -> Unit,
    onRefresh: () -> Unit,
    onDownload: (RemoteFile) -> Unit,
    onDelete: (RemoteFile) -> Unit,
    onDismissMessage: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Spacer(Modifier.height(16.dp))
            ScreenHeader(
                title = "Transfers",
                subtitle = "8 MiB chunks, SHA-256 verified, resumable after interruptions.",
                trailing = {
                    IconButton(onClick = onRefresh) {
                        Icon(Icons.Filled.Refresh, contentDescription = "Refresh")
                    }
                },
            )
        }

        item {
            DroidCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Button(onClick = onPickFiles, enabled = !state.busy, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Filled.Upload, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Upload files")
                    }
                    OutlinedButton(onClick = onRefresh, enabled = !state.busy) { Text("Sync") }
                }
                Spacer(Modifier.height(10.dp))
                MetricRow("Active transfers", state.activeTransfers.size.toString())
                MetricRow("Cloud storage", Formatters.bytes(state.storedBytes))
                MetricRow("Cloud files", state.files.size.toString())
            }
        }

        state.message?.let { message ->
            item {
                DroidCard {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(message, color = DroidLinkColors.BrandBright)
                        IconButton(onClick = onDismissMessage) { Icon(Icons.Filled.Close, contentDescription = "Dismiss") }
                    }
                }
            }
        }

        state.error?.let { error ->
            item {
                DroidCard {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(error, color = MaterialTheme.colorScheme.error)
                        IconButton(onClick = onDismissMessage) { Icon(Icons.Filled.Close, contentDescription = "Dismiss") }
                    }
                }
            }
        }

        item { SectionLabel("In progress") }

        if (state.activeTransfers.isEmpty()) {
            item { EmptyState("Nothing uploading", "Pick files to start a resumable, checksum-verified transfer.") }
        } else {
            items(state.activeTransfers, key = { it.transferId }) { transfer ->
                TransferRow(
                    transfer = transfer,
                    onPause = { onPause(transfer.transferId) },
                    onResume = { onResume(transfer.transferId) },
                    onCancel = { onCancel(transfer.transferId) },
                )
            }
        }

        item { SectionLabel("Recent") }

        if (state.finishedTransfers.isEmpty()) {
            item { EmptyState("No recent transfers", "Completed and failed transfers appear here with their verification state.") }
        } else {
            items(state.finishedTransfers, key = { it.transferId }) { transfer ->
                TransferRow(transfer = transfer, onPause = {}, onResume = {}, onCancel = {})
            }
        }

        item { SectionLabel("Cloud files") }

        if (state.files.isEmpty()) {
            item { EmptyState("No files yet", "Files uploaded from the dashboard or this device are listed here.") }
        } else {
            items(state.files, key = { it.id }) { file ->
                DroidCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(file.name, style = MaterialTheme.typography.titleSmall)
                            Text(
                                "${file.category} · ${Formatters.bytes(file.size)}",
                                style = MaterialTheme.typography.labelSmall,
                                color = DroidLinkColors.TextSecondary,
                            )
                        }
                        IconButton(onClick = { onDownload(file) }) {
                            Icon(Icons.Filled.Download, contentDescription = "Signed download link")
                        }
                        IconButton(onClick = { onDelete(file) }) {
                            Icon(Icons.Filled.Delete, contentDescription = "Delete file")
                        }
                    }
                }
            }
        }

        item { Spacer(Modifier.height(18.dp)) }
    }
}

@Composable
private fun TransferRow(
    transfer: TransferProgress,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onCancel: () -> Unit,
) {
    DroidCard {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    transfer.items.firstOrNull()?.name ?: transfer.transferId.take(8),
                    style = MaterialTheme.typography.titleSmall,
                )
                Text(
                    "${transfer.status} · ${Formatters.bytes(transfer.transferredBytes)} / ${Formatters.bytes(transfer.totalBytes)}",
                    style = MaterialTheme.typography.labelSmall,
                    color = DroidLinkColors.TextSecondary,
                )
            }
            if (transfer.isActive) {
                if (transfer.status == "paused") {
                    IconButton(onClick = onResume) { Icon(Icons.Filled.PlayArrow, contentDescription = "Resume") }
                } else {
                    IconButton(onClick = onPause) { Icon(Icons.Filled.Pause, contentDescription = "Pause") }
                }
                IconButton(onClick = onCancel) { Icon(Icons.Filled.Close, contentDescription = "Cancel") }
            }
        }
        Spacer(Modifier.height(8.dp))
        LinearProgressIndicator(
            progress = { transfer.percent / 100f },
            modifier = Modifier.fillMaxWidth(),
        )
        transfer.error?.let { message ->
            Spacer(Modifier.height(6.dp))
            Text(message, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
        }
    }
}
