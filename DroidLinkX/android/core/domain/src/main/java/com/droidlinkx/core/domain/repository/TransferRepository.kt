package com.droidlinkx.core.domain.repository

import com.droidlinkx.core.domain.model.Outcome
import com.droidlinkx.core.domain.model.RemoteFile
import com.droidlinkx.core.domain.model.TransferPick
import com.droidlinkx.core.domain.model.TransferProgress
import kotlinx.coroutines.flow.Flow

/**
 * Resumable, checksum-verified transfers between this device and Supabase Storage.
 *
 * Uploads are split into 8 MiB parts written straight to Storage with the owner's JWT; the
 * `finalize-transfer` Edge Function then verifies size and SHA-256 and completes the item.
 */
interface TransferRepository {
    fun observeTransfers(): Flow<List<TransferProgress>>
    fun observeRemoteFiles(): Flow<List<RemoteFile>>

    suspend fun refresh(): Outcome<Unit>
    suspend fun enqueue(picks: List<TransferPick>, targetDeviceId: String? = null): Outcome<String>
    suspend fun pause(transferId: String): Outcome<Unit>
    suspend fun resume(transferId: String): Outcome<Unit>
    suspend fun cancel(transferId: String): Outcome<Unit>
    /** Restarts any queued/running transfer left behind by a previous process. */
    suspend fun resumePending()

    /** Returns a short-lived signed URL issued by the generate-secure-download Edge Function. */
    suspend fun secureDownload(fileId: String): Outcome<String>
    suspend fun deleteRemoteFile(fileId: String): Outcome<Unit>
}
