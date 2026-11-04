package com.nightvision.x.diagnostics.report

import android.content.Context
import android.content.Intent
import android.net.Uri
import com.nightvision.x.diagnostics.data.DiagnosticReport
import java.io.File
import java.time.Instant

object ReportExporter {
    data class CachedReport(val json: File, val text: File)

    fun baseName(report: DiagnosticReport): String {
        val model = report.device.model.lowercase().replace(Regex("[^a-z0-9._-]+"), "-").trim('-')
        val timestamp = Instant.ofEpochMilli(report.generatedAtEpochMs).toString()
            .replace(":", "-").replace(".", "-")
        return "night-vision-camera-${model.ifEmpty { "device" }}-$timestamp"
    }

    fun writeCache(context: Context, report: DiagnosticReport): CachedReport {
        val directory = File(context.cacheDir, "reports").apply { mkdirs() }
        val baseName = baseName(report)
        return CachedReport(
            json = File(directory, "$baseName.json").apply { writeText(DiagnosticReportWriter.json(report)) },
            text = File(directory, "$baseName.txt").apply { writeText(DiagnosticReportWriter.text(report)) },
        )
    }

    fun exportTo(context: Context, uri: Uri, content: String) {
        val stream = context.contentResolver.openOutputStream(uri, "wt")
            ?: throw IllegalStateException("The selected document could not be opened")
        stream.bufferedWriter(Charsets.UTF_8).use { writer -> writer.write(content) }
    }

    fun share(context: Context, report: DiagnosticReport) {
        val files = writeCache(context, report)
        val authority = "${context.packageName}.reports"
        val uris = arrayListOf(
            ReportFileProvider.uriFor(authority, files.json),
            ReportFileProvider.uriFor(authority, files.text),
        )
        val share = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
            type = "*/*"
            putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
            putExtra(Intent.EXTRA_SUBJECT, "Night Vision X PRO — Camera diagnostics (${report.device.model})")
            putExtra(Intent.EXTRA_TEXT, "Actual Camera2 metadata scan from ${report.device.model}. JSON and TXT reports are attached.")
            clipData = android.content.ClipData.newUri(context.contentResolver, "Camera diagnostic report", uris[0]).apply {
                addItem(android.content.ClipData.Item(uris[1]))
            }
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(share, "Share camera diagnostic report").apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        })
    }
}
