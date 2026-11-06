package com.droidlinkx.core.database.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import com.droidlinkx.core.database.entity.CachedDeviceEntity
import com.droidlinkx.core.database.entity.ConnectionEventEntity
import com.droidlinkx.core.database.entity.TelemetryOutboxEntity
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
