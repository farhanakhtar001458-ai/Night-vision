package com.droidlinkx.core.data.mirroring

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.IntentCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.droidlinkx.core.common.DroidLog
import com.droidlinkx.core.domain.model.MirroringState
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Foreground service that owns the MediaProjection session. Android 14+ requires the
 * `mediaProjection` foreground type to be declared and running before capture starts, and the
 * system shows its own consent dialog before anything is captured.
 */
@AndroidEntryPoint
class ScreenShareService : LifecycleService() {

    @Inject
    lateinit var controller: ScreenMirroringController

    private var observer: Job? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        ServiceCompat.startForeground(
            this,
            FOREGROUND_ID,
            NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_upload)
                .setContentTitle("Screen sharing")
                .setContentText("Waiting for one of your devices to connect…")
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build(),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            } else {
                0
            },
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        val projection = intent?.let {
            IntentCompat.getParcelableExtra(it, ScreenMirroringController.EXTRA_PROJECTION_DATA, Intent::class.java)
        }
        if (projection == null) {
            DroidLog.w(message = "Screen sharing started without a projection permission result")
            stopSelf()
            return START_NOT_STICKY
        }
        controller.startSharing(projection)
        observeState()
        return START_STICKY
    }

    private fun observeState() {
        if (observer != null) return
        observer = lifecycleScope.launch {
            controller.state.collect { state ->
                when {
                    state.status == MirroringState.STATUS_CONNECTED -> updateNotification("Screen is being mirrored")
                    state.status == MirroringState.STATUS_FAILED -> {
                        updateNotification(state.detail ?: "Screen sharing failed")
                        stopSelf()
                    }
                    !state.sharing -> stopSelf()
                }
            }
        }
    }

    private fun updateNotification(text: String) {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        manager.notify(
            FOREGROUND_ID,
            NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_upload)
                .setContentTitle("Screen sharing")
                .setContentText(text)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build(),
        )
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Screen sharing", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shown while this device mirrors its screen to another device."
                setShowBadge(false)
            },
        )
    }

    override fun onDestroy() {
        controller.stopSharing()
        observer?.cancel()
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL_ID = "droidlinkx.mirroring"
        private const val FOREGROUND_ID = 4343

        fun start(context: Context, projectionPermission: Intent) {
            val intent = Intent(context, ScreenShareService::class.java)
                .putExtra(ScreenMirroringController.EXTRA_PROJECTION_DATA, projectionPermission)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, ScreenShareService::class.java))
        }
    }
}
