package com.nightvision.x.diagnostics.report

import com.nightvision.x.diagnostics.data.CameraDiagnostic
import com.nightvision.x.diagnostics.data.CameraValueFormatter
import com.nightvision.x.diagnostics.data.DiagnosticReport
import com.nightvision.x.diagnostics.data.IntRangeInfo
import com.nightvision.x.diagnostics.data.OutputFormatInfo
import com.nightvision.x.diagnostics.data.SizeInfo
import com.nightvision.x.diagnostics.data.SizeWithDuration
import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject

/** Stable JSON schema plus a human-readable report generated from the same immutable snapshot. */
object DiagnosticReportWriter {
    fun json(report: DiagnosticReport): String = reportJson(report).toString(2)

    private fun reportJson(report: DiagnosticReport): JSONObject = JSONObject().apply {
        put("schema_version", report.schemaVersion)
        put("application", report.application)
        put("package_name", report.packageName)
        put("generated_at_epoch_ms", report.generatedAtEpochMs)
        put("generated_at_utc", Instant.ofEpochMilli(report.generatedAtEpochMs).toString())
        put("data_source", "Android Camera2 CameraCharacteristics; no camera frames captured")
        put("null_semantics", "null = value not reported or not readable; no defaults are substituted")
        put("device", JSONObject().apply {
            put("manufacturer", report.device.manufacturer)
            put("brand", report.device.brand)
            put("model", report.device.model)
            put("device", report.device.device)
            put("android_release", report.device.androidRelease)
            put("sdk_int", report.device.sdkInt)
            putNullable("security_patch", report.device.securityPatch)
            put("supported_abis", JSONArray(report.device.supportedAbis))
        })
        put("summary", JSONObject().apply {
            put("logical_camera_count", report.logicalCameras.size)
            put("physical_only_camera_count", report.physicalOnlyCameras.size)
            put("accessible_camera_count", report.cameras.count { it.accessible })
            put("unreadable_camera_count", report.cameras.count { !it.accessible })
        })
        put("cameras", JSONArray().apply { report.cameras.forEach { put(cameraJson(it)) } })
        put("scan_warnings", JSONArray(report.scanWarnings))
        put("night_vision_recommendations", JSONArray(report.recommendations))
    }

    private fun cameraJson(camera: CameraDiagnostic): JSONObject = JSONObject().apply {
        put("id", camera.id)
        putNullable("parent_logical_id", camera.parentLogicalId)
        put("physical_only", camera.physicalOnly)
        put("accessible", camera.accessible)
        putNullable("read_error", camera.readError)
        putNullable("lens_facing", camera.lensFacing)
        put("role", camera.role?.let {
            JSONObject().apply {
                put("label", it.label)
                put("estimated", it.estimated)
                put("basis", it.basis)
            }
        } ?: JSONObject.NULL)
        putNullable("hardware_level", camera.hardwareLevel)
        putNullable("capabilities", camera.capabilities?.let(::JSONArray))
        putNullable("physical_camera_ids", camera.physicalCameraIds?.let(::JSONArray))
        put("sensor", JSONObject().apply {
            put("pixel_array_size", sizeJson(camera.pixelArraySize))
            put("pre_correction_active_array_size", sizeJson(camera.preCorrectionActiveArraySize))
            putNullable("active_array_rectangle", camera.activeArrayCrop)
            put("physical_size_mm", camera.sensorPhysicalSizeMm?.let {
                JSONObject().apply {
                    putFinite("width", it.widthMm)
                    putFinite("height", it.heightMm)
                }
            } ?: JSONObject.NULL)
            putNullable("orientation_degrees", camera.sensorOrientationDegrees)
            putNullable("color_filter_arrangement", camera.colorFilterArrangement)
            putNullable("timestamp_source", camera.timestampSource)
        })
        put("exposure", JSONObject().apply {
            put("iso_range", intRangeJson(camera.isoRange))
            put("exposure_time_ns", camera.exposureRangeNs?.let {
                JSONObject().apply {
                    put("minimum", it.minimumNs)
                    put("maximum", it.maximumNs)
                    put("minimum_ms", it.minimumNs / 1_000_000.0)
                    put("maximum_ms", it.maximumNs / 1_000_000.0)
                }
            } ?: JSONObject.NULL)
            put("exposure_compensation_range", intRangeJson(camera.exposureCompensationRange))
            put("exposure_compensation_step", camera.exposureCompensationStep?.let {
                JSONObject().apply {
                    put("numerator", it.numerator)
                    put("denominator", it.denominator)
                    putNullable("decimal", it.decimal)
                }
            } ?: JSONObject.NULL)
            putNullable("auto_exposure_modes", camera.autoExposureModes?.let(::JSONArray))
            putNullable("auto_white_balance_modes", camera.autoWhiteBalanceModes?.let(::JSONArray))
            putNullable("flash_available", camera.flashAvailable)
        })
        put("capture_capabilities", JSONObject().apply {
            putNullable("manual_sensor_supported", camera.manualSensorSupported)
            putNullable("raw_capture_supported", camera.rawCaptureSupported)
            putNullable("maximum_processed_streams", camera.maximumProcessedStreams)
            putNullable("maximum_raw_streams", camera.maximumRawStreams)
            putNullable("maximum_stalling_streams", camera.maximumStallingStreams)
            putNullable("request_pipeline_depth", camera.requestPipelineDepth)
        })
        put("focus_and_optics", JSONObject().apply {
            putNullable("autofocus_modes", camera.autofocusModes?.let(::JSONArray))
            putNullable("manual_focus_control", camera.manualFocusControl)
            putFinite("minimum_focus_distance_diopters", camera.minimumFocusDistanceDiopters)
            putFinite("hyperfocal_distance_diopters", camera.hyperfocalDistanceDiopters)
            putNullable("focus_distance_calibration", camera.focusDistanceCalibration)
            putNullable("focal_lengths_mm", camera.focalLengthsMm?.let(::finiteJsonArray))
            putNullable("apertures", camera.apertures?.let(::finiteJsonArray))
            putNullable("filter_densities", camera.filterDensities?.let(::finiteJsonArray))
            putNullable("optical_stabilization_modes", camera.opticalStabilizationModes?.let(::JSONArray))
        })
        put("timing_and_stabilization", JSONObject().apply {
            putNullable("video_stabilization_modes", camera.videoStabilizationModes?.let(::JSONArray))
            put("target_fps_ranges", camera.targetFpsRanges?.let { ranges ->
                JSONArray().apply {
                    ranges.forEach {
                        put(JSONObject().apply {
                            put("minimum", it.minimum)
                            put("maximum", it.maximum)
                        })
                    }
                }
            } ?: JSONObject.NULL)
        })
        put("output_formats", camera.outputFormats?.let { formats ->
            JSONArray().apply { formats.forEach { put(outputFormatJson(it)) } }
        } ?: JSONObject.NULL)
    }

    private fun outputFormatJson(format: OutputFormatInfo): JSONObject = JSONObject().apply {
        put("code", format.code)
        put("name", format.name)
        put("sizes", format.sizes?.let(::sizesJson) ?: JSONObject.NULL)
        put("high_resolution_sizes", format.highResolutionSizes?.let(::sizesJson) ?: JSONObject.NULL)
        putNullable("read_error", format.readError)
    }

    private fun sizesJson(sizes: List<SizeWithDuration>): JSONArray = JSONArray().apply {
        sizes.forEach { entry ->
            put(JSONObject().apply {
                put("width", entry.size.width)
                put("height", entry.size.height)
                putNullable("minimum_frame_duration_ns", entry.minimumFrameDurationNs)
            })
        }
    }

    private fun sizeJson(size: SizeInfo?): Any = size?.let {
        JSONObject().apply {
            put("width", it.width)
            put("height", it.height)
        }
    } ?: JSONObject.NULL

    private fun intRangeJson(range: IntRangeInfo?): Any = range?.let {
        JSONObject().apply {
            put("minimum", it.minimum)
            put("maximum", it.maximum)
        }
    } ?: JSONObject.NULL

    private fun finiteJsonArray(values: List<Float>) = JSONArray().apply {
        values.forEach { value ->
            put(if (value.isFinite()) value.toDouble() else JSONObject.NULL)
        }
    }

    private fun JSONObject.putNullable(key: String, value: Any?) {
        put(key, value ?: JSONObject.NULL)
    }

    private fun JSONObject.putFinite(key: String, value: Float?) {
        put(key, if (value?.isFinite() == true) value.toDouble() else JSONObject.NULL)
    }

    fun text(report: DiagnosticReport): String = buildString {
        appendLine("NIGHT VISION X PRO — CAMERA DIAGNOSTIC REPORT")
        appendLine("================================================")
        appendLine("Generated (UTC): ${Instant.ofEpochMilli(report.generatedAtEpochMs).toString()}")
        appendLine("Data source: Android Camera2 CameraCharacteristics")
        appendLine("No camera was opened. No frames, images, audio, or video were captured.")
        appendLine("'Not reported' means Android returned no readable value; no defaults were substituted.")
        appendLine()
        appendLine("DEVICE")
        appendLine("------")
        appendLine("Manufacturer: ${report.device.manufacturer}")
        appendLine("Brand: ${report.device.brand}")
        appendLine("Model: ${report.device.model}")
        appendLine("Device: ${report.device.device}")
        appendLine("Android: ${report.device.androidRelease} (API ${report.device.sdkInt})")
        appendLine("Security patch: ${report.device.securityPatch ?: CameraValueFormatter.NOT_REPORTED}")
        appendLine("ABIs: ${report.device.supportedAbis.joinToString()}")
        appendLine()
        appendLine("SUMMARY")
        appendLine("-------")
        appendLine("Logical cameras: ${report.logicalCameras.size}")
        appendLine("Additional physical-only cameras: ${report.physicalOnlyCameras.size}")
        appendLine("Readable cameras: ${report.cameras.count { it.accessible }}")
        appendLine("Unreadable cameras: ${report.cameras.count { !it.accessible }}")
        appendLine()

        report.cameras.forEach { camera -> appendCamera(camera) }

        appendLine("SCAN WARNINGS")
        appendLine("-------------")
        if (report.scanWarnings.isEmpty()) appendLine("None")
        else report.scanWarnings.forEach { appendLine("- $it") }
        appendLine()
        appendLine("NIGHT VISION ENGINE RECOMMENDATIONS")
        appendLine("-----------------------------------")
        report.recommendations.forEach { appendLine("- $it") }
        appendLine()
        appendLine("LIMITATIONS")
        appendLine("-----------")
        appendLine("Camera IDs and lens facing are hardware/API values. Main, ultra-wide, and telephoto names")
        appendLine("are estimates only when explicitly marked; they are derived from focal length and sensor")
        appendLine("dimensions because Camera2 does not expose marketing role names.")
        appendLine("Static metadata does not guarantee every setting combination or sustained capture rate.")
        appendLine("A diagnostic scan is not a camera preview, image-quality test, or Night Vision engine.")
    }

    private fun StringBuilder.appendCamera(camera: CameraDiagnostic) {
        val f = CameraValueFormatter
        appendLine("CAMERA ${camera.id} ${if (camera.physicalOnly) "[PHYSICAL ONLY]" else "[LOGICAL]"}")
        appendLine("================================================")
        if (!camera.accessible) {
            appendLine("Status: Unreadable")
            appendLine("Error: ${camera.readError ?: "Unknown read error"}")
            appendLine()
            return
        }
        appendLine("Status: Readable")
        appendLine("Parent logical camera: ${camera.parentLogicalId ?: "Not applicable"}")
        appendLine("Lens facing: ${camera.lensFacing ?: f.NOT_REPORTED}")
        appendLine("Role: ${camera.role?.label ?: f.NOT_REPORTED}")
        appendLine("Role basis: ${camera.role?.basis ?: f.NOT_REPORTED}")
        appendLine("Hardware level: ${camera.hardwareLevel ?: f.NOT_REPORTED}")
        appendLine("Capabilities:\n${f.list(camera.capabilities).prependIndent("  ")}")
        appendLine("Physical camera IDs:\n${f.list(camera.physicalCameraIds).prependIndent("  ")}")
        appendLine()
        appendLine("Sensor / exposure")
        appendLine("  Pixel array: ${f.size(camera.pixelArraySize)}")
        appendLine("  Pre-correction active array: ${f.size(camera.preCorrectionActiveArraySize)}")
        appendLine("  Active array rectangle: ${camera.activeArrayCrop ?: f.NOT_REPORTED}")
        appendLine("  Physical sensor size: ${camera.sensorPhysicalSizeMm?.let { "${f.finite(it.widthMm)} × ${f.finite(it.heightMm)} mm" } ?: f.NOT_REPORTED}")
        appendLine("  Sensor orientation: ${f.integer(camera.sensorOrientationDegrees, "°")}")
        appendLine("  Color filter: ${camera.colorFilterArrangement ?: f.NOT_REPORTED}")
        appendLine("  Timestamp source: ${camera.timestampSource ?: f.NOT_REPORTED}")
        appendLine("  ISO range: ${f.iso(camera.isoRange)}")
        appendLine("  Exposure range: ${f.exposureNs(camera.exposureRangeNs)}")
        appendLine("  Exposure range (readable): ${f.exposureReadable(camera.exposureRangeNs)}")
        camera.exposureRangeNs?.let {
            appendLine("  Minimum exposure: ${f.exposureFraction(it.minimumNs)}")
            appendLine("  Maximum exposure: ${f.exposureFraction(it.maximumNs)}")
        }
        appendLine("  Exposure compensation range: ${camera.exposureCompensationRange?.let { "${it.minimum} – ${it.maximum}" } ?: f.NOT_REPORTED}")
        appendLine("  Exposure compensation step: ${camera.exposureCompensationStep?.let { "${it.numerator}/${it.denominator}" } ?: f.NOT_REPORTED}")
        appendLine("  AE modes:\n${f.list(camera.autoExposureModes).prependIndent("    ")}")
        appendLine("  AWB modes:\n${f.list(camera.autoWhiteBalanceModes).prependIndent("    ")}")
        appendLine("  Flash available: ${f.boolean(camera.flashAvailable, "Yes", "No")}")
        appendLine("  Manual sensor: ${f.boolean(camera.manualSensorSupported)}")
        appendLine("  RAW capture capability: ${f.boolean(camera.rawCaptureSupported)}")
        appendLine("  Max processed/raw/stalling streams: ${camera.maximumProcessedStreams ?: "?"} / ${camera.maximumRawStreams ?: "?"} / ${camera.maximumStallingStreams ?: "?"}")
        appendLine("  Request pipeline depth: ${f.integer(camera.requestPipelineDepth)}")
        appendLine()
        appendLine("Focus / optics")
        appendLine("  AF modes:\n${f.list(camera.autofocusModes).prependIndent("    ")}")
        appendLine("  Manual focus control (AF OFF): ${f.boolean(camera.manualFocusControl)}")
        appendLine("  Minimum focus distance: ${f.finite(camera.minimumFocusDistanceDiopters, " diopters")}")
        appendLine("  Hyperfocal distance: ${f.finite(camera.hyperfocalDistanceDiopters, " diopters")}")
        appendLine("  Focus distance calibration: ${camera.focusDistanceCalibration ?: f.NOT_REPORTED}")
        appendLine("  Focal lengths: ${f.floatList(camera.focalLengthsMm, " mm")}")
        appendLine("  Apertures: ${f.floatList(camera.apertures, " (f-number)")}")
        appendLine("  Filter densities: ${f.floatList(camera.filterDensities, " EV")}")
        appendLine("  Optical stabilization:\n${f.list(camera.opticalStabilizationModes).prependIndent("    ")}")
        appendLine()
        appendLine("Timing / stabilization")
        appendLine("  Video stabilization:\n${f.list(camera.videoStabilizationModes).prependIndent("    ")}")
        appendLine("  Target FPS ranges:\n${f.fps(camera.targetFpsRanges).prependIndent("    ")}")
        appendLine()
        appendLine("Output formats / resolutions")
        val formats = camera.outputFormats
        if (formats == null) {
            appendLine("  ${f.NOT_REPORTED}")
        } else if (formats.isEmpty()) {
            appendLine("  Empty list reported")
        } else {
            formats.forEach { format ->
                appendLine("  ${format.name} [code=${format.code}]")
                if (format.readError != null) appendLine("    Read error: ${format.readError}")
                appendLine("    Standard sizes:\n${f.sizes(format.sizes).prependIndent("      ")}")
                if (format.highResolutionSizes != null) {
                    appendLine("    High-resolution sizes:\n${f.sizes(format.highResolutionSizes).prependIndent("      ")}")
                }
            }
        }
        appendLine()
        appendLine("Recommendations for camera ${camera.id}")
        com.nightvision.x.diagnostics.data.NightVisionRecommendationEngine.forCamera(camera)
            .forEach { appendLine("  - $it") }
        appendLine()
    }
}
