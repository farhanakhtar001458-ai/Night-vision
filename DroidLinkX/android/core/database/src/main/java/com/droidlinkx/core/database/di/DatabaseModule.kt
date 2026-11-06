package com.droidlinkx.core.database.di

import android.content.Context
import androidx.room.Room
import com.droidlinkx.core.database.DroidLinkDatabase
import com.droidlinkx.core.database.dao.ConnectionEventDao
import com.droidlinkx.core.database.dao.DeviceDao
import com.droidlinkx.core.database.dao.TelemetryOutboxDao
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
            .fallbackToDestructiveMigrationOnDowngrade()
            .build()

    @Provides
    fun provideDeviceDao(database: DroidLinkDatabase): DeviceDao = database.deviceDao()

    @Provides
    fun provideConnectionEventDao(database: DroidLinkDatabase): ConnectionEventDao = database.connectionEventDao()

    @Provides
    fun provideTelemetryOutboxDao(database: DroidLinkDatabase): TelemetryOutboxDao = database.telemetryOutboxDao()
}
