package com.nightvision.x.diagnostics.ui

import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import com.nightvision.x.diagnostics.data.CameraDiagnostic
import com.nightvision.x.diagnostics.data.CameraValueFormatter
import com.nightvision.x.diagnostics.data.DiagnosticRepository
import com.nightvision.x.diagnostics.data.NightVisionRecommendationEngine

class CameraDetailActivity : DiagnosticActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configureWindow()
        val cameraId = intent.getStringExtra(EXTRA_CAMERA_ID)
        val parentId = intent.getStringExtra(EXTRA_PARENT_ID)
        val camera = cameraId?.let { DiagnosticRepository.camera(it, parentId) }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            fitsSystemWindows = true
            setBackgroundColor(Palette.black)
        }
        root.addView(toolbar(this, camera?.let { "CAMERA ${it.id} / FULL CAPABILITIES" } ?: "CAMERA DETAIL") { finish() })
        val (scroll, content) = scrollColumn(this)
        root.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        if (camera == null) {
            content.addSpaced(panel(this).apply {
                addView(text(this@CameraDetailActivity, "No diagnostic snapshot is available for this camera. Return to the dashboard and run a new hardware scan.", 14f, Palette.secondary))
            })
            return
        }
        renderCamera(content, camera)
    }

    private fun renderCamera(content: LinearLayout, camera: CameraDiagnostic) {
        val f = CameraValueFormatter
        val hero = panel(this, highlighted = true)
        hero.addView(pill(this, if (camera.physicalOnly) "PHYSICAL CAMERA ID" else "LOGICAL CAMERA ID"))
        hero.addSpaced(text(this, "CAMERA ${camera.id}", 30f, Palette.green, bold = true, mono = true), top = 14)
        hero.addSpaced(text(this, camera.role?.label ?: "Role not reported", 18f, Palette.text, bold = true), top = 5)
        camera.role?.let { role ->
            hero.addSpaced(text(this, (if (role.estimated) "ESTIMATED ROLE · " else "HARDWARE / API BASIS · ") + role.basis, 10f, Palette.secondary, mono = true), top = 10)
        }
        content.addSpaced(hero)

        if (!camera.accessible) {
            content.addSpaced(sectionTitle(this, "01 / READ ERROR"), top = 24, bottom = 10)
            content.addSpaced(panel(this).apply {
                addView(text(this@CameraDetailActivity, camera.readError ?: "Unknown Camera2 error", 13f, Palette.error, mono = true))
                addSpaced(text(this@CameraDetailActivity, "No values are substituted for an unreadable camera.", 12f, Palette.secondary), top = 12)
            })
            return
        }

        content.section("01 / IDENTITY", "Camera classification") {
            spec("Camera ID", camera.id, mono = true)
            spec("Entry type", if (camera.physicalOnly) "Physical-only ID" else "Logical camera ID")
            spec("Parent logical ID", camera.parentLogicalId ?: "Not applicable", mono = true)
            spec("Lens facing", camera.lensFacing ?: f.NOT_REPORTED)
            spec("Hardware level", camera.hardwareLevel ?: f.NOT_REPORTED)
            spec("Request capabilities", f.list(camera.capabilities), mono = true)
            spec("Physical camera IDs", f.list(camera.physicalCameraIds), mono = true)
        }

        content.section("02 / SENSOR + EXPOSURE", "Actual hardware ranges") {
            spec("Pixel array size", f.size(camera.pixelArraySize), mono = true)
            spec("Pre-correction active array", f.size(camera.preCorrectionActiveArraySize), mono = true)
            spec("Active array rectangle", camera.activeArrayCrop ?: f.NOT_REPORTED, mono = true)
            spec("Physical sensor size", camera.sensorPhysicalSizeMm?.let {
                "${f.finite(it.widthMm)} × ${f.finite(it.heightMm)} mm"
            } ?: f.NOT_REPORTED, mono = true)
            spec("Sensor orientation", f.integer(camera.sensorOrientationDegrees, "°"))
            spec("Color filter arrangement", camera.colorFilterArrangement ?: f.NOT_REPORTED)
            spec("Timestamp source", camera.timestampSource ?: f.NOT_REPORTED)
            spec("ISO range", f.iso(camera.isoRange), mono = true)
            spec("Exposure range (raw)", f.exposureNs(camera.exposureRangeNs), mono = true)
            spec("Exposure range", f.exposureReadable(camera.exposureRangeNs), mono = true)
            spec("Minimum exposure", camera.exposureRangeNs?.let { f.exposureFraction(it.minimumNs) } ?: f.NOT_REPORTED, mono = true)
            spec("Maximum exposure", camera.exposureRangeNs?.let { f.exposureFraction(it.maximumNs) } ?: f.NOT_REPORTED, mono = true)
            spec("Exposure compensation", camera.exposureCompensationRange?.let {
                "${it.minimum} – ${it.maximum} · step ${camera.exposureCompensationStep?.numerator ?: "?"}/${camera.exposureCompensationStep?.denominator ?: "?"}"
            } ?: f.NOT_REPORTED, mono = true)
            spec("Auto-exposure modes", f.list(camera.autoExposureModes), mono = true)
            spec("Auto white-balance modes", f.list(camera.autoWhiteBalanceModes), mono = true)
            spec("Flash available", f.boolean(camera.flashAvailable, "Yes", "No"))
            spec("Manual sensor", f.boolean(camera.manualSensorSupported))
            spec("RAW capture capability", f.boolean(camera.rawCaptureSupported))
            spec("Max processed streams", f.integer(camera.maximumProcessedStreams))
            spec("Max RAW streams", f.integer(camera.maximumRawStreams))
            spec("Max stalling streams", f.integer(camera.maximumStallingStreams))
            spec("Request pipeline depth", f.integer(camera.requestPipelineDepth))
        }

        content.section("03 / FOCUS + OPTICS", "Lens capabilities") {
            spec("Autofocus modes", f.list(camera.autofocusModes), mono = true)
            spec("Manual focus control (AF OFF)", f.boolean(camera.manualFocusControl))
            spec("Minimum focus distance", f.finite(camera.minimumFocusDistanceDiopters, " diopters"), mono = true)
            spec("Hyperfocal distance", f.finite(camera.hyperfocalDistanceDiopters, " diopters"), mono = true)
            spec("Focus distance calibration", camera.focusDistanceCalibration ?: f.NOT_REPORTED)
            spec("Available focal lengths", f.floatList(camera.focalLengthsMm, " mm"), mono = true)
            spec("Available apertures", f.floatList(camera.apertures, " (f-number)"), mono = true)
            spec("Filter densities", f.floatList(camera.filterDensities, " EV"), mono = true)
            spec("Optical stabilization modes", f.list(camera.opticalStabilizationModes), mono = true)
        }

        content.section("04 / TIMING + STABILIZATION", "Advertised operating modes") {
            spec("Target FPS ranges", f.fps(camera.targetFpsRanges), mono = true)
            spec("Video stabilization modes", f.list(camera.videoStabilizationModes), mono = true)
        }

        content.addSpaced(sectionTitle(this, "05 / OUTPUT FORMATS", "Formats and supported resolutions"), top = 28, bottom = 10)
        val formats = camera.outputFormats
        when {
            formats == null -> content.addSpaced(panel(this).apply { addView(text(this@CameraDetailActivity, f.NOT_REPORTED, 13f, Palette.secondary)) })
            formats.isEmpty() -> content.addSpaced(panel(this).apply { addView(text(this@CameraDetailActivity, "Empty output-format list reported", 13f, Palette.secondary)) })
            else -> formats.forEach { format ->
                content.addSpaced(panel(this).apply {
                    addView(text(this@CameraDetailActivity, format.name, 14f, Palette.green, bold = true, mono = true))
                    addView(text(this@CameraDetailActivity, "FORMAT CODE ${format.code} / 0x${Integer.toHexString(format.code).uppercase()}", 10f, Palette.dim, mono = true))
                    format.readError?.let { addSpaced(text(this@CameraDetailActivity, "Read error: $it", 11f, Palette.error), top = 8) }
                    addSpaced(text(this@CameraDetailActivity, "STANDARD OUTPUT SIZES", 10f, Palette.secondary, bold = true, mono = true), top = 14)
                    addSpaced(text(this@CameraDetailActivity, f.sizes(format.sizes), 11f, Palette.text, mono = true).apply {
                        setTextIsSelectable(true)
                    }, top = 7)
                    if (format.highResolutionSizes != null) {
                        addSpaced(text(this@CameraDetailActivity, "HIGH-RESOLUTION OUTPUT SIZES", 10f, Palette.secondary, bold = true, mono = true), top = 14)
                        addSpaced(text(this@CameraDetailActivity, f.sizes(format.highResolutionSizes), 11f, Palette.text, mono = true).apply {
                            setTextIsSelectable(true)
                        }, top = 7)
                    }
                }, bottom = 10)
            }
        }

        content.section("06 / ENGINE BRIEF", "Recommendations for camera ${camera.id}") {
            NightVisionRecommendationEngine.forCamera(camera).forEach { recommendation ->
                addSpaced(text(this@CameraDetailActivity, "• $recommendation", 12f, Palette.secondary), top = 10)
            }
        }
        content.addSpaced(text(this, "Static metadata does not validate a capture-session combination or prove sustained FPS. “Not reported” is never replaced with a guessed specification.", 11f, Palette.dim), top = 22)
    }

    private inline fun LinearLayout.section(
        eyebrow: String,
        title: String,
        body: LinearLayout.() -> Unit,
    ) {
        addSpaced(sectionTitle(this@CameraDetailActivity, eyebrow, title), top = 28, bottom = 10)
        addSpaced(panel(this@CameraDetailActivity).apply { body() })
    }

    private fun LinearLayout.spec(label: String, value: String, mono: Boolean = false) {
        if (childCount > 0) addView(divider(this@CameraDetailActivity))
        addView(specRow(this@CameraDetailActivity, label, value, monoValue = mono))
    }

    companion object {
        const val EXTRA_CAMERA_ID = "camera_id"
        const val EXTRA_PARENT_ID = "parent_id"
    }
}
