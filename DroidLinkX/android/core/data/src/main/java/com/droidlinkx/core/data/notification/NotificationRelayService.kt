package com.droidlinkx.core.data.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.droidlinkx.core.common.DroidLog
import com.droidlinkx.core.domain.model.Outcome
import com.droidlinkx.core.domain.model.SharedNotification
import com.droidlinkx.core.domain.repository.NotificationShareRepository
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Delivers the owner's notifications from their other devices as local notifications.
 *
 * Runs as a foreground service with a visible, permanent notification only while the owner keeps the
 * relay switched on; polling (not a database subscription) keeps the cost predictable.
 */
@AndroidEntryPoint
class NotificationRelayService : LifecycleService() {

    @Inject
    lateinit var repository: NotificationShareRepository

    @Inject
    lateinit var store: NotificationShareStore

    override fun onCreate() {
        super.onCreate()
        createChannels()
        ServiceCompat.startForeground(
            this,
            FOREGROUND_ID,
            NotificationCompat.Builder(this, CHANNEL_RELAY)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle("Sharing notifications")
                .setContentText("Notifications from your other devices appear here.")
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build(),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            } else {
                0
            },
        )
        startLoop()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        return START_STICKY
    }

    private fun startLoop() {
        lifecycleScope.launch {
            while (isActive) {
                if (store.relay.value) {
                    when (val result = repository.pendingFromOtherDevices()) {
                        is Outcome.Success -> deliver(result.value)
                        is Outcome.Failure -> DroidLog.w(message = "Notification relay: ${result.message}")
                    }
                }
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    private suspend fun deliver(notifications: List<SharedNotification>) {
        var newest = store.lastDeliveredPostedAt
        for (notification in notifications) {
            post(notification)
            if (notification.postedAt > newest) newest = notification.postedAt
        }
        if (newest.isNotBlank()) repository.markDelivered(newest)
    }

    private fun post(notification: SharedNotification) {
        val body = listOfNotNull(notification.title, notification.content)
            .filter { it.isNotBlank() && it != "•••" }
            .joinToString(" · ")
            .ifBlank { "New notification" }

        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val pending = launch?.let {
            PendingIntent.getActivity(
                this,
                notification.id.hashCode(),
                it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        val local = NotificationCompat.Builder(this, CHANNEL_SHARED)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(notification.appName)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .apply { pending?.let { setContentIntent(it) } }
            .build()

        runCatching {
            NotificationManagerCompat.from(this).notify(notification.id.hashCode(), local)
        }.onFailure { DroidLog.w(message = "Shared notification could not be posted", throwable = it) }
    }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_RELAY, "Notification relay", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Keeps notifications from your other devices flowing."
                setShowBadge(false)
            },
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_SHARED, "Shared notifications", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Notifications posted by your other DroidLink X devices."
            },
        )
    }

    companion object {
        private const val CHANNEL_RELAY = "droidlinkx.relay"
        private const val CHANNEL_SHARED = "droidlinkx.shared"
        private const val FOREGROUND_ID = 4242
        private const val POLL_INTERVAL_MS = 15_000L

        fun start(context: Context) {
            val intent = Intent(context, NotificationRelayService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, NotificationRelayService::class.java))
        }
    }
}
