package com.droidlinkx.core.data.work

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.droidlinkx.core.common.DroidLog
import com.droidlinkx.core.data.repository.SessionStorage
import com.droidlinkx.core.domain.model.Outcome
import com.droidlinkx.core.domain.repository.DeviceCatalogueRepository
import com.droidlinkx.core.domain.repository.DeviceRegistrationRepository
import com.droidlinkx.core.domain.repository.TelemetryRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dagger.hilt.android.AndroidEntryPoint
import java.util.concurrent.TimeUnit

/**
 * Bounded recovery task. Android may kill background processes, so this periodically refreshes the
 * device session token and flushes a telemetry snapshot. It never holds a socket open in the
 * background: the live link lives in the foreground service.
 */
@HiltWorker
class ConnectionRecoveryWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val sessionStorage: SessionStorage,
    private val deviceRegistration: DeviceRegistrationRepository,
    private val deviceCatalogue: DeviceCatalogueRepository,
    private val telemetryRepository: TelemetryRepository,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        if (sessionStorage.ownerSession() == null) return Result.success()
        val credentials = sessionStorage.deviceCredentials() ?: return Result.success()
        DroidLog.i(message = "Recovery worker running for device ${credentials.deviceId}")

        val session = sessionStorage.deviceSession()
        if (session == null || session.expiresAtEpochMillis - System.currentTimeMillis() < TimeUnit.HOURS.toMillis(1)) {
            when (val result = deviceRegistration.obtainDeviceSession()) {
                is Outcome.Failure -> {
                    DroidLog.w(message = "Recovery could not refresh the device session: ${result.message}")
                    return if (result.code == "NETWORK") Result.retry() else Result.success()
                }
                is Outcome.Success -> Unit
            }
        }

        deviceCatalogue.reportTelemetry(telemetryRepository.collectNow())
        return Result.success()
    }

    companion object {
        private const val PERIODIC_NAME = "droidlinkx.connection.recovery"
        private const val IMMEDIATE_NAME = "droidlinkx.connection.recovery.now"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<ConnectionRecoveryWorker>(30, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setInitialDelay(15, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        }

        fun runNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<ConnectionRecoveryWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(IMMEDIATE_NAME, ExistingWorkPolicy.REPLACE, request)
        }
    }
}

/** Re-arms the recovery schedule after a reboot; it never starts a foreground service from boot. */
@AndroidEntryPoint
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        ConnectionRecoveryWorker.schedule(context)
        ConnectionRecoveryWorker.runNow(context)
    }
}
