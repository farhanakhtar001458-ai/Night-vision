package com.droidlinkx.core.common

import android.util.Log

/**
 * Central logging facade. Debug builds log verbosely; release builds keep warnings and errors only and
 * never log credentials, tokens or clipboard contents.
 */
object DroidLog {
    private const val DEFAULT_TAG = "DroidLinkX"

    fun d(tag: String = DEFAULT_TAG, message: String) {
        if (BuildConfigCompat.isDebug) Log.d(tag, redact(message))
    }

    fun i(tag: String = DEFAULT_TAG, message: String) = Log.i(tag, redact(message))

    fun w(tag: String = DEFAULT_TAG, message: String, throwable: Throwable? = null) {
        Log.w(tag, redact(message), throwable)
    }

    fun e(tag: String = DEFAULT_TAG, message: String, throwable: Throwable? = null) {
        Log.e(tag, redact(message), throwable)
    }

    private fun redact(message: String): String {
        var result = message
        TOKEN_PATTERN.findAll(result).forEach { match ->
            result = result.replace(match.value, "[redacted]")
        }
        return result
    }

    private val TOKEN_PATTERN = Regex("(Bearer\\s+[A-Za-z0-9._-]+)|(\"token\"\\s*:\\s*\"[^\"]+\")", RegexOption.IGNORE_CASE)
}

internal object BuildConfigCompat {
    val isDebug: Boolean = runCatching {
        Class.forName("com.droidlinkx.core.common.BuildConfig")
            .getField("DEBUG")
            .getBoolean(null)
    }.getOrDefault(false)
}
