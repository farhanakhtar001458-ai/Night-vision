package com.droidlinkx.app

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import com.droidlinkx.core.common.DroidLog
import com.droidlinkx.core.data.service.ConnectionService
import com.droidlinkx.core.data.settings.DeviceSettingsRepositoryImpl
import com.droidlinkx.core.data.work.ConnectionRecoveryWorker
import com.droidlinkx.core.domain.repository.StartupCoordinator
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltAndroidApp
class DroidLinkApplication : Application(), Configuration.Provider {

    @Inject
    lateinit var workerFactory: HiltWorkerFactory

    @Inject
    lateinit var startupCoordinator: StartupCoordinator

    @Inject
    lateinit var settings: DeviceSettingsRepositoryImpl

    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .setMinimumLoggingLevel(if (BuildConfig.DEBUG) android.util.Log.INFO else android.util.Log.WARN)
            .build()

    override fun onCreate() {
        super.onCreate()
        DroidLog.i(message = "DroidLink X starting (${BuildConfig.VERSION_NAME})")
        ConnectionRecoveryWorker.schedule(this)
        applicationScope.launch {
            // The ordered boot sequence: identity -> credentials -> network -> owner -> device -> socket.
            startupCoordinator.initialize()
            // Keep the link alive in a foreground service only when the owner enabled it.
            if (settings.observeKeepAliveEnabled().first()) {
                runCatching { ConnectionService.start(this@DroidLinkApplication) }
                    .onFailure { DroidLog.w(message = "Foreground service could not start", throwable = it) }
            }
        }
    }
}
