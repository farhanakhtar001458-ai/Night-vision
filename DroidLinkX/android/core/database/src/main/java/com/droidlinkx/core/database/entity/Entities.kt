package com.droidlinkx.core.database.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "cached_devices")
data class CachedDeviceEntity(
    @PrimaryKey val id: String,
    val name: String,
    val manufacturer: String?,
    val model: String?,
    val androidVersion: String?,
    val sdkInt: Int?,
    val appVersion: String?,
    val online: Boolean,
    val trusted: Boolean,
    val connectionQuality: String,
    val lastSeenAt: String?,
    val battery: Int?,
    val charging: Boolean?,
    val network: String?,
    val storageFreeBytes: Long?,
    val storageTotalBytes: Long?,
    val ramUsedBytes: Long?,
    val ramTotalBytes: Long?,
    val updatedAtEpochMillis: Long,
)

/** Append-only local mirror of connection/presence events for the in-app activity feed. */
@Entity(
    tableName = "connection_events",
    indices = [Index("createdAtEpochMillis"), Index("deviceId")],
)
data class ConnectionEventEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val deviceId: String?,
    val deviceName: String?,
    val event: String,
    val detail: String?,
    val createdAtEpochMillis: Long,
)

/** Outbox for telemetry snapshots that could not be delivered while offline. */
@Entity(tableName = "telemetry_outbox")
data class TelemetryOutboxEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val payloadJson: String,
    val createdAtEpochMillis: Long,
    val attempts: Int = 0,
)
