package com.droidlinkx.core.database

import androidx.room.Database
import androidx.room.RoomDatabase
import com.droidlinkx.core.database.dao.ConnectionEventDao
import com.droidlinkx.core.database.dao.DeviceDao
import com.droidlinkx.core.database.dao.TelemetryOutboxDao
import com.droidlinkx.core.database.entity.CachedDeviceEntity
import com.droidlinkx.core.database.entity.ConnectionEventEntity
import com.droidlinkx.core.database.entity.TelemetryOutboxEntity

@Database(
    entities = [CachedDeviceEntity::class, ConnectionEventEntity::class, TelemetryOutboxEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class DroidLinkDatabase : RoomDatabase() {
    abstract fun deviceDao(): DeviceDao
    abstract fun connectionEventDao(): ConnectionEventDao
    abstract fun telemetryOutboxDao(): TelemetryOutboxDao

    companion object {
        const val NAME = "droidlinkx.db"
    }
}
