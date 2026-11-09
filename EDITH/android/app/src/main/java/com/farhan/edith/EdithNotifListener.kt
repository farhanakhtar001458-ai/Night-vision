package com.farhan.edith

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * WhatsApp / Gmail / baaki apps ki notifications yahan aati hain.
 * "Edith whatsapp padho" tab ye store padha jata hai.
 */
class EdithNotifListener : NotificationListenerService() {

    private var ready = false

    override fun onListenerConnected() {
        super.onListenerConnected()
        EdithCore.init(this)
        ready = true
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val sb = sbn ?: return
        if (sb.packageName == packageName) return
        val n = sb.notification ?: return
        if (n.flags and Notification.FLAG_ONGOING_EVENT != 0) return

        val extras = n.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim() ?: ""
        val text = (extras.getCharSequence(Notification.EXTRA_TEXT)
            ?: extras.getCharSequence(Notification.EXTRA_BIG_TEXT))?.toString()?.trim() ?: ""
        if (title.isEmpty() && text.isEmpty()) return

        val appName = labelFor(sb.packageName)
        NotifStore.add(NotifStore.Item(sb.packageName, appName, title, text, sb.postTime))

        if (sb.packageName in NotifStore.WHATSAPP || sb.packageName in NotifStore.MAIL) {
            if (!ready) {
                EdithCore.init(this)
                ready = true
            }
            EdithCore.announceNow(appName, title, text)
        }
    }

    private fun labelFor(pkg: String): String = try {
        val pm = packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (t: Throwable) {
        pkg
    }
}
