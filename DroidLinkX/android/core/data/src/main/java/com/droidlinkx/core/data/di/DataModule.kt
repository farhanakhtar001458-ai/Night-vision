package com.droidlinkx.core.data.di

import com.droidlinkx.core.data.connection.LinkManagerImpl
import com.droidlinkx.core.data.repository.ConnectionRepositoryImpl
import com.droidlinkx.core.data.repository.DeviceCatalogueRepositoryImpl
import com.droidlinkx.core.data.repository.DeviceRegistrationRepositoryImpl
import com.droidlinkx.core.data.repository.OwnerAuthRepositoryImpl
import com.droidlinkx.core.data.repository.SessionStorage
import com.droidlinkx.core.data.settings.BaseUrlCache
import com.droidlinkx.core.data.settings.DeviceSettingsRepositoryImpl
import com.droidlinkx.core.data.startup.StartupCoordinatorImpl
import com.droidlinkx.core.data.telemetry.TelemetryRepositoryImpl
import com.droidlinkx.core.data.transfer.SupabaseTransferRepository
import com.droidlinkx.core.domain.repository.ConnectionRepository
import com.droidlinkx.core.domain.repository.DeviceCatalogueRepository
import com.droidlinkx.core.domain.repository.DeviceRegistrationRepository
import com.droidlinkx.core.domain.repository.DeviceSettingsRepository
import com.droidlinkx.core.domain.repository.LinkManager
import com.droidlinkx.core.domain.repository.LinkServiceController
import com.droidlinkx.core.domain.repository.OwnerAuthRepository
import com.droidlinkx.core.domain.repository.StartupCoordinator
import com.droidlinkx.core.domain.repository.TelemetryRepository
import com.droidlinkx.core.domain.repository.TransferRepository
import com.droidlinkx.core.network.RealtimeSocket
import com.droidlinkx.core.network.di.BaseUrlProvider
import com.droidlinkx.core.network.di.DeviceTokenProvider
import com.droidlinkx.core.network.di.OwnerTokenProvider
import com.droidlinkx.core.network.di.PlainHttpClient
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import okhttp3.OkHttpClient
import java.net.URLEncoder
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class DataModule {

    @Binds
    @Singleton
    abstract fun bindOwnerAuthRepository(impl: OwnerAuthRepositoryImpl): OwnerAuthRepository

    @Binds
    @Singleton
    abstract fun bindDeviceRegistrationRepository(impl: DeviceRegistrationRepositoryImpl): DeviceRegistrationRepository

    @Binds
    @Singleton
    abstract fun bindDeviceCatalogueRepository(impl: DeviceCatalogueRepositoryImpl): DeviceCatalogueRepository

    @Binds
    @Singleton
    abstract fun bindConnectionRepository(impl: ConnectionRepositoryImpl): ConnectionRepository

    @Binds
    @Singleton
    abstract fun bindTelemetryRepository(impl: TelemetryRepositoryImpl): TelemetryRepository

    @Binds
    @Singleton
    abstract fun bindLinkManager(impl: LinkManagerImpl): LinkManager

    @Binds
    @Singleton
    abstract fun bindStartupCoordinator(impl: StartupCoordinatorImpl): StartupCoordinator

    @Binds
    @Singleton
    abstract fun bindDeviceSettingsRepository(impl: DeviceSettingsRepositoryImpl): DeviceSettingsRepository

    @Binds
    @Singleton
    abstract fun bindLinkServiceController(impl: ConnectionServiceController): LinkServiceController

    @Binds
    @Singleton
    abstract fun bindTransferRepository(impl: SupabaseTransferRepository): TransferRepository

    companion object {

        @Provides
        @Singleton
        fun provideApplicationScope(): CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

        @Provides
        @Singleton
        fun provideBaseUrlProvider(cache: BaseUrlCache): BaseUrlProvider = BaseUrlProvider { cache.baseUrl }

        @Provides
        @Singleton
        fun provideOwnerTokenProvider(storage: SessionStorage): OwnerTokenProvider =
            OwnerTokenProvider { storage.ownerSession()?.tokens?.accessToken }

        @Provides
        @Singleton
        fun provideDeviceTokenProvider(storage: SessionStorage): DeviceTokenProvider =
            DeviceTokenProvider { storage.deviceSession()?.accessToken }

        @Provides
        @Singleton
        fun provideRealtimeSocket(
            @PlainHttpClient client: OkHttpClient,
            scope: CoroutineScope,
            storage: SessionStorage,
            cache: BaseUrlCache,
        ): RealtimeSocket = RealtimeSocket(
            client = client,
            scope = scope,
            urlProvider = {
                val token = storage.deviceSession()?.accessToken
                if (token.isNullOrBlank()) {
                    null
                } else {
                    // The signalling relay origin issued by create-session wins: it is the only
                    // WebSocket the device is allowed to open for WebRTC signalling.
                    val httpBase = storage.deviceCredentials()?.wsUrl?.takeIf { it.isNotBlank() }
                        ?: cache.baseUrl
                    val wsBase = httpBase
                        .replaceFirst("https://", "wss://")
                        .replaceFirst("http://", "ws://")
                        .trimEnd('/')
                    val separator = if (wsBase.contains('?')) '&' else '?'
                    "$wsBase/ws${separator}token=${URLEncoder.encode(token, "UTF-8")}&role=device"
                }
            },
        )
    }
}
