package com.droidlinkx.app

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import com.droidlinkx.app.crash.CrashGuard
import com.droidlinkx.core.common.DroidLog
import com.droidlinkx.core.data.service.ConnectionService
import com.droidlinkx.core.data.settings.DeviceSettingsRepositoryImpl
import com.droidlinkx.core.data.work.ConnectionRecoveryWorker
import com.droidlinkx.core.domain.repository.StartupCoordinator
import com.droidlinkx.core.domain.repository.TransferRepository
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Provider

@HiltAndroidApp
class DroidLinkApplication : Application(), Configuration.Provider {

    @Inject
    lateinit var workerFactory: HiltWorkerFactory

    /*
     * Everything below is injected behind a Provider: field injection instantiates the object
     * immediately, which turns any construction failure (database, keystore, HTTP client) into a
     * hard crash before the UI exists. With providers the work happens inside a coroutine, where a
     * failure is logged and reported instead of killing the process.
     */
    @Inject
    lateinit var startupCoordinator: Provider<StartupCoordinator>

    @Inject
    lateinit var settings: Provider<DeviceSettingsRepositoryImpl>

    @Inject
    lateinit var transfers: Provider<TransferRepository>

    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .setMinimumLoggingLevel(if (BuildConfig.DEBUG) android.util.Log.INFO else android.util.Log.WARN)
            .build()

    override fun onCreate() {
        super.onCreate()
        CrashGuard.install(this)
        runCatching { DroidLog.i(message = "DroidLink X starting (${BuildConfig.VERSION_NAME})") }
        runCatching { ConnectionRecoveryWorker.schedule(this) }
            .onFailure { DroidLog.w(message = "Recovery worker could not be scheduled", throwable = it) }

        applicationScope.launch {
            // The ordered boot sequence: identity -> credentials -> network -> owner -> device -> socket.
            runCatching { startupCoordinator.get().initialize() }
                .onFailure { DroidLog.e(message = "Startup sequence could not run", throwable = it) }

            // Resume uploads interrupted by process death; chunk parts are idempotent.
            runCatching { transfers.get().resumePending() }
                .onFailure { DroidLog.w(message = "Transfer queue could not resume", throwable = it) }

            val keepAlive = runCatching { settings.get().observeKeepAliveEnabled().first() }.getOrDefault(false)
            if (keepAlive) {
                runCatching { ConnectionService.start(this@DroidLinkApplication) }
                    .onFailure { DroidLog.w(message = "Foreground service could not start", throwable = it) }
            }
        }
    }
}
