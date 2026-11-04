package com.nightvision.x.diagnostics.data

import java.util.concurrent.atomic.AtomicBoolean

/** Process-local hand-off between the dashboard and detail screen; no simulated or persisted data. */
object DiagnosticRepository {
    @Volatile var latestReport: DiagnosticReport? = null
        private set

    val scanInProgress = AtomicBoolean(false)

    fun publish(report: DiagnosticReport) {
        latestReport = report
    }

    fun camera(id: String, parentLogicalId: String?): CameraDiagnostic? = latestReport?.cameras?.firstOrNull {
        it.id == id && it.parentLogicalId == parentLogicalId
    }
}
