package com.droidlinkx.core.data.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.droidlinkx.core.common.DroidLog
import com.droidlinkx.core.data.network.NetworkMonitor
import com.droidlinkx.core.domain.model.LinkState
import com.droidlinkx.core.domain.model.LinkStatus
import com.droidlinkx.core.domain.repository.LinkManager
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Foreground service that keeps the authenticated device link alive while the owner expects it.
 * It shows a persistent, dismissible-only-by-user notification and never bypasses Doze restrictions.
 */
@AndroidEntryPoint
class ConnectionService : LifecycleService() {

    @Inject
    lateinit var linkManager: LinkManager

    @Inject
    lateinit var networkMonitor: NetworkMonitor

    private var lastStatus: LinkStatus = LinkStatus()

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startForegroundSafely(notificationFor(LinkStatus(LinkState.Connecting, lastError = "Connecting to the cloud")))
        networkMonitor.start()
        lifecycleScope.launch {
            linkManager.start()
        }
        lifecycleScope.launch {
            linkManager.status.collectLatest { status ->
                lastStatus = status
                val manager = getSystemService(NotificationManager::class.java)
                manager?.notify(NOTIFICATION_ID, notificationFor(status))
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        if (intent?.action == ACTION_STOP) {
            lifecycleScope.launch { linkManager.stop() }
            stopSelf()
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    override fun onDestroy() {
        lifecycleScope.launch { linkManager.stop() }
        super.onDestroy()
    }

    private fun startForegroundSafely(notification: Notification) {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        } else {
            0
        }
        runCatching { ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type) }
            .onFailure {
                DroidLog.w(message = "Foreground start was refused by the system", throwable = it)
                stopSelf()
            }
    }

    private fun notificationFor(status: LinkStatus): Notification {
        val (title, detail) = when (status.state) {
            LinkState.Authenticated -> "DroidLink X connected" to "This device is reachable from your other devices."
            LinkState.Connecting -> "DroidLink X connecting" to "Opening the authenticated cloud link…"
            LinkState.Reconnecting -> "DroidLink X reconnecting" to (status.lastError ?: "Network interrupted, retrying with backoff.")
            LinkState.AuthorizationFailed -> "DroidLink X needs attention" to (status.lastError ?: "Device credentials were rejected.")
            LinkState.Disconnected -> "DroidLink X offline" to (status.lastError ?: "Not connected to the cloud.")
        }
        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent().setClassName(packageName, "com.droidlinkx.app.MainActivity"),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, ConnectionService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(detail)
            .setSmallIcon(android.R.drawable.stat_sys_upload_done)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openIntent)
            .addAction(0, "Stop", stopIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Device connection",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Keeps this device reachable from your other DroidLink X devices."
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    companion object {
        const val CHANNEL_ID = "droidlinkx.connection"
        const val NOTIFICATION_ID = 4201
        const val ACTION_STOP = "com.droidlinkx.core.data.action.STOP_CONNECTION"

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, ConnectionService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, ConnectionService::class.java))
        }
    }
}
