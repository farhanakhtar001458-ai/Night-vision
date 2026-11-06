package com.droidlinkx.core.data.notification

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.droidlinkx.core.common.DroidLog
import com.droidlinkx.core.data.repository.SessionStorage
import com.droidlinkx.core.domain.model.SharedNotification
import com.droidlinkx.core.domain.model.onFailure
import com.droidlinkx.core.domain.repository.NotificationShareRepository
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.time.Instant
import javax.inject.Inject

/**
 * Captures notifications only while sharing is enabled and only from apps that are not excluded.
 *
 * Privacy rules applied before anything leaves the device:
 *  * secret / private-visibility notifications keep only the app name,
 *  * content that looks like a one-time code or password is redacted,
 *  * group summaries, ongoing/media/progress notifications and the app's own notifications are skipped.
 */
@AndroidEntryPoint
class DroidNotificationListener : NotificationListenerService() {

    @Inject
    lateinit var repository: NotificationShareRepository

    @Inject
    lateinit var store: NotificationShareStore

    @Inject
    lateinit var sessionStorage: SessionStorage

    @Inject
    lateinit var scope: CoroutineScope

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (!store.sharing.value) return
        val deviceId = sessionStorage.deviceCredentials()?.deviceId ?: return
        if (sbn.packageName == packageName) return
        if (sbn.isOngoing) return

        val notification = sbn.notification ?: return
        if (notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        if (sbn.packageName in IGNORED_PACKAGES) return
        if (notification.category in IGNORED_CATEGORIES) return

        val extras = notification.extras ?: return
        val rawTitle = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim()
        val rawText = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim()
        if (rawTitle.isNullOrBlank() && rawText.isNullOrBlank()) return

        val secret = notification.visibility == Notification.VISIBILITY_SECRET
        val sensitive = secret || SENSITIVE_PATTERN.containsMatchIn(listOfNotNull(rawTitle, rawText).joinToString(" "))

        val record = SharedNotification(
            id = buildKey(sbn),
            deviceId = deviceId,
            appName = appLabel(sbn.packageName),
            packageName = sbn.packageName,
            title = when {
                secret -> null
                sensitive -> rawTitle?.let { REDACTED }
                else -> rawTitle?.take(MAX_TEXT)
            },
            content = when {
                secret -> "Hidden notification"
                sensitive -> REDACTED
                else -> rawText?.take(MAX_TEXT)
            },
            category = notification.category,
            isSensitive = sensitive,
            postedAt = Instant.ofEpochMilli(sbn.postTime).toString(),
        )

        scope.launch {
            repository.share(record).onFailure { failure ->
                DroidLog.w(message = "Notification could not be shared: ${failure.message}")
            }
        }
    }

    private fun buildKey(sbn: StatusBarNotification): String =
        "${sbn.packageName}:${sbn.id}:${sbn.tag ?: "-"}:${sbn.postTime}"

    private fun appLabel(packageName: String): String = runCatching {
        val info = packageManager.getApplicationInfo(packageName, 0)
        packageManager.getApplicationLabel(info).toString()
    }.getOrDefault(packageName)

    companion object {
        private const val MAX_TEXT = 500
        private const val REDACTED = "•••"
        private val SENSITIVE_PATTERN = Regex(
            "(otp|one[- ]time|password|passcode|2fa|verification code|\\b\\d{4,8}\\b)",
            RegexOption.IGNORE_CASE,
        )
        private val IGNORED_PACKAGES = setOf(
            "android",
            "com.android.systemui",
            "com.android.providers.downloads",
            "com.google.android.gms",
        )
        private val IGNORED_CATEGORIES = setOf(
            Notification.CATEGORY_PROGRESS,
            Notification.CATEGORY_SERVICE,
            Notification.CATEGORY_TRANSPORT,
            Notification.CATEGORY_SYSTEM,
        )
    }
}
