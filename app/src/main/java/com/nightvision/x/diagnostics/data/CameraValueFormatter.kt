package com.nightvision.x.diagnostics.data

import java.util.Locale

object CameraValueFormatter {
    const val NOT_REPORTED = "Not reported"

    fun boolean(value: Boolean?, supported: String = "Supported", unsupported: String = "Not supported") =
        when (value) {
            true -> supported
            false -> unsupported
            null -> NOT_REPORTED
        }

    fun size(value: SizeInfo?): String = value?.let {
        "${it.width} × ${it.height}  (${decimal(it.megapixels, 2)} MP)"
    } ?: NOT_REPORTED

    fun iso(value: IntRangeInfo?): String = value?.let {
        "ISO ${it.minimum} – ${it.maximum}"
    } ?: NOT_REPORTED

    fun exposureNs(value: ExposureRangeInfo?): String = value?.let {
        "${it.minimumNs} – ${it.maximumNs} ns"
    } ?: NOT_REPORTED

    fun exposureReadable(value: ExposureRangeInfo?): String = value?.let {
        "${decimal(it.minimumNs / 1_000_000.0, 6)} – ${decimal(it.maximumNs / 1_000_000.0, 3)} ms"
    } ?: NOT_REPORTED

    fun exposureFraction(nanoseconds: Long): String = when {
        nanoseconds <= 0L -> "Invalid/non-positive exposure: $nanoseconds ns"
        nanoseconds >= 1_000_000_000L -> "${decimal(nanoseconds / 1_000_000_000.0, 3)} s"
        else -> "1/${decimal(1_000_000_000.0 / nanoseconds, 1)} s"
    }

    fun fps(value: List<FpsRangeInfo>?): String = value?.let { ranges ->
        if (ranges.isEmpty()) "Empty list reported" else ranges.joinToString("\n") { "[${it.minimum}, ${it.maximum}] FPS" }
    } ?: NOT_REPORTED

    fun list(value: List<Any?>?): String = value?.let {
        if (it.isEmpty()) "Empty list reported" else it.joinToString("\n") { item -> item?.toString() ?: "null" }
    } ?: NOT_REPORTED

    fun floatList(value: List<Float>?, suffix: String = ""): String = value?.let {
        if (it.isEmpty()) "Empty list reported" else it.joinToString(", ") { number -> finite(number, suffix) }
    } ?: NOT_REPORTED

    fun finite(value: Float?, suffix: String = ""): String = when {
        value == null -> NOT_REPORTED
        !value.isFinite() -> "Invalid non-finite value ($value)"
        else -> "${decimal(value.toDouble(), 4).trimEnd('0').trimEnd('.')}$suffix"
    }

    fun integer(value: Int?, suffix: String = "") = value?.let { "$it$suffix" } ?: NOT_REPORTED

    fun sizes(value: List<SizeWithDuration>?): String = value?.let { entries ->
        if (entries.isEmpty()) return@let "Empty list reported"
        entries.joinToString("\n") { entry ->
            val base = "${entry.size.width} × ${entry.size.height}  (${decimal(entry.size.megapixels, 2)} MP)"
            entry.minimumFrameDurationNs?.let { duration ->
                "$base\n   min frame ${decimal(duration / 1_000_000.0, 3)} ms · max ${decimal(1_000_000_000.0 / duration, 2)} FPS"
            } ?: base
        }
    } ?: NOT_REPORTED

    fun decimal(value: Double, places: Int): String = if (value.isFinite()) {
        String.format(Locale.US, "% .${places}f".replace(" ", ""), value)
    } else {
        "Invalid non-finite value"
    }
}
