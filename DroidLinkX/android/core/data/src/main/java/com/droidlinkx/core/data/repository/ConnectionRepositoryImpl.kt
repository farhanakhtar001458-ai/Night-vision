package com.droidlinkx.core.data.repository

import com.droidlinkx.core.domain.model.Outcome
import com.droidlinkx.core.domain.model.map
import com.droidlinkx.core.domain.model.toFailure
import com.droidlinkx.core.domain.repository.ConnectionRepository
import com.droidlinkx.core.domain.repository.OwnerAuthRepository
import com.droidlinkx.core.domain.repository.SessionRequest
import com.droidlinkx.core.network.api.OwnerApi
import com.droidlinkx.core.network.dto.ConnectionCreateRequestDto
import com.droidlinkx.core.network.dto.TerminateConnectionRequestDto
import retrofit2.HttpException
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ConnectionRepositoryImpl @Inject constructor(
    private val ownerApi: OwnerApi,
    private val ownerAuthRepository: OwnerAuthRepository,
) : ConnectionRepository {

    override suspend fun requestSession(
        sourceDeviceId: String,
        type: String,
        targetDeviceId: String?,
    ): Outcome<SessionRequest> {
        val result = ownerAuthRepository.authorized {
            ownerApi.createConnection(
                ConnectionCreateRequestDto(
                    sourceDeviceId = sourceDeviceId,
                    targetDeviceId = targetDeviceId,
                    type = type,
                ),
            )
        }
        return result.map { response ->
            SessionRequest(
                connectionId = response.connection.id,
                type = response.connection.type,
                sourceDeviceId = response.connection.sourceDeviceId,
                status = response.connection.status,
            )
        }
    }

    override suspend fun terminate(connectionId: String, reason: String): Outcome<Unit> = try {
        ownerAuthRepository.authorized { ownerApi.terminateConnection(TerminateConnectionRequestDto(connectionId, reason)) }
        Outcome.Success(Unit)
    } catch (http: HttpException) {
        Outcome.Failure("Could not end the session (HTTP ${http.code()})", httpStatus = http.code(), cause = http)
    } catch (io: IOException) {
        Outcome.Failure("Could not reach the server to end the session", code = "NETWORK", cause = io)
    } catch (t: Throwable) {
        t.toFailure("Could not end the session")
    }
}
