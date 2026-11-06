package com.droidlinkx.core.database.di

import android.content.Context
import androidx.room.Room
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.droidlinkx.core.database.DroidLinkDatabase
import com.droidlinkx.core.database.dao.ConnectionEventDao
import com.droidlinkx.core.database.dao.DeviceDao
import com.droidlinkx.core.database.dao.TelemetryOutboxDao
import com.droidlinkx.core.database.dao.TransferDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): DroidLinkDatabase =
        Room.databaseBuilder(context, DroidLinkDatabase::class.java, DroidLinkDatabase.NAME)
            .addMigrations(MIGRATION_1_2)
            .fallbackToDestructiveMigrationOnDowngrade()
            .build()

    @Provides
    fun provideDeviceDao(database: DroidLinkDatabase): DeviceDao = database.deviceDao()

    @Provides
    fun provideConnectionEventDao(database: DroidLinkDatabase): ConnectionEventDao = database.connectionEventDao()

    @Provides
    fun provideTelemetryOutboxDao(database: DroidLinkDatabase): TelemetryOutboxDao = database.telemetryOutboxDao()

    @Provides
    fun provideTransferDao(database: DroidLinkDatabase): TransferDao = database.transferDao()

    /** v2 adds the durable transfer queue used by resumable uploads. */
    private val MIGRATION_1_2 = object : Migration(1, 2) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS `transfer_queue` (" +
                    "`transferId` TEXT NOT NULL, `direction` TEXT NOT NULL, `status` TEXT NOT NULL, " +
                    "`totalBytes` INTEGER NOT NULL, `transferredBytes` INTEGER NOT NULL, `chunkSize` INTEGER NOT NULL, " +
                    "`targetDeviceId` TEXT, `error` TEXT, `createdAtEpochMillis` INTEGER NOT NULL, " +
                    "`updatedAtEpochMillis` INTEGER NOT NULL, PRIMARY KEY(`transferId`))",
            )
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS `transfer_files` (" +
                    "`id` TEXT NOT NULL, `transferId` TEXT NOT NULL, `itemIndex` INTEGER NOT NULL, " +
                    "`name` TEXT NOT NULL, `size` INTEGER NOT NULL, `contentUri` TEXT NOT NULL, " +
                    "`sha256` TEXT, `status` TEXT NOT NULL, `bytesSent` INTEGER NOT NULL, " +
                    "`chunksSent` INTEGER NOT NULL, `error` TEXT, `updatedAtEpochMillis` INTEGER NOT NULL, " +
                    "PRIMARY KEY(`id`))",
            )
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_transfer_files_transferId` ON `transfer_files` (`transferId`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_transfer_files_status` ON `transfer_files` (`status`)")
        }
    }
}
