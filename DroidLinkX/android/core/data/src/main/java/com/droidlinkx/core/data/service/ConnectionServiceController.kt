package com.droidlinkx.core.data.service

import android.content.Context
import com.droidlinkx.core.domain.repository.LinkServiceController
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ConnectionServiceController @Inject constructor(
    @ApplicationContext private val context: Context,
) : LinkServiceController {
    override fun start() {
        runCatching { ConnectionService.start(context) }
    }

    override fun stop() {
        runCatching { ConnectionService.stop(context) }
    }
}
