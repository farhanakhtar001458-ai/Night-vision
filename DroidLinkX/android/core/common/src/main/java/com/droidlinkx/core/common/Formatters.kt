package com.droidlinkx.core.common

import java.time.Duration
import java.time.Instant
import java.util.Locale

object Formatters {
    fun bytes(bytes: Long?): String {
        if (bytes == null) return "—"
        if (bytes <= 0) return "0 B"
        val units = arrayOf("B", "KB", "MB", "GB", "TB")
        var value = bytes.toDouble()
        var unit = 0
        while (value >= 1024 && unit < units.lastIndex) {
            value /= 1024
            unit++
        }
        return if (unit == 0) "${value.toLong()} ${units[unit]}" else String.format(Locale.US, "%.1f %s", value, units[unit])
    }

    fun relativeTime(isoInstant: String?): String {
        if (isoInstant.isNullOrBlank()) return "never"
        return runCatching {
            val then = Instant.parse(isoInstant)
            val seconds = Duration.between(then, Instant.now()).seconds
            when {
                seconds < 60 -> "just now"
                seconds < 3_600 -> "${seconds / 60}m ago"
                seconds < 86_400 -> "${seconds / 3_600}h ago"
                seconds < 604_800 -> "${seconds / 86_400}d ago"
                else -> "${seconds / 604_800}w ago"
            }
        }.getOrDefault(isoInstant)
    }

    fun uptime(seconds: Long?): String {
        if (seconds == null) return "—"
        val hours = seconds / 3_600
        val minutes = (seconds % 3_600) / 60
        return "${hours}h ${minutes}m"
    }
}
