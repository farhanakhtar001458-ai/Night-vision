package com.farhan.edith

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * Google ka SpeechRecognizer chala ke sunta hai.
 * continuous = true  -> result ke baad phir sunna shuru (always listening)
 * continuous = false -> ek command sun kar ruk jata hai (BOLO button)
 */
class VoiceListener(
    private val ctx: Context,
    private val onFinal: (String) -> Unit,
    private val onStatus: (String) -> Unit
) : RecognitionListener {

    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var want = false
    private var continuous = false
    private var errorCount = 0

    fun begin(continuousMode: Boolean) {
        continuous = continuousMode
        want = true
        errorCount = 0
        ensure()
        startNow()
    }

    fun end() {
        want = false
        main.post {
            try {
                recognizer?.cancel()
            } catch (t: Throwable) {
            }
        }
    }

    private fun ensure() {
        if (recognizer != null) return
        recognizer = try {
            SpeechRecognizer.createSpeechRecognizer(ctx)
        } catch (t: Throwable) {
            null
        }
        recognizer?.setRecognitionListener(this)
    }

    private fun startNow() {
        if (!want) return
        if (!SpeechRecognizer.isRecognitionAvailable(ctx)) {
            onStatus("Speech service nahi mili — phone me Google app chahiye")
            want = false
            return
        }
        ensure()
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN")
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "en-IN")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.packageName)
        }
        try {
            recognizer?.cancel()
        } catch (t: Throwable) {
        }
        try {
            recognizer?.startListening(intent)
        } catch (t: Throwable) {
            onStatus("mic start fail: " + (t.message ?: "unknown"))
        }
    }

    private fun again(delay: Long) {
        if (!want) return
        main.postDelayed({ if (want) startNow() }, delay)
    }

    override fun onReadyForSpeech(params: Bundle?) {
        onStatus("Bol do…")
    }

    override fun onBeginningOfSpeech() {
        onStatus("Sun rahi hoon…")
    }

    override fun onRmsChanged(rmsdB: Float) {}

    override fun onBufferReceived(buffer: ByteArray?) {}

    override fun onEndOfSpeech() {}

    override fun onError(error: Int) {
        if (!want) return
        errorCount += 1
        if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
            onStatus("Mic permission chahiye")
            want = false
            return
        }
        if (errorCount > 30) {
            want = false
            onStatus("Mic band — dobara BOLO dabao")
            return
        }
        val delay = if (errorCount > 4) 1500L else 350L
        if (continuous) again(delay) else {
            // tap mode: shor ya timeout par 3 baar tak dobara try
            if (errorCount <= 3) again(delay) else {
                want = false
                onStatus("Kuch sunai nahi diya — dobara BOLO dabao")
            }
        }
    }

    override fun onResults(results: Bundle?) {
        errorCount = 0
        val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
        if (!text.isNullOrBlank()) onFinal(text.trim())
        if (continuous) again(500L) else {
            want = false
            onStatus("Ho gaya")
        }
    }

    override fun onPartialResults(partialResults: Bundle?) {
        val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
        if (!text.isNullOrBlank()) onStatus("… " + text.trim())
    }

    override fun onEvent(eventType: Int, params: Bundle?) {}
}
