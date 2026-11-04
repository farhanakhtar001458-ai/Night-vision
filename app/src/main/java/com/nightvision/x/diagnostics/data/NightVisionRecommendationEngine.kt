package com.nightvision.x.diagnostics.data

import java.util.Locale

/** Deterministic recommendations derived only from the scanned values. No capture is performed. */
object NightVisionRecommendationEngine {
    private const val FRAME_30_NS = 33_333_333L

    fun forReport(cameras: List<CameraDiagnostic>): List<String> {
        val accessible = cameras.filter { it.accessible }
        if (accessible.isEmpty()) {
            return listOf(
                "No readable CameraCharacteristics were returned. Resolve camera access before designing the processing pipeline.",
                "No ISO, exposure, stabilization, or frame-rate capability can be assumed from this scan.",
            )
        }

        val recommendations = mutableListOf<String>()
        accessible.forEach { camera ->
            recommendations += forCamera(camera)
        }
        recommendations += "Treat CameraCharacteristics as static capabilities, not proof of a working mode combination. Validate capture-session behavior and sustained frame rates on the device in the next approved milestone."
        recommendations += "This diagnostic build captures no frames and includes no Night Vision processing. Do not infer scene brightness or image quality from these metadata values."
        return recommendations.distinct()
    }

    fun forCamera(camera: CameraDiagnostic): List<String> {
        if (!camera.accessible) return listOf("Camera metadata is unavailable; no engine recommendation can be made.")
        val prefix = "Camera ${camera.id}"
        val result = mutableListOf<String>()

        when (camera.manualSensorSupported) {
            true -> result += "$prefix: MANUAL_SENSOR is advertised. Clamp manual ISO and exposure independently to this camera's reported ranges."
            false -> result += "$prefix: MANUAL_SENSOR is not advertised. Keep automatic exposure as the safe default and hide unsupported manual controls."
            null -> result += "$prefix: Manual-sensor support was not reported. Do not enable manual exposure controls from assumptions."
        }

        val iso = camera.isoRange
        if (iso == null) {
            result += "$prefix: ISO range is not reported; do not substitute a generic ISO range."
        } else {
            result += "$prefix: Use ISO ${iso.minimum}–${iso.maximum} as the only diagnostics-supported sensitivity bounds; practical low-light ISO still requires on-device validation."
        }

        val exposure = camera.exposureRangeNs
        if (exposure == null) {
            result += "$prefix: Exposure range is not reported; manual exposure must remain unavailable."
        } else if (exposure.maximumNs > FRAME_30_NS) {
            result += "$prefix: Exposure up to ${String.format(Locale.US, "%.3f", exposure.maximumNs / 1_000_000.0)} ms is reported. Long exposures can reduce FPS and increase motion blur; apply a frame-time budget in Ultra Low Light mode."
        } else {
            result += "$prefix: The reported maximum exposure does not exceed the 30 FPS frame budget. Do not promise long-exposure night capture."
        }

        if (!camera.supportsYuv420()) {
            result += "$prefix: YUV_420_888 with a reported output size is unavailable or unreadable. The planned ImageReader pipeline needs a verified supported-format fallback or must exclude this camera."
        } else {
            val yuv = camera.outputFormats?.firstOrNull {
                it.code == android.graphics.ImageFormat.YUV_420_888 && !it.sizes.isNullOrEmpty()
            }
            val largest = yuv?.sizes?.maxByOrNull { it.size.width.toLong() * it.size.height }
            if (largest != null) {
                result += "$prefix: YUV_420_888 is reported up to ${largest.size.width}×${largest.size.height}; select a smaller processing resolution based on measured throughput rather than assuming 30 FPS at maximum size."
            }
        }

        val fps = camera.targetFpsRanges.orEmpty()
        if (fps.isEmpty()) {
            result += "$prefix: No target FPS ranges were reported. Do not claim 30 FPS support."
        } else if (fps.none { it.minimum <= 30 && it.maximum >= 30 }) {
            result += "$prefix: No reported target FPS range includes 30 FPS. Choose only an advertised range."
        }

        if (camera.opticalStabilizationModes?.contains("ON") != true) {
            result += "$prefix: Optical stabilization ON is not reported; do not claim OIS for this camera."
        }
        if (camera.videoStabilizationModes?.contains("ON") == true) {
            result += "$prefix: Video stabilization ON is reported. Verify it with the chosen stream combination before enabling it."
        } else {
            result += "$prefix: Camera2 video stabilization ON is not reported; any future digital stabilization must be described as software-only."
        }
        return result
    }
}
