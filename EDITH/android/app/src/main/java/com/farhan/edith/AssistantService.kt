package com.farhan.edith

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder

/** Always-listening mode isi service me chalta hai (screen band hone par bhi). */
class AssistantService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        EdithCore.init(this)
        foreground()
        EdithCore.startContinuous()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        EdithCore.init(this)
        foreground()
        if (!EdithCore.continuous) EdithCore.startContinuous()
        return START_STICKY
    }

    override fun onDestroy() {
        EdithCore.serviceStopped()
        super.onDestroy()
    }

    private fun foreground() {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= 26) {
                nm.createNotificationChannel(
                    NotificationChannel(CHANNEL, "EDITH listening", NotificationManager.IMPORTANCE_LOW)
                )
            }
            val open = PendingIntent.getActivity(
                this, 0, Intent(this, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val builder = if (Build.VERSION.SDK_INT >= 26) {
                Notification.Builder(this, CHANNEL)
            } else {
                Notification.Builder(this)
            }
            val n = builder
                .setContentTitle("EDITH sun rahi hai")
                .setContentText("'Edith' bolo, phir apna command")
                .setSmallIcon(R.drawable.ic_edith)
                .setOngoing(true)
                .setContentIntent(open)
                .build()
            startForeground(1001, n)
        } catch (t: Throwable) {
        }
    }

    companion object {
        private const val CHANNEL = "edith_fg"

        fun start(ctx: Context) {
            val i = Intent(ctx, AssistantService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
            } catch (t: Throwable) {
            }
        }

        fun stop(ctx: Context) {
            try {
                ctx.stopService(Intent(ctx, AssistantService::class.java))
            } catch (t: Throwable) {
            }
        }
    }
}
