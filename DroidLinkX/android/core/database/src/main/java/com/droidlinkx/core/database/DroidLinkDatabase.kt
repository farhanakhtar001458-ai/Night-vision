package com.droidlinkx.core.database

import androidx.room.Database
import androidx.room.RoomDatabase
import com.droidlinkx.core.database.dao.ConnectionEventDao
import com.droidlinkx.core.database.dao.DeviceDao
import com.droidlinkx.core.database.dao.TelemetryOutboxDao
import com.droidlinkx.core.database.dao.TransferDao
import com.droidlinkx.core.database.entity.CachedDeviceEntity
import com.droidlinkx.core.database.entity.ConnectionEventEntity
import com.droidlinkx.core.database.entity.TelemetryOutboxEntity
import com.droidlinkx.core.database.entity.TransferFileEntity
import com.droidlinkx.core.database.entity.TransferQueueEntity

@Database(
    entities = [
        CachedDeviceEntity::class,
        ConnectionEventEntity::class,
        TelemetryOutboxEntity::class,
        TransferQueueEntity::class,
        TransferFileEntity::class,
    ],
    version = 2,
    exportSchema = true,
)
abstract class DroidLinkDatabase : RoomDatabase() {
    abstract fun deviceDao(): DeviceDao
    abstract fun connectionEventDao(): ConnectionEventDao
    abstract fun telemetryOutboxDao(): TelemetryOutboxDao
    abstract fun transferDao(): TransferDao

    companion object {
        const val NAME = "droidlinkx.db"
    }
}
