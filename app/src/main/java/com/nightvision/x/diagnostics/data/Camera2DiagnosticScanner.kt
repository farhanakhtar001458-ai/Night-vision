package com.nightvision.x.diagnostics.data

import android.content.Context
import android.graphics.ImageFormat
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraMetadata
import android.os.Build
import android.util.Size
import java.util.concurrent.atomic.AtomicBoolean

/** Reads static metadata only. This class never opens a CameraDevice or captures a frame. */
class Camera2DiagnosticScanner(context: Context) {
    private val cameraManager = context.getSystemService(CameraManager::class.java)
    private val running = AtomicBoolean(false)

    fun scan(): DiagnosticReport {
        check(running.compareAndSet(false, true)) { "A camera scan is already running" }
        val startedAt = System.currentTimeMillis()
        val warnings = mutableListOf<String>()
        val cameras = mutableListOf<CameraDiagnostic>()
        val physicalOwners = linkedMapOf<String, String>()

        try {
            val logicalIds = try {
                cameraManager.cameraIdList.toList()
            } catch (error: Exception) {
                warnings += "Camera ID enumeration failed: ${error.diagnosticMessage()}"
                emptyList()
            }

            if (logicalIds.isEmpty() && warnings.isEmpty()) {
                warnings += "CameraManager returned no logical camera IDs."
            }

            logicalIds.forEach { id ->
                try {
                    val characteristics = cameraManager.getCameraCharacteristics(id)
                    cameras += readCamera(id, parentLogicalId = null, characteristics = characteristics)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        characteristics.physicalCameraIds.forEach { physicalId ->
                                            // A physical ID can be shared by logical cameras. Keep the first owner and
                                            // retain every ID in each logical camera's own physicalCameraIds field.
                            if (!physicalOwners.containsKey(physicalId) && physicalId !in logicalIds) {
                                physicalOwners[physicalId] = id
                            }
                        }
                    }
                } catch (error: Exception) {
                    val message = error.diagnosticMessage()
                    warnings += "Logical camera $id could not be read: $message"
                    cameras += CameraDiagnostic(
                        id = id,
                        parentLogicalId = null,
                        physicalOnly = false,
                        accessible = false,
                        readError = message,
                    )
                }
            }

            physicalOwners.forEach { (physicalId, logicalId) ->
                try {
                    val characteristics = cameraManager.getCameraCharacteristics(physicalId)
                    cameras += readCamera(
                        id = physicalId,
                        parentLogicalId = logicalId,
                        characteristics = characteristics,
                    ).copy(physicalOnly = true)
                } catch (error: Exception) {
                    val message = error.diagnosticMessage()
                    warnings += "Physical camera $physicalId (logical $logicalId) could not be read: $message"
                    cameras += CameraDiagnostic(
                        id = physicalId,
                        parentLogicalId = logicalId,
                        physicalOnly = true,
                        accessible = false,
                        readError = message,
                    )
                }
            }
        } finally {
            running.set(false)
        }

        val roleAwareCameras = CameraRoleEstimator.assignRoles(cameras)
        val recommendations = NightVisionRecommendationEngine.forReport(roleAwareCameras)
        return DiagnosticReport(
            schemaVersion = 1,
            application = "Night Vision X PRO — Camera Diagnostic Module",
            packageName = "com.nightvision.x",
            generatedAtEpochMs = startedAt,
            device = currentDevice(),
            cameras = roleAwareCameras,
            scanWarnings = warnings,
            recommendations = recommendations,
        )
    }

    private fun readCamera(
        id: String,
        parentLogicalId: String?,
        characteristics: CameraCharacteristics,
    ): CameraDiagnostic {
        val capabilities = characteristics.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)
            ?.map(CameraValueCatalog::capability)
        val capabilityCodes = characteristics.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)
        val afModeCodes = characteristics.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES)

        return CameraDiagnostic(
            id = id,
            parentLogicalId = parentLogicalId,
            physicalOnly = false,
            accessible = true,
            lensFacing = characteristics.get(CameraCharacteristics.LENS_FACING)?.let(CameraValueCatalog::lensFacing),
            hardwareLevel = characteristics.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL)
                ?.let(CameraValueCatalog::hardwareLevel),
            capabilities = capabilities,
            physicalCameraIds = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                characteristics.physicalCameraIds.toList()
            } else {
                null
            },
            pixelArraySize = characteristics.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)?.asSizeInfo(),
            preCorrectionActiveArraySize = characteristics.get(
                CameraCharacteristics.SENSOR_INFO_PRE_CORRECTION_ACTIVE_ARRAY_SIZE,
            )?.let { SizeInfo(it.width(), it.height()) },
            activeArrayCrop = characteristics.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)?.flattenToString(),
            sensorPhysicalSizeMm = characteristics.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)?.let {
                SizeInfoFloat(it.width, it.height)
            },
            sensorOrientationDegrees = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION),
            colorFilterArrangement = characteristics.get(CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT)
                ?.let(CameraValueCatalog::colorFilterArrangement),
            timestampSource = characteristics.get(CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE)
                ?.let(CameraValueCatalog::timestampSource),
            isoRange = characteristics.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE)?.let {
                IntRangeInfo(it.lower, it.upper)
            },
            exposureRangeNs = characteristics.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE)?.let {
                ExposureRangeInfo(it.lower, it.upper)
            },
            exposureCompensationRange = characteristics.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_RANGE)?.let {
                IntRangeInfo(it.lower, it.upper)
            },
            exposureCompensationStep = characteristics.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_STEP)?.let {
                RationalInfo(it.numerator, it.denominator)
            },
            autoExposureModes = characteristics.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_MODES)
                ?.map(CameraValueCatalog::aeMode),
            autoWhiteBalanceModes = characteristics.get(CameraCharacteristics.CONTROL_AWB_AVAILABLE_MODES)
                ?.map(CameraValueCatalog::awbMode),
            flashAvailable = characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE),
            manualSensorSupported = capabilityCodes?.contains(
                CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR,
            ),
            rawCaptureSupported = capabilityCodes?.contains(
                CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_RAW,
            ),
            autofocusModes = afModeCodes?.map(CameraValueCatalog::afMode),
            manualFocusControl = afModeCodes?.contains(CameraMetadata.CONTROL_AF_MODE_OFF),
            minimumFocusDistanceDiopters = characteristics.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE),
            hyperfocalDistanceDiopters = characteristics.get(CameraCharacteristics.LENS_INFO_HYPERFOCAL_DISTANCE),
            focusDistanceCalibration = characteristics.get(CameraCharacteristics.LENS_INFO_FOCUS_DISTANCE_CALIBRATION)
                ?.let(CameraValueCatalog::focusCalibration),
            focalLengthsMm = characteristics.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.toList(),
            apertures = characteristics.get(CameraCharacteristics.LENS_INFO_AVAILABLE_APERTURES)?.toList(),
            filterDensities = characteristics.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FILTER_DENSITIES)?.toList(),
            opticalStabilizationModes = characteristics.get(
                CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION,
            )?.map(CameraValueCatalog::oisMode),
            videoStabilizationModes = characteristics.get(
                CameraCharacteristics.CONTROL_AVAILABLE_VIDEO_STABILIZATION_MODES,
            )?.map(CameraValueCatalog::eisMode),
            targetFpsRanges = characteristics.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
                ?.map { FpsRangeInfo(it.lower, it.upper) },
            outputFormats = readOutputFormats(characteristics),
            maximumProcessedStreams = characteristics.get(CameraCharacteristics.REQUEST_MAX_NUM_OUTPUT_PROC),
            maximumRawStreams = characteristics.get(CameraCharacteristics.REQUEST_MAX_NUM_OUTPUT_RAW),
            maximumStallingStreams = characteristics.get(CameraCharacteristics.REQUEST_MAX_NUM_OUTPUT_PROC_STALLING),
            requestPipelineDepth = characteristics.get(CameraCharacteristics.REQUEST_PIPELINE_MAX_DEPTH)?.toInt(),
        )
    }

    private fun readOutputFormats(characteristics: CameraCharacteristics): List<OutputFormatInfo>? {
        val map = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: return null
        val formats = map.outputFormats ?: return null
        return formats.map { format ->
            try {
                val sizes = sizesWithDurations(map.getOutputSizes(format), map, format)
                var highResolutionError: String? = null
                val highResolutionSizes = try {
                    sizesWithDurations(map.getHighResolutionOutputSizes(format), map, format)
                } catch (error: Exception) {
                    // Keep valid standard sizes if only the optional high-resolution query fails.
                    highResolutionError = "High-resolution query: ${error.diagnosticMessage()}"
                    null
                }
                OutputFormatInfo(
                    code = format,
                    name = CameraValueCatalog.outputFormat(format),
                    sizes = sizes,
                    highResolutionSizes = highResolutionSizes,
                    readError = highResolutionError,
                )
            } catch (error: Exception) {
                OutputFormatInfo(
                    code = format,
                    name = CameraValueCatalog.outputFormat(format),
                    sizes = null,
                    highResolutionSizes = null,
                    readError = error.diagnosticMessage(),
                )
            }
        }
    }

    private fun sizesWithDurations(
        sizes: Array<Size>?,
        map: android.hardware.camera2.params.StreamConfigurationMap,
        format: Int,
    ): List<SizeWithDuration>? = sizes?.map { size ->
        val duration = try {
            map.getOutputMinFrameDuration(format, size).takeIf { it > 0L }
        } catch (_: IllegalArgumentException) {
            null
        }
        SizeWithDuration(size = size.asSizeInfo(), minimumFrameDurationNs = duration)
    }

    private fun currentDevice() = DeviceInfo(
        manufacturer = Build.MANUFACTURER,
        brand = Build.BRAND,
        model = Build.MODEL,
        device = Build.DEVICE,
        androidRelease = Build.VERSION.RELEASE,
        sdkInt = Build.VERSION.SDK_INT,
        securityPatch = Build.VERSION.SECURITY_PATCH,
        supportedAbis = Build.SUPPORTED_ABIS.toList(),
    )

    private fun Size.asSizeInfo() = SizeInfo(width = width, height = height)

    private fun Exception.diagnosticMessage(): String = when (this) {
        is CameraAccessException -> "CameraAccessException(reason=$reason): ${message ?: "no message"}"
        else -> "${javaClass.simpleName}: ${message ?: "no message"}"
    }
}

/** True only when the exact output format is listed and at least one output size was reported. */
fun CameraDiagnostic.supportsOutput(format: Int): Boolean =
    outputFormats?.any { it.code == format && !it.sizes.isNullOrEmpty() } == true

fun CameraDiagnostic.supportsYuv420(): Boolean = supportsOutput(ImageFormat.YUV_420_888)
