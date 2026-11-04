package com.nightvision.x.diagnostics.data

import kotlin.math.atan
import kotlin.math.roundToInt

/**
 * Android exposes lens facing, not marketing names such as "main" or "ultra-wide".
 * This estimator uses reported focal length and physical sensor dimensions and always labels the
 * result as an estimate. If either input is missing, it does not guess a specific optical role.
 */
object CameraRoleEstimator {
    fun assignRoles(cameras: List<CameraDiagnostic>): List<CameraDiagnostic> {
        val rearCandidates = cameras.filter {
            it.accessible && it.lensFacing == "Back" &&
                !(it.isLogical && (it.physicalCameraIds?.size ?: 0) > 1) &&
                horizontalFieldOfView(it) != null
        }
        val rearFovs = rearCandidates.mapNotNull { horizontalFieldOfView(it) }

        return cameras.map { camera ->
            val role = when {
                !camera.accessible -> null
                camera.lensFacing == "Front" -> RoleEstimate(
                    label = "Front camera",
                    estimated = false,
                    basis = "LENS_FACING_FRONT",
                )
                camera.lensFacing == "External" -> RoleEstimate(
                    label = "External camera",
                    estimated = false,
                    basis = "LENS_FACING_EXTERNAL",
                )
                camera.lensFacing == "Back" -> estimateRearRole(camera, rearFovs)
                camera.lensFacing != null -> RoleEstimate(
                    label = "${camera.lensFacing} camera",
                    estimated = false,
                    basis = "Lens facing returned by Camera2",
                )
                else -> null
            }
            camera.copy(role = role)
        }
    }

    private fun estimateRearRole(camera: CameraDiagnostic, allRearFovs: List<Double>): RoleEstimate {
        if (camera.isLogical && (camera.physicalCameraIds?.size ?: 0) > 1) {
            return RoleEstimate(
                label = "Logical rear multi-camera",
                estimated = false,
                basis = "Camera2 reports ${camera.physicalCameraIds?.size} physical camera IDs",
            )
        }

        val fov = horizontalFieldOfView(camera) ?: return RoleEstimate(
            label = "Rear camera",
            estimated = false,
            basis = "LENS_FACING_BACK; focal length/sensor size unavailable for optical role estimation",
        )
        val widest = allRearFovs.maxOrNull() ?: fov
        val narrowest = allRearFovs.minOrNull() ?: fov
        val roundedFov = (fov * 10.0).roundToInt() / 10.0

        return when {
            allRearFovs.size > 1 && fov == widest && fov >= 75.0 && fov - narrowest >= 8.0 -> RoleEstimate(
                label = "Ultra-wide (estimated)",
                estimated = true,
                basis = "Widest calculated horizontal FoV: $roundedFov°; derived from focal length and sensor width",
            )
            allRearFovs.size > 1 && fov == narrowest && fov <= 45.0 && widest - fov >= 10.0 -> RoleEstimate(
                label = "Telephoto (estimated)",
                estimated = true,
                basis = "Narrowest calculated horizontal FoV: $roundedFov°; derived from focal length and sensor width",
            )
            fov in 45.0..90.0 -> RoleEstimate(
                label = "Main (estimated)",
                estimated = true,
                basis = "Calculated horizontal FoV: $roundedFov°; Android does not report a 'main' label",
            )
            else -> RoleEstimate(
                label = "Rear camera (role unknown)",
                estimated = false,
                basis = "Calculated horizontal FoV: $roundedFov°; no confident optical role classification",
            )
        }
    }

    fun horizontalFieldOfView(camera: CameraDiagnostic): Double? {
        val sensorWidth = camera.sensorPhysicalSizeMm?.widthMm?.toDouble()
            ?.takeIf { it.isFinite() && it > 0.0 } ?: return null
        val shortestFocalLength = camera.focalLengthsMm
            ?.filter { it.isFinite() && it > 0.0f }
            ?.minOrNull()?.toDouble() ?: return null
        val degrees = Math.toDegrees(2.0 * atan(sensorWidth / (2.0 * shortestFocalLength)))
        return degrees.takeIf { it.isFinite() && it > 0.0 && it < 180.0 }
    }
}
