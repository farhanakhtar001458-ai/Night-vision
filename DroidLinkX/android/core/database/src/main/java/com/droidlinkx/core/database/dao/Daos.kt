package com.droidlinkx.core.database.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import com.droidlinkx.core.database.entity.CachedDeviceEntity
import com.droidlinkx.core.database.entity.ConnectionEventEntity
import com.droidlinkx.core.database.entity.TelemetryOutboxEntity
import com.droidlinkx.core.database.entity.TransferFileEntity
import com.droidlinkx.core.database.entity.TransferQueueEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface DeviceDao {
    @Query("SELECT * FROM cached_devices ORDER BY online DESC, name ASC")
    fun observeAll(): Flow<List<CachedDeviceEntity>>

    @Query("SELECT * FROM cached_devices WHERE id = :deviceId")
    fun observe(deviceId: String): Flow<CachedDeviceEntity?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(devices: List<CachedDeviceEntity>)

    @Query("UPDATE cached_devices SET online = :online, lastSeenAt = :lastSeenAt WHERE id = :deviceId")
    suspend fun setOnline(deviceId: String, online: Boolean, lastSeenAt: String?)

    @Query("UPDATE cached_devices SET battery = :battery, charging = :charging, network = :network WHERE id = :deviceId")
    suspend fun updateHeartbeat(deviceId: String, battery: Int?, charging: Boolean?, network: String?)

    @Query("DELETE FROM cached_devices WHERE id = :deviceId")
    suspend fun delete(deviceId: String)

    @Query("DELETE FROM cached_devices")
    suspend fun clear()
}

@Dao
interface ConnectionEventDao {
    @Query("SELECT * FROM connection_events ORDER BY createdAtEpochMillis DESC LIMIT :limit")
    fun observeRecent(limit: Int = 50): Flow<List<ConnectionEventEntity>>

    @Insert
    suspend fun insert(event: ConnectionEventEntity)

    @Query("DELETE FROM connection_events WHERE createdAtEpochMillis < :olderThanEpochMillis")
    suspend fun prune(olderThanEpochMillis: Long)
}

@Dao
interface TelemetryOutboxDao {
    @Query("SELECT * FROM telemetry_outbox ORDER BY createdAtEpochMillis ASC LIMIT :limit")
    suspend fun pending(limit: Int = 20): List<TelemetryOutboxEntity>

    @Insert
    suspend fun enqueue(item: TelemetryOutboxEntity)

    @Query("DELETE FROM telemetry_outbox WHERE id IN (:ids)")
    suspend fun delete(ids: List<Long>)

    @Query("UPDATE telemetry_outbox SET attempts = attempts + 1 WHERE id IN (:ids)")
    suspend fun markAttempted(ids: List<Long>)

    @Query("SELECT COUNT(*) FROM telemetry_outbox")
    suspend fun count(): Int

    @Transaction
    suspend fun clearAll() {
        delete(pending(500).map { it.id })
    }
}

@Dao
interface TransferDao {
    @Query("SELECT * FROM transfer_queue ORDER BY createdAtEpochMillis DESC")
    fun observeTransfers(): Flow<List<TransferQueueEntity>>

    @Query("SELECT * FROM transfer_files WHERE transferId = :transferId ORDER BY itemIndex ASC")
    fun observeFiles(transferId: String): Flow<List<TransferFileEntity>>

    @Query("SELECT * FROM transfer_files ORDER BY updatedAtEpochMillis DESC LIMIT 200")
    fun observeAllFiles(): Flow<List<TransferFileEntity>>

    @Query("SELECT * FROM transfer_queue WHERE status IN ('queued', 'running', 'paused') ORDER BY createdAtEpochMillis ASC")
    suspend fun pendingTransfers(): List<TransferQueueEntity>

    @Query("SELECT * FROM transfer_files WHERE transferId = :transferId ORDER BY itemIndex ASC")
    suspend fun files(transferId: String): List<TransferFileEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertTransfer(transfer: TransferQueueEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertFiles(files: List<TransferFileEntity>)

    @Query("UPDATE transfer_queue SET status = :status, error = :error, updatedAtEpochMillis = :now WHERE transferId = :transferId")
    suspend fun setTransferState(transferId: String, status: String, error: String?, now: Long)

    @Query("UPDATE transfer_queue SET transferredBytes = :transferred, updatedAtEpochMillis = :now WHERE transferId = :transferId")
    suspend fun setTransferred(transferId: String, transferred: Long, now: Long)

    @Query(
        "UPDATE transfer_files SET bytesSent = :bytes, chunksSent = :chunks, status = :status, " +
            "sha256 = COALESCE(:sha256, sha256), updatedAtEpochMillis = :now WHERE id = :id"
    )
    suspend fun updateFileProgress(id: String, bytes: Long, chunks: Int, status: String, sha256: String?, now: Long)

    @Query("UPDATE transfer_files SET status = :status, error = :error, updatedAtEpochMillis = :now WHERE id = :id")
    suspend fun setFileError(id: String, status: String, error: String?, now: Long)

    @Query("DELETE FROM transfer_queue WHERE transferId = :transferId")
    suspend fun deleteTransfer(transferId: String)

    @Query("DELETE FROM transfer_files WHERE transferId = :transferId")
    suspend fun deleteFiles(transferId: String)
}
