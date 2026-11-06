package com.droidlinkx.app.crash

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import com.droidlinkx.app.BuildConfig
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Last-resort crash capture.
 *
 * An uncaught exception normally shows "app keeps stopping" with nothing actionable, and logcat is
 * unavailable on a normal phone. This handler writes the stack trace to internal storage before the
 * process dies; the next launch shows it on screen with a copy button, so a crash is always
 * diagnosable by the person holding the device.
 *
 * Installed from [CrashInitProvider] because a ContentProvider is created *before*
 * `Application.onCreate()`, which means even a failure while Hilt builds the application component
 * is captured.
 */
object CrashGuard {

    private const val FILE_NAME = "crash-last.txt"
    private const val MAX_STACK_CHARS = 20_000

    @Volatile
    private var installed = false

    fun install(context: Context) {
        if (installed) return
        installed = true
        val appContext = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching { write(appContext, thread, throwable) }
            if (previous != null) {
                previous.uncaughtException(thread, throwable)
            } else {
                android.os.Process.killProcess(android.os.Process.myPid())
                kotlin.system.exitProcess(10)
            }
        }
    }

    private fun reportFile(context: Context): File = File(context.filesDir, FILE_NAME)

    private fun write(context: Context, thread: Thread, throwable: Throwable) {
        val buffer = StringWriter()
        throwable.printStackTrace(PrintWriter(buffer))
        val stack = buffer.toString()
        val report = buildString {
            appendLine("DroidLink X — crash report")
            appendLine("time: ${SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).format(Date())}")
            appendLine("app: ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
            appendLine(
                "device: ${Build.MANUFACTURER} ${Build.MODEL} • Android ${Build.VERSION.RELEASE} " +
                    "(API ${Build.VERSION.SDK_INT})",
            )
            appendLine("thread: ${thread.name}")
            appendLine()
            append(stack.take(MAX_STACK_CHARS))
        }
        reportFile(context).writeText(report)
    }

    /** The most recent crash, or `null` when the app has not crashed since the last dismissal. */
    fun lastReport(context: Context): String? = runCatching {
        val file = reportFile(context)
        if (!file.exists()) return null
        file.readText().takeIf { it.isNotBlank() }
    }.getOrNull()

    fun clear(context: Context) {
        runCatching { reportFile(context).delete() }
    }

    fun copyToClipboard(context: Context, text: String) {
        runCatching {
            val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return
            clipboard.setPrimaryClip(ClipData.newPlainText("DroidLink X crash", text))
        }
    }
}
