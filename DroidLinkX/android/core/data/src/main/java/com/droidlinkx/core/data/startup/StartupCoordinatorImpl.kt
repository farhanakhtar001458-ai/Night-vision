package com.droidlinkx.core.data.startup

import com.droidlinkx.core.common.DroidLog
import com.droidlinkx.core.data.network.NetworkMonitor
import com.droidlinkx.core.data.repository.SessionStorage
import com.droidlinkx.core.data.settings.DeviceSettingsRepositoryImpl
import com.droidlinkx.core.domain.model.InitializationState
import com.droidlinkx.core.domain.model.InitializationStep
import com.droidlinkx.core.domain.model.Outcome
import com.droidlinkx.core.domain.repository.DeviceRegistrationRepository
import com.droidlinkx.core.domain.repository.LinkManager
import com.droidlinkx.core.domain.repository.OwnerAuthRepository
import com.droidlinkx.core.domain.repository.StartupCoordinator
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The ordered boot sequence from the product specification:
 * identity -> credentials -> database -> network -> cloud manager -> connectivity ->
 * owner authorization -> device registration -> socket -> dashboard.
 */
@Singleton
class StartupCoordinatorImpl @Inject constructor(
    private val sessionStorage: SessionStorage,
    private val ownerAuthRepository: OwnerAuthRepository,
    private val deviceRegistrationRepository: DeviceRegistrationRepository,
    private val linkManager: LinkManager,
    private val settings: DeviceSettingsRepositoryImpl,
    private val networkMonitor: NetworkMonitor,
) : StartupCoordinator {

    private val _state = MutableStateFlow(InitializationState())
    override val state: Flow<InitializationState> = _state.asStateFlow()

    private val mutex = Mutex()

    override suspend fun initialize(): InitializationState = mutex.withLock {
        val fingerprint: String
        try {
            advance(InitializationStep.GeneratingIdentity, "Creating this installation's identity")
            val installationId = sessionStorage.installationId()
            fingerprint = installationId.take(8)
            networkMonitor.start()

            advance(InitializationStep.SecuringCredentials, "Opening the Keystore-backed vault")
            val restored = ownerAuthRepository.restoreSession()

            advance(InitializationStep.PreparingDatabase, "Preparing the local database")
            val baseUrl = settings.observeApiBaseUrl().first()

            advance(InitializationStep.PreparingNetwork, "Network ready for $baseUrl")
            advance(InitializationStep.PreparingCloudLink, "Preparing the cloud connection manager")

            if (!networkMonitor.isOnline()) {
                return finish(
                    InitializationStep.Failed,
                    "No internet connection. DroidLink X will connect automatically when the network returns.",
                    fingerprint,
                )
            }
            advance(InitializationStep.CheckingConnectivity, "Internet available")

            val session = (restored as? Outcome.Success)?.value
            if (session == null) {
                return finish(
                    InitializationStep.WaitingForOwner,
                    "Sign in with the owner account to enroll this device.",
                    fingerprint,
                )
            }

            advance(InitializationStep.RegisteringDevice, "Registering this device with ${session.profile.email}")
            when (val enrollment = deviceRegistrationRepository.registerCurrentDevice()) {
                is Outcome.Failure -> {
                    return finish(InitializationStep.Failed, enrollment.message, fingerprint)
                }
                is Outcome.Success -> DroidLog.i(message = "Device registered: ${enrollment.value.deviceId}")
            }

            advance(InitializationStep.OpeningSocket, "Opening the authenticated WebSocket")
            linkManager.start()

            finish(InitializationStep.Ready, "Connected to the DroidLink X cloud", fingerprint)
        } catch (t: Throwable) {
            DroidLog.e(message = "Startup sequence failed", throwable = t)
            finish(InitializationStep.Failed, t.message ?: "Initialization failed", null)
        }
    }

    private fun advance(step: InitializationStep, message: String) {
        _state.value = InitializationState(step = step, message = message, fingerprint = _state.value.fingerprint)
    }

    private fun finish(step: InitializationStep, message: String, fingerprint: String?): InitializationState {
        val value = InitializationState(step = step, message = message, fingerprint = fingerprint)
        _state.value = value
        return value
    }
}
