package com.droidlinkx.feature.transfers

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.droidlinkx.core.domain.model.Outcome
import com.droidlinkx.core.domain.model.RemoteFile
import com.droidlinkx.core.domain.model.TransferPick
import com.droidlinkx.core.domain.model.TransferProgress
import com.droidlinkx.core.domain.repository.TransferRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class TransfersUiState(
    val transfers: List<TransferProgress> = emptyList(),
    val files: List<RemoteFile> = emptyList(),
    val busy: Boolean = false,
    val message: String? = null,
    val error: String? = null,
    val downloadUrl: String? = null,
) {
    val activeTransfers: List<TransferProgress> get() = transfers.filter { it.isActive }
    val finishedTransfers: List<TransferProgress> get() = transfers.filterNot { it.isActive }
    val storedBytes: Long get() = files.sumOf { it.size }
}

@HiltViewModel
class TransfersViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val repository: TransferRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(TransfersUiState())
    val state: StateFlow<TransfersUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            combine(repository.observeTransfers(), repository.observeRemoteFiles()) { transfers, files ->
                transfers to files
            }.collect { (transfers, files) ->
                _state.update { it.copy(transfers = transfers, files = files) }
            }
        }
        viewModelScope.launch {
            repository.resumePending()
            when (val result = repository.refresh()) {
                is Outcome.Failure -> _state.update { it.copy(error = result.message) }
                is Outcome.Success -> Unit
            }
        }
    }

    /** Reads display name and size from the picked documents so the queue can show real progress. */
    fun upload(uris: List<Uri>) {
        if (uris.isEmpty()) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null, message = null) }
            val picks = uris.mapNotNull { uri -> uri.toPick() }
            if (picks.isEmpty()) {
                _state.update { it.copy(busy = false, error = "The selected files could not be read") }
                return@launch
            }
            when (val result = repository.enqueue(picks)) {
                is Outcome.Failure -> _state.update { it.copy(busy = false, error = result.message) }
                is Outcome.Success -> _state.update {
                    it.copy(
                        busy = false,
                        message = "${picks.size} file(s) queued for upload",
                    )
                }
            }
        }
    }

    fun pause(transferId: String) = act { repository.pause(transferId) }

    fun resume(transferId: String) = act { repository.resume(transferId) }

    fun cancel(transferId: String) = act { repository.cancel(transferId) }

    fun refresh() {
        viewModelScope.launch {
            _state.update { it.copy(busy = true) }
            val result = repository.refresh()
            _state.update {
                it.copy(
                    busy = false,
                    error = (result as? Outcome.Failure)?.message,
                )
            }
        }
    }

    fun download(file: RemoteFile) {
        viewModelScope.launch {
            when (val result = repository.secureDownload(file.id)) {
                is Outcome.Failure -> _state.update { it.copy(error = result.message) }
                is Outcome.Success -> _state.update {
                    it.copy(downloadUrl = result.value, message = "Signed link ready for ${file.name}")
                }
            }
        }
    }

    fun delete(file: RemoteFile) {
        viewModelScope.launch {
            when (val result = repository.deleteRemoteFile(file.id)) {
                is Outcome.Failure -> _state.update { it.copy(error = result.message) }
                is Outcome.Success -> {
                    _state.update { it.copy(message = "${file.name} removed") }
                    repository.refresh()
                }
            }
        }
    }

    fun consumeDownloadUrl() = _state.update { it.copy(downloadUrl = null) }

    fun clearMessage() = _state.update { it.copy(message = null, error = null) }

    private fun act(block: suspend () -> Outcome<Unit>) {
        viewModelScope.launch {
            when (val result = block()) {
                is Outcome.Failure -> _state.update { it.copy(error = result.message) }
                is Outcome.Success -> Unit
            }
        }
    }

    private fun Uri.toPick(): TransferPick? {
        val resolver = context.contentResolver
        var name = lastPathSegment?.substringAfterLast('/') ?: "file"
        var size = 0L
        resolver.query(this, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameIndex >= 0) name = cursor.getString(nameIndex) ?: name
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
            }
        }
        if (size <= 0) return null
        return TransferPick(
            uri = toString(),
            name = name,
            size = size,
            mimeType = resolver.getType(this),
        )
    }
}
