package com.nightvision.x.diagnostics.ui

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.ImageFormat
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.Toast
import com.nightvision.x.diagnostics.data.Camera2DiagnosticScanner
import com.nightvision.x.diagnostics.data.CameraDiagnostic
import com.nightvision.x.diagnostics.data.CameraValueFormatter
import com.nightvision.x.diagnostics.data.DiagnosticReport
import com.nightvision.x.diagnostics.data.DiagnosticRepository
import com.nightvision.x.diagnostics.data.supportsOutput
import com.nightvision.x.diagnostics.report.DiagnosticReportWriter
import com.nightvision.x.diagnostics.report.ReportExporter
import java.text.DateFormat
import java.util.Date
import java.util.concurrent.Executors

class MainActivity : DiagnosticActivity() {
    private lateinit var content: LinearLayout
    private val handler = Handler(Looper.getMainLooper())
    private val scanExecutor = Executors.newSingleThreadExecutor()
    private var pendingError: String? = null

    private val awaitScan = object : Runnable {
        override fun run() {
            if (isDestroyed) return
            if (DiagnosticRepository.scanInProgress.get()) {
                handler.postDelayed(this, 250)
            } else {
                render()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configureWindow()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            fitsSystemWindows = true
            setBackgroundColor(Palette.black)
        }
        root.addView(toolbar(this, "CAMERA DIAGNOSTICS / HARDWARE ONLY"))
        val (scroll, column) = scrollColumn(this)
        content = column
        root.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        render()

        if (DiagnosticRepository.latestReport == null && !DiagnosticRepository.scanInProgress.get()) {
            content.postDelayed({ if (!isDestroyed) startScan() }, 350)
        } else if (DiagnosticRepository.scanInProgress.get()) {
            handler.post(awaitScan)
        }
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        // Allow an in-flight characteristics read to finish, but never leave a worker thread alive.
        scanExecutor.shutdown()
        super.onDestroy()
    }

    private fun startScan() {
        if (!DiagnosticRepository.scanInProgress.compareAndSet(false, true)) return
        pendingError = null
        render()
        scanExecutor.execute {
            var report: DiagnosticReport? = null
            var failure: String? = null
            try {
                report = Camera2DiagnosticScanner(applicationContext).scan()
                DiagnosticRepository.publish(report)
            } catch (error: Exception) {
                failure = "${error.javaClass.simpleName}: ${error.message ?: "No error message"}"
            } finally {
                DiagnosticRepository.scanInProgress.set(false)
            }
            val completedReport = report
            handler.post {
                if (!isDestroyed) {
                    pendingError = failure
                    render()
                    if (completedReport != null) {
                        Toast.makeText(
                            this,
                            "Scan complete · ${completedReport.cameras.size} camera entries",
                            Toast.LENGTH_SHORT,
                        ).show()
                    }
                }
            }
        }
    }

    private fun render() {
        if (!::content.isInitialized) return
        content.removeAllViews()
        val report = DiagnosticRepository.latestReport
        val scanning = DiagnosticRepository.scanInProgress.get()
        renderHero(report, scanning)
        renderStats(report)
        renderCameraList(report, scanning)
        if (report != null && !scanning) renderReportSections(report)
        renderFooter()
    }

    private fun renderHero(report: DiagnosticReport?, scanning: Boolean) {
        val hero = panel(this, highlighted = true)
        hero.addView(pill(this, when {
            scanning -> "SCAN IN PROGRESS"
            report != null -> "HARDWARE SCAN COMPLETE"
            else -> "DIAGNOSTIC MODE 01"
        }))
        hero.addSpaced(text(this, "Know your sensor.\nBefore you enhance it.", 28f, Palette.text, bold = true), top = 15)
        hero.addSpaced(text(
            this,
            "A read-only Camera2 inspection of every logical camera and accessible physical camera. No frames are captured and no specifications are prefilled.",
            13f,
            Palette.secondary,
        ), top = 10)

        val devicePanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(13), dp(12), dp(13), dp(12))
            setBackgroundColor(Palette.black.copyAlpha(0.38f))
        }
        devicePanel.addView(specRow(this, "Detected device", "${Build.MANUFACTURER} ${Build.MODEL}", monoValue = true))
        devicePanel.addView(specRow(this, "Android / ABI", "${Build.VERSION.RELEASE} · API ${Build.VERSION.SDK_INT} · ${Build.SUPPORTED_ABIS.firstOrNull().orEmpty()}"))
        devicePanel.addView(specRow(this, "Target profile", "Infinix GT 30 Pro · X6873 · API 36"))
        hero.addSpaced(devicePanel, top = 16)

        if (scanning) {
            hero.addSpaced(ProgressBar(this).apply { isIndeterminate = true }, top = 16)
            hero.addSpaced(text(this, "Reading CameraCharacteristics…", 12f, Palette.green, mono = true), top = 8)
        }

        val scan = actionButton(this, if (report == null) "RUN HARDWARE SCAN" else "RESCAN HARDWARE").apply {
            isEnabled = !scanning
            alpha = if (scanning) 0.45f else 1f
            setOnClickListener { startScan() }
        }
        hero.addSpaced(scan, top = 16)

        if (report != null && !scanning) {
            val exportRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            exportRow.addWeighted(actionButton(this, "EXPORT JSON", primary = false).apply {
                setOnClickListener { createDocument(false) }
            }, endMargin = 8)
            exportRow.addWeighted(actionButton(this, "EXPORT TXT", primary = false).apply {
                setOnClickListener { createDocument(true) }
            })
            hero.addSpaced(exportRow, top = 10)
            hero.addSpaced(actionButton(this, "SHARE JSON + TXT", primary = false).apply {
                setOnClickListener { shareReport(report) }
            }, top = 10)
            hero.addSpaced(text(
                this,
                "Last scan: ${DateFormat.getDateTimeInstance().format(Date(report.generatedAtEpochMs))}",
                10f,
                Palette.dim,
                mono = true,
            ), top = 12)
        }
        pendingError?.let {
            hero.addSpaced(text(this, "Scan failed: $it", 12f, Palette.error), top = 12)
        }
        content.addSpaced(hero)
    }

    private fun renderStats(report: DiagnosticReport?) {
        val accessible = report?.cameras?.filter { it.accessible }.orEmpty()
        val values = listOf(
            (report?.logicalCameras?.size?.toString() ?: "—") to "LOGICAL CAMERAS",
            (report?.physicalOnlyCameras?.size?.toString() ?: "—") to "PHYSICAL-ONLY IDS",
            (accessible.count { it.manualSensorSupported == true }.takeIf { report != null }?.toString() ?: "—") to "MANUAL SENSOR",
            (accessible.count { it.rawCaptureSupported == true }.takeIf { report != null }?.toString() ?: "—") to "RAW CAPABLE",
        )
        val stats = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        values.chunked(2).forEachIndexed { rowIndex, pair ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            pair.forEachIndexed { index, item ->
                row.addWeighted(statCard(this, item.first, item.second), endMargin = if (index == 0) 8 else 0)
            }
            stats.addSpaced(row, top = if (rowIndex == 0) 0 else 8)
        }
        content.addSpaced(stats, top = 10)
    }

    private fun renderCameraList(report: DiagnosticReport?, scanning: Boolean) {
        content.addSpaced(sectionTitle(
            this,
            "01 / CAMERA INVENTORY",
            if (report == null) "Waiting for hardware" else "${report.cameras.size} camera entries",
        ), top = 28, bottom = 12)
        when {
            scanning -> content.addSpaced(text(this, "Reading every logical and accessible physical camera ID…", 12f, Palette.secondary))
            report == null -> content.addSpaced(panel(this).apply {
                addView(text(this@MainActivity, "No scan has completed yet. Camera values will appear here directly from Android — never from a device-specific lookup table.", 13f, Palette.secondary))
            })
            report.cameras.isEmpty() -> content.addSpaced(panel(this).apply {
                addView(text(this@MainActivity, "CameraManager returned no camera entries. Check the scan warnings below and the device's camera availability.", 13f, Palette.warning))
            })
            else -> report.cameras.forEach { camera -> content.addSpaced(cameraCard(camera), bottom = 10) }
        }
    }

    private fun cameraCard(camera: CameraDiagnostic): View {
        val card = panel(this)
        card.isClickable = true
        card.isFocusable = true
        card.foreground = obtainStyledAttributes(intArrayOf(android.R.attr.selectableItemBackground)).let {
            val drawable = it.getDrawable(0)
            it.recycle()
            drawable
        }
        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        header.addView(text(this, "CAM ${camera.id}", 20f, Palette.green, bold = true, mono = true), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        header.addView(pill(this, if (camera.physicalOnly) "PHYSICAL" else "LOGICAL", positive = camera.accessible))
        card.addView(header)
        card.addSpaced(text(
            this,
            if (camera.accessible) camera.role?.label ?: "Camera role not reported" else "METADATA UNAVAILABLE",
            15f,
            if (camera.accessible) Palette.text else Palette.error,
            bold = true,
        ), top = 10)
        if (camera.parentLogicalId != null) {
            card.addSpaced(text(this, "Owner: logical camera ${camera.parentLogicalId}", 11f, Palette.dim, mono = true), top = 4)
        }
        card.setOnClickListener {
            startActivity(Intent(this, CameraDetailActivity::class.java).apply {
                putExtra(CameraDetailActivity.EXTRA_CAMERA_ID, camera.id)
                putExtra(CameraDetailActivity.EXTRA_PARENT_ID, camera.parentLogicalId)
            })
        }
        if (!camera.accessible) {
            card.addSpaced(text(this, camera.readError ?: "Unknown Camera2 read error", 12f, Palette.secondary), top = 10)
            card.addSpaced(text(this, "TAP FOR READ ERROR  →", 10f, Palette.green, bold = true, mono = true), top = 14)
            return card
        }
        card.addSpaced(specRow(this, "Facing / hardware", "${camera.lensFacing ?: "Not reported"} · ${camera.hardwareLevel ?: "Not reported"}"), top = 8)
        card.addView(specRow(this, "Pixel array", CameraValueFormatter.size(camera.pixelArraySize), monoValue = true))
        card.addView(specRow(this, "Sensitivity", CameraValueFormatter.iso(camera.isoRange), monoValue = true))
        card.addView(specRow(this, "Exposure", CameraValueFormatter.exposureReadable(camera.exposureRangeNs), monoValue = true))
        val chips = FlowLayout(this)
        chips.addView(capabilityPill("MANUAL", camera.manualSensorSupported))
        chips.addView(capabilityPill("RAW", camera.rawCaptureSupported))
        chips.addView(capabilityPill("YUV 420", camera.supportsOutput(ImageFormat.YUV_420_888)))
        chips.addView(capabilityPill("OIS", camera.opticalStabilizationModes?.contains("ON")))
        chips.addView(capabilityPill("EIS", camera.videoStabilizationModes?.contains("ON")))
        card.addSpaced(chips, top = 12)
        card.addSpaced(text(this, "TAP FOR FULL CAPABILITIES  →", 10f, Palette.green, bold = true, mono = true), top = 16)
        return card
    }

    private fun capabilityPill(label: String, supported: Boolean?) = pill(
        this,
        when (supported) {
            true -> "$label  ✓"
            false -> "$label  —"
            null -> "$label  ?"
        },
        positive = supported == true,
    )

    private fun renderReportSections(report: DiagnosticReport) {
        if (report.scanWarnings.isNotEmpty()) {
            content.addSpaced(sectionTitle(this, "02 / SCAN WARNINGS"), top = 22, bottom = 10)
            content.addSpaced(panel(this).apply {
                report.scanWarnings.forEach { warning ->
                    addSpaced(text(this@MainActivity, "• $warning", 12f, Palette.warning), top = 5)
                }
            })
        }
        content.addSpaced(sectionTitle(this, "03 / ENGINE BRIEF", "Evidence-based recommendations"), top = 26, bottom = 10)
        content.addSpaced(panel(this).apply {
            addView(text(this@MainActivity, "For the next approved Night Vision phase", 13f, Palette.green, bold = true))
            report.recommendations.take(7).forEach { recommendation ->
                addSpaced(text(this@MainActivity, "• $recommendation", 12f, Palette.secondary), top = 10)
            }
            if (report.recommendations.size > 7) {
                addSpaced(text(this@MainActivity, "+ ${report.recommendations.size - 7} more in the exported report and camera detail screens.", 11f, Palette.dim), top = 12)
            }
        })
    }

    private fun renderFooter() {
        content.addSpaced(panel(this).apply {
            addView(text(this@MainActivity, "READ-ONLY BY DESIGN", 11f, Palette.green, bold = true, mono = true))
            addSpaced(text(this@MainActivity, "No CAMERA permission · No preview · No ImageReader · No recording · No sensor simulation", 11f, Palette.secondary), top = 8)
            addSpaced(text(this@MainActivity, "Camera role names are hardware-reported only for facing. “Main” and “Ultra-wide” remain explicitly estimated when derived from optics.", 11f, Palette.dim), top = 8)
        }, top = 24)
        content.addSpaced(text(this, "NIGHT VISION X PRO  /  DIAGNOSTIC BUILD 1.0.0", 9f, Palette.dim, mono = true).apply {
            textAlignment = View.TEXT_ALIGNMENT_CENTER
        }, top = 20)
    }

    private fun createDocument(text: Boolean) {
        val report = DiagnosticRepository.latestReport ?: return
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = if (text) "text/plain" else "application/json"
            putExtra(Intent.EXTRA_TITLE, ReportExporter.baseName(report) + if (text) ".txt" else ".json")
        }
        try {
            startActivityForResult(intent, if (text) REQUEST_TXT else REQUEST_JSON)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "No document provider is available. Use Share instead.", Toast.LENGTH_LONG).show()
        }
    }

    private fun shareReport(report: DiagnosticReport) {
        try {
            ReportExporter.share(this, report)
        } catch (error: Exception) {
            Toast.makeText(this, "Could not share report: ${error.message}", Toast.LENGTH_LONG).show()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != Activity.RESULT_OK || (requestCode != REQUEST_JSON && requestCode != REQUEST_TXT)) return
        val uri: Uri = data?.data ?: return
        val report = DiagnosticRepository.latestReport ?: return
        try {
            val content = if (requestCode == REQUEST_TXT) {
                DiagnosticReportWriter.text(report)
            } else {
                DiagnosticReportWriter.json(report)
            }
            ReportExporter.exportTo(this, uri, content)
            Toast.makeText(this, "Diagnostic report saved", Toast.LENGTH_SHORT).show()
        } catch (error: Exception) {
            Toast.makeText(this, "Export failed: ${error.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun Int.copyAlpha(alpha: Float): Int = android.graphics.Color.argb(
        (alpha * 255).toInt(),
        android.graphics.Color.red(this),
        android.graphics.Color.green(this),
        android.graphics.Color.blue(this),
    )

    companion object {
        private const val REQUEST_JSON = 4101
        private const val REQUEST_TXT = 4102
    }
}
