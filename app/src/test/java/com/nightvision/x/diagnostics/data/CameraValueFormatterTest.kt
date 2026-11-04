package com.nightvision.x.diagnostics.data

import org.junit.Assert.assertEquals
import org.junit.Test

class CameraValueFormatterTest {
    @Test
    fun exposureFormattingRetainsFullLongRange() {
        val range = ExposureRangeInfo(minimumNs = 100_000L, maximumNs = 4_000_000_000L)
        assertEquals("100000 – 4000000000 ns", CameraValueFormatter.exposureNs(range))
        assertEquals("4.000 s", CameraValueFormatter.exposureFraction(range.maximumNs))
        assertEquals("1/10000.0 s", CameraValueFormatter.exposureFraction(range.minimumNs))
    }

    @Test
    fun missingValuesAreNeverReplacedWithZero() {
        assertEquals("Not reported", CameraValueFormatter.iso(null))
        assertEquals("Not reported", CameraValueFormatter.exposureNs(null))
        assertEquals("Not reported", CameraValueFormatter.finite(null))
    }
}
