package com.droidlinkx.core.data.mirroring

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import com.droidlinkx.core.common.DroidLog
import com.droidlinkx.core.data.repository.SessionStorage
import com.droidlinkx.core.domain.model.MirroringState
import com.droidlinkx.core.network.supabase.SupabaseRtcSignalInsert
import com.droidlinkx.core.network.supabase.SupabaseRtcSignalRow
import com.droidlinkx.core.network.supabase.SupabaseToolsApi
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phone-to-phone screen mirroring.
 *
 * The media path is pure WebRTC (peer-to-peer, STUN for NAT traversal, TURN when the operator adds
 * one). Only SDP/ICE envelopes travel through the database, in the `rtc_signals` table, and they
 * expire after three minutes. Nothing is captured until a viewer asks and the owner approved the
 * MediaProjection consent dialog.
 *
 * Roles: the phone that shares is the *offerer* (`sender = device`), the watching phone is the
 * *answerer* (`sender = viewer`). Both sides poll the signalling table — no database subscription is
 * used for media.
 */
@Singleton
class ScreenMirroringController @Inject constructor(
    @ApplicationContext private val context: Context,
    private val tools: SupabaseToolsApi,
    private val sessionStorage: SessionStorage,
    private val scope: CoroutineScope,
) {

    private val _state = MutableStateFlow(MirroringState())
    val state: StateFlow<MirroringState> = _state.asStateFlow()

    private val seenSignals = mutableSetOf<String>()
    private var factory: PeerConnectionFactory? = null
    private var eglBase: EglBase? = null
    private var peer: PeerConnection? = null
    private var capturer: ScreenCapturerAndroid? = null
    private var videoSource: VideoSource? = null
    private var textureHelper: SurfaceTextureHelper? = null
    private var screenTrack: VideoTrack? = null
    private var renderer: SurfaceViewRenderer? = null

    private var senderJob: Job? = null
    private var viewerJob: Job? = null

    val isSharing: Boolean get() = _state.value.sharing
    val isWatching: Boolean get() = _state.value.watching

    /* ------------------------------- sharing ------------------------------- */

    /** Starts advertising this device; capture begins when a viewer asks to watch. */
    fun startSharing(projectionPermission: Intent) {
        if (_state.value.sharing) return
        val deviceId = currentDeviceId() ?: return fail("Enrol this device before sharing the screen")
        ensureEngine()
        _state.value = MirroringState(sharing = true, status = MirroringState.STATUS_WAITING)
        senderJob = scope.launch(Dispatchers.Default) {
            runCatching { awaitViewer(deviceId, projectionPermission) }
                .onFailure { if (it !is kotlinx.coroutines.CancellationException) fail(it.message ?: "Screen sharing failed") }
        }
    }

    fun stopSharing() {
        senderJob?.cancel()
        senderJob = null
        teardownCapture()
        peer?.close()
        peer = null
        seenSignals.clear()
        if (_state.value.watching) {
            _state.update { it.copy(sharing = false, status = MirroringState.STATUS_STOPPED) }
        } else {
            _state.value = MirroringState(status = MirroringState.STATUS_STOPPED)
        }
    }

    private suspend fun awaitViewer(deviceId: String, projectionPermission: Intent) {
        var since = Instant.now().toString()
        while (scope.isActive && _state.value.sharing && _state.value.connectionId == null) {
            val requests = runCatching { tools.shareRequests(deviceId, "gt.$since") }.getOrElse { emptyList() }
            val request = requests.firstOrNull()
            if (request == null) {
                delay(POLL_MS)
                continue
            }
            since = request.createdAt
            beginBroadcast(deviceId, request.connectionId, projectionPermission)
            return
        }
    }

    private fun beginBroadcast(deviceId: String, connectionId: String, projectionPermission: Intent) {
        val egl = eglBase ?: return fail("WebRTC is not initialised")
        val peerFactory = factory ?: return fail("WebRTC is not initialised")
        _state.update { it.copy(connectionId = connectionId, status = MirroringState.STATUS_CONNECTING) }

        val pc = createPeer(deviceId, connectionId, sender = true)
        val helper = SurfaceTextureHelper.create("droidlinkx-screen", egl.eglBaseContext)
        val source = peerFactory.createVideoSource(false)
        val screenCapturer = ScreenCapturerAndroid(projectionPermission, object : MediaProjection.Callback() {
            override fun onStop() {
                DroidLog.i(message = "MediaProjection stopped by the system")
                stopSharing()
            }
        })
        screenCapturer.initialize(helper, context, source.capturerObserver)
        screenCapturer.startCapture(CAPTURE_WIDTH, CAPTURE_HEIGHT, CAPTURE_FPS)

        val track = peerFactory.createVideoTrack(VIDEO_TRACK_ID, source)
        pc.addTrack(track, listOf(STREAM_ID))

        textureHelper = helper
        videoSource = source
        capturer = screenCapturer
        screenTrack = track

        pc.createOffer(
            sdpObserver(
                onCreated = { description ->
                    pc.setLocalDescription(sdpObserver(), description)
                    scope.launch { insertSignal(connectionId, deviceId, "device", "offer", mapOf("sdp" to description.description)) }
                },
            ),
            MediaConstraints(),
        )
        senderJob = scope.launch(Dispatchers.Default) { consumeSignals(connectionId, deviceId, sender = true) }
    }

    /* ------------------------------- watching ------------------------------ */

    fun watch(deviceId: String, surface: SurfaceViewRenderer) {
        if (_state.value.watching) return
        ensureEngine()
        renderer = surface
        val connectionId = UUID.randomUUID().toString()
        _state.value = MirroringState(
            watching = true,
            connectionId = connectionId,
            remoteDeviceId = deviceId,
            status = MirroringState.STATUS_CONNECTING,
        )
        val pc = createPeer(deviceId, connectionId, sender = false)
        pc.addTransceiver(
            MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO,
            RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY),
        )
        scope.launch { insertSignal(connectionId, deviceId, "viewer", "request", emptyMap()) }
        viewerJob = scope.launch(Dispatchers.Default) { consumeSignals(connectionId, deviceId, sender = false) }
    }

    fun stopWatching() {
        viewerJob?.cancel()
        viewerJob = null
        val connectionId = _state.value.connectionId
        val deviceId = _state.value.remoteDeviceId
        peer?.close()
        peer = null
        screenTrack?.dispose()
        screenTrack = null
        renderer?.clearImage()
        renderer = null
        if (connectionId != null && deviceId != null) {
            scope.launch { insertSignal(connectionId, deviceId, "viewer", "hangup", emptyMap()) }
        }
        _state.value = MirroringState(status = MirroringState.STATUS_STOPPED)
        seenSignals.clear()
    }

    /* ----------------------------- signalling ------------------------------ */

    private suspend fun consumeSignals(connectionId: String, deviceId: String, sender: Boolean) {
        var since = Instant.now().toString()
        val role = if (sender) "viewer" else "device"
        while (scope.isActive) {
            val active = if (sender) _state.value.sharing else _state.value.watching
            if (!active) return
            val rows = runCatching { tools.signalsFrom(connectionId, "eq.$role", "gt.$since") }.getOrElse { emptyList() }
            for (row in rows) {
                if (!seenSignals.add(row.id)) continue
                if (row.createdAt > since) since = row.createdAt
                handleSignal(row, connectionId, deviceId, sender)
            }
            delay(POLL_MS)
        }
    }

    private fun handleSignal(row: SupabaseRtcSignalRow, connectionId: String, deviceId: String, sender: Boolean) {
        val pc = peer ?: return
        when (row.kind) {
            "offer" -> if (!sender) {
                val sdp = row.payload["sdp"] as? String ?: return
                pc.setRemoteDescription(
                    sdpObserver(
                        onSet = {
                            pc.createAnswer(
                                sdpObserver(
                                    onCreated = { answer ->
                                        pc.setLocalDescription(sdpObserver(), answer)
                                        scope.launch {
                                            insertSignal(connectionId, deviceId, "viewer", "answer", mapOf("sdp" to answer.description))
                                        }
                                        _state.update { it.copy(status = MirroringState.STATUS_CONNECTING) }
                                    },
                                ),
                                MediaConstraints(),
                            )
                        },
                    ),
                    SessionDescription(SessionDescription.Type.OFFER, sdp),
                )
            }

            "answer" -> if (sender) {
                val sdp = row.payload["sdp"] as? String ?: return
                pc.setRemoteDescription(sdpObserver(), SessionDescription(SessionDescription.Type.ANSWER, sdp))
                _state.update { it.copy(status = MirroringState.STATUS_CONNECTING) }
            }

            "ice" -> {
                val candidate = row.payload["candidate"] as? String ?: return
                val sdpMid = row.payload["sdpMid"] as? String
                val mLineIndex = (row.payload["sdpMLineIndex"] as? Number)?.toInt() ?: 0
                val ice = IceCandidate(sdpMid, mLineIndex, candidate)
                runCatching { pc.addIceCandidate(ice) }
                    .onFailure { DroidLog.w(message = "Remote ICE candidate rejected") }
            }

            "hangup" -> if (sender) stopSharing() else stopWatching()
        }
    }

    private suspend fun insertSignal(
        connectionId: String,
        deviceId: String,
        sender: String,
        kind: String,
        payload: Map<String, Any?>,
    ) {
        val ownerId = ownerId() ?: return
        runCatching {
            tools.insertSignal(
                SupabaseRtcSignalInsert(
                    ownerId = ownerId,
                    connectionId = connectionId,
                    deviceId = deviceId,
                    sender = sender,
                    kind = kind,
                    payload = payload,
                ),
            )
        }.onFailure { DroidLog.w(message = "Signalling row rejected: ${it.message}") }
    }

    /* ------------------------------- webrtc -------------------------------- */

    private fun ensureEngine() {
        if (factory != null) return
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .setEnableInternalTracer(false)
                .createInitializationOptions(),
        )
        val egl = EglBase.create()
        eglBase = egl
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
            .createPeerConnectionFactory()
    }

    private fun createPeer(deviceId: String, connectionId: String, sender: Boolean): PeerConnection {
        val factory = this.factory ?: throw IllegalStateException("WebRTC is not initialised")
        val iceServers = listOf(
            PeerConnection.IceServer.builder(STUN_URL).createIceServer(),
        )
        val configuration = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
            iceTransportsType = PeerConnection.IceTransportsType.ALL
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        val observer = object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) {
                scope.launch {
                    insertSignal(
                        connectionId,
                        deviceId,
                        if (sender) "device" else "viewer",
                        "ice",
                        mapOf(
                            "candidate" to candidate.sdp,
                            "sdpMid" to candidate.sdpMid,
                            "sdpMLineIndex" to candidate.sdpMLineIndex,
                        ),
                    )
                }
            }

            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) = Unit

            override fun onSignalingChange(newState: PeerConnection.SignalingState?) = Unit

            override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState?) {
                _state.update { it.copy(iceState = newState?.name) }
                if (newState == PeerConnection.IceConnectionState.CONNECTED ||
                    newState == PeerConnection.IceConnectionState.COMPLETED
                ) {
                    _state.update { it.copy(status = MirroringState.STATUS_CONNECTED) }
                }
                if (newState == PeerConnection.IceConnectionState.FAILED) {
                    _state.update { it.copy(status = MirroringState.STATUS_FAILED, detail = "The peer connection failed") }
                }
            }

            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit

            override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState?) = Unit

            override fun onAddStream(stream: MediaStream?) {
                if (sender) return
                val track = stream?.videoTracks?.firstOrNull() ?: return
                track.addSink(renderer)
                _state.update { it.copy(status = MirroringState.STATUS_CONNECTED) }
            }

            override fun onRemoveStream(stream: MediaStream?) {
                if (!sender) renderer?.clearImage()
            }

            override fun onDataChannel(channel: DataChannel?) = Unit

            override fun onRenegotiationNeeded() = Unit
        }
        val peer = factory.createPeerConnection(configuration, observer)
            ?: throw IllegalStateException("The peer connection could not be created")
        this.peer = peer
        return peer
    }

    private fun teardownCapture() {
        runCatching { capturer?.stopCapture() }
        capturer?.dispose()
        capturer = null
        screenTrack?.dispose()
        screenTrack = null
        videoSource?.dispose()
        videoSource = null
        textureHelper?.dispose()
        textureHelper = null
    }

    private fun sdpObserver(
        onCreated: (SessionDescription) -> Unit = {},
        onSet: () -> Unit = {},
    ): SdpObserver = object : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription) = onCreated(description)
        override fun onCreateFailure(error: String?) {
            DroidLog.w(message = "SDP offer/answer failed: ${error.orEmpty()}")
            _state.update { it.copy(status = MirroringState.STATUS_FAILED, detail = error) }
        }

        override fun onSetSuccess() = onSet()
        override fun onSetFailure(error: String?) {
            DroidLog.w(message = "Remote description rejected: ${error.orEmpty()}")
            _state.update { it.copy(status = MirroringState.STATUS_FAILED, detail = error) }
        }
    }

    private fun teardownAll() {
        teardownCapture()
        peer?.close()
        peer = null
        seenSignals.clear()
    }

    fun release() {
        stopSharing()
        stopWatching()
        teardownAll()
        runCatching { factory?.dispose() }
        factory = null
        runCatching { eglBase?.release() }
        eglBase = null
    }

    /** Creates a renderer wired to this controller's EGL context (viewer side). */
    fun createRenderer(context: Context): SurfaceViewRenderer {
        ensureEngine()
        return SurfaceViewRenderer(context).apply {
            init(eglBase?.eglBaseContext, null)
            setEnableHardwareScaler(true)
            setMirror(false)
            setScalingType(org.webrtc.RendererCommon.ScalingType.SCALE_ASPECT_FIT)
        }
    }

    private fun currentDeviceId(): String? = sessionStorage.deviceCredentials()?.deviceId

    private fun ownerId(): String? = sessionStorage.ownerSession()?.profile?.id

    private fun fail(message: String) {
        val current = _state.value
        _state.value = current.copy(status = MirroringState.STATUS_FAILED, detail = message, sharing = false, watching = false)
    }

    companion object {
        private const val POLL_MS = 800L
        private const val CAPTURE_WIDTH = 1280
        private const val CAPTURE_HEIGHT = 720
        private const val CAPTURE_FPS = 30
        private const val VIDEO_TRACK_ID = "screen"
        private const val STREAM_ID = "droidlinkx"
        private const val STUN_URL = "stun:stun.l.google.com:19302"

        /** Intent extra that carries the MediaProjection consent result into the service. */
        const val EXTRA_PROJECTION_DATA = "droidlinkx.mirroring.projection"
    }
}
