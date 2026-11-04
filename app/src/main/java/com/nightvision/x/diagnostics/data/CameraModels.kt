package com.nightvision.x.diagnostics.data

/**
 * Serializable, API-independent snapshots of CameraCharacteristics.
 *
 * Null always means that Android did not report a value (or reading it failed). It never means
 * zero, "auto", or an assumed default. Empty lists mean that the camera reported an empty set.
 */
data class DeviceInfo(
    val manufacturer: String,
    val brand: String,
    val model: String,
    val device: String,
    val androidRelease: String,
    val sdkInt: Int,
    val securityPatch: String?,
    val supportedAbis: List<String>,
)

data class IntRangeInfo(val minimum: Int, val maximum: Int)

/** Exposure values are kept as Long nanoseconds; do not coerce them to Int. */
data class ExposureRangeInfo(val minimumNs: Long, val maximumNs: Long)

data class RationalInfo(val numerator: Int, val denominator: Int) {
    val decimal: Double?
        get() = if (denominator == 0) null else numerator.toDouble() / denominator.toDouble()
}

data class SizeInfo(val width: Int, val height: Int) {
    val megapixels: Double get() = width.toDouble() * height.toDouble() / 1_000_000.0
}

data class SizeWithDuration(
    val size: SizeInfo,
    val minimumFrameDurationNs: Long?,
)

data class OutputFormatInfo(
    val code: Int,
    val name: String,
    val sizes: List<SizeWithDuration>?,
    val highResolutionSizes: List<SizeWithDuration>?,
    val readError: String? = null,
)

data class FpsRangeInfo(val minimum: Int, val maximum: Int)

data class RoleEstimate(
    val label: String,
    val estimated: Boolean,
    val basis: String,
)

data class CameraDiagnostic(
    val id: String,
    val parentLogicalId: String?,
    val physicalOnly: Boolean,
    val accessible: Boolean,
    val readError: String? = null,
    val lensFacing: String? = null,
    val role: RoleEstimate? = null,
    val hardwareLevel: String? = null,
    val capabilities: List<String>? = null,
    val physicalCameraIds: List<String>? = null,
    val pixelArraySize: SizeInfo? = null,
    val preCorrectionActiveArraySize: SizeInfo? = null,
    val activeArrayCrop: String? = null,
    val sensorPhysicalSizeMm: SizeInfoFloat? = null,
    val sensorOrientationDegrees: Int? = null,
    val colorFilterArrangement: String? = null,
    val timestampSource: String? = null,
    val isoRange: IntRangeInfo? = null,
    val exposureRangeNs: ExposureRangeInfo? = null,
    val exposureCompensationRange: IntRangeInfo? = null,
    val exposureCompensationStep: RationalInfo? = null,
    val autoExposureModes: List<String>? = null,
    val autoWhiteBalanceModes: List<String>? = null,
    val flashAvailable: Boolean? = null,
    val manualSensorSupported: Boolean? = null,
    val rawCaptureSupported: Boolean? = null,
    val autofocusModes: List<String>? = null,
    val manualFocusControl: Boolean? = null,
    val minimumFocusDistanceDiopters: Float? = null,
    val hyperfocalDistanceDiopters: Float? = null,
    val focusDistanceCalibration: String? = null,
    val focalLengthsMm: List<Float>? = null,
    val apertures: List<Float>? = null,
    val filterDensities: List<Float>? = null,
    val opticalStabilizationModes: List<String>? = null,
    val videoStabilizationModes: List<String>? = null,
    val targetFpsRanges: List<FpsRangeInfo>? = null,
    val outputFormats: List<OutputFormatInfo>? = null,
    val maximumProcessedStreams: Int? = null,
    val maximumRawStreams: Int? = null,
    val maximumStallingStreams: Int? = null,
    val requestPipelineDepth: Int? = null,
) {
    val isLogical: Boolean get() = !physicalOnly
}

data class SizeInfoFloat(val widthMm: Float, val heightMm: Float)

data class DiagnosticReport(
    val schemaVersion: Int,
    val application: String,
    val packageName: String,
    val generatedAtEpochMs: Long,
    val device: DeviceInfo,
    val cameras: List<CameraDiagnostic>,
    val scanWarnings: List<String>,
    val recommendations: List<String>,
) {
    val logicalCameras: List<CameraDiagnostic> get() = cameras.filter { it.isLogical }
    val physicalOnlyCameras: List<CameraDiagnostic> get() = cameras.filter { it.physicalOnly }
}
