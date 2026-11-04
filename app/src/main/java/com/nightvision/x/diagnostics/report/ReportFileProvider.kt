package com.nightvision.x.diagnostics.report

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException

/** Read-only provider restricted to generated reports in cacheDir/reports. */
class ReportFileProvider : ContentProvider() {
    override fun onCreate(): Boolean = true

    override fun getType(uri: Uri): String = when (fileFor(uri).extension.lowercase()) {
        "json" -> "application/json"
        "txt" -> "text/plain"
        else -> "application/octet-stream"
    }

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor {
        val file = fileFor(uri)
        val columns = projection?.toList() ?: listOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        val cursor = MatrixCursor(columns.toTypedArray(), 1)
        cursor.addRow(columns.map { column ->
            when (column) {
                OpenableColumns.DISPLAY_NAME -> file.name
                OpenableColumns.SIZE -> file.length()
                else -> null
            }
        })
        return cursor
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        require(mode == "r" || mode == "rb") { "Reports are read-only" }
        val file = fileFor(uri)
        if (!file.isFile) throw FileNotFoundException("Report no longer exists")
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? =
        throw UnsupportedOperationException("Reports are read-only")

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = 0

    private fun fileFor(uri: Uri): File {
        val context = context ?: throw IllegalStateException("Provider is not attached")
        val segments = uri.pathSegments
        if (segments.size != 2 || segments[0] != "reports") {
            throw FileNotFoundException("Invalid report URI")
        }
        val name = segments[1]
        if (name != File(name).name || (!name.endsWith(".json") && !name.endsWith(".txt"))) {
            throw FileNotFoundException("Invalid report name")
        }
        val directory = File(context.cacheDir, "reports")
        val file = File(directory, name)
        if (file.canonicalFile.parentFile != directory.canonicalFile) {
            throw FileNotFoundException("Report path escapes the cache directory")
        }
        return file
    }

    companion object {
        fun uriFor(authority: String, file: File): Uri = Uri.Builder()
            .scheme("content")
            .authority(authority)
            .appendPath("reports")
            .appendPath(file.name)
            .build()
    }
}
