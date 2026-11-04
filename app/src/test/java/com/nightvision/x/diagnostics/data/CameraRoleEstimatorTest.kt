package com.nightvision.x.diagnostics.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CameraRoleEstimatorTest {
    @Test
    fun frontRoleComesDirectlyFromLensFacing() {
        val result = CameraRoleEstimator.assignRoles(listOf(camera(id = "1", facing = "Front")))
        assertEquals("Front camera", result.single().role?.label)
        assertFalse(result.single().role?.estimated ?: true)
    }

    @Test
    fun opticalRolesAreExplicitEstimates() {
        val result = CameraRoleEstimator.assignRoles(listOf(
            camera(id = "0", focalLength = 4.5f, sensorWidth = 7.0f),   // ~76 degrees
            camera(id = "2", focalLength = 1.8f, sensorWidth = 7.0f),   // ~126 degrees
            camera(id = "3", focalLength = 18.0f, sensorWidth = 7.0f),  // ~22 degrees
        ))
        assertEquals("Main (estimated)", result[0].role?.label)
        assertEquals("Ultra-wide (estimated)", result[1].role?.label)
        assertEquals("Telephoto (estimated)", result[2].role?.label)
        assertTrue(result.all { it.role?.estimated == true })
    }

    @Test
    fun missingOpticsDoNotProduceGuessedRole() {
        val result = CameraRoleEstimator.assignRoles(listOf(camera(id = "0")))
        assertEquals("Rear camera", result.single().role?.label)
        assertFalse(result.single().role?.estimated ?: true)
        assertNull(CameraRoleEstimator.horizontalFieldOfView(result.single()))
    }

    @Test
    fun logicalMultiCameraIsNotMislabeledAsMain() {
        val logical = camera(
            id = "0",
            focalLength = 4.5f,
            sensorWidth = 7.0f,
        ).copy(physicalCameraIds = listOf("2", "3"))
        val result = CameraRoleEstimator.assignRoles(listOf(logical))
        assertEquals("Logical rear multi-camera", result.single().role?.label)
        assertFalse(result.single().role?.estimated ?: true)
    }

    private fun camera(
        id: String,
        facing: String = "Back",
        focalLength: Float? = null,
        sensorWidth: Float? = null,
    ) = CameraDiagnostic(
        id = id,
        parentLogicalId = null,
        physicalOnly = false,
        accessible = true,
        lensFacing = facing,
        focalLengthsMm = focalLength?.let(::listOf),
        sensorPhysicalSizeMm = sensorWidth?.let { SizeInfoFloat(it, 5.0f) },
    )
}
