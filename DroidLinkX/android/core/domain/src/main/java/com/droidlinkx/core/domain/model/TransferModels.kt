package com.droidlinkx.core.domain.model

/** One file chosen from the device's storage (or a tree document) to upload. */
data class TransferPick(
    val uri: String,
    val name: String,
    val size: Long,
    val mimeType: String? = null,
)

data class TransferItemProgress(
    val index: Int,
    val name: String,
    val size: Long,
    val bytesSent: Long,
    val status: String,
    val sha256: String? = null,
    val error: String? = null,
) {
    val percent: Int
        get() = if (size <= 0) 0 else ((bytesSent.coerceAtMost(size) * 100) / size).toInt()
}

data class TransferProgress(
    val transferId: String,
    val direction: String,
    val status: String,
    val totalBytes: Long,
    val transferredBytes: Long,
    val items: List<TransferItemProgress> = emptyList(),
    val error: String? = null,
    val createdAtEpochMillis: Long = 0,
) {
    val percent: Int
        get() = if (totalBytes <= 0) 0 else ((transferredBytes.coerceAtMost(totalBytes) * 100) / totalBytes).toInt()

    val isActive: Boolean get() = status == "queued" || status == "running" || status == "paused"
}

/** A file already stored in Supabase Storage, owned by the signed-in owner. */
data class RemoteFile(
    val id: String,
    val name: String,
    val size: Long,
    val mimeType: String,
    val category: String,
    val sha256: String?,
    val deviceId: String?,
    val createdAt: String?,
)
