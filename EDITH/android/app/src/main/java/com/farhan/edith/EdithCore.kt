package com.farhan.edith

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import java.util.Locale

/** Poore app ka dil: prefs, listening, TTS aur command dispatch. */
object EdithCore {

    private const val PREFS = "edith_prefs"
    private const val KEY_ALWAYS = "always_listening"
    private const val KEY_ANNOUNCE = "announce"
    private const val KEY_WAKE = "wake_required"
    private const val KEY_HINDI = "hindi_voice"

    interface Ui {
        fun onStatus(text: String)
        fun onReply(text: String)
    }

    private var app: Context? = null
    private val main = Handler(Looper.getMainLooper())

    var ui: Ui? = null

    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var voice: VoiceListener? = null

    var alwaysListening: Boolean = false
        private set
    var announce: Boolean = false
        private set
    var wakeRequired: Boolean = true
        private set
    var hindiVoice: Boolean = false
        private set
    var continuous: Boolean = false
        private set
    private var tapMode = false

    fun init(context: Context) {
        val ctx = context.applicationContext
        if (app == null) {
            app = ctx
            val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            alwaysListening = sp.getBoolean(KEY_ALWAYS, false)
            announce = sp.getBoolean(KEY_ANNOUNCE, false)
            wakeRequired = sp.getBoolean(KEY_WAKE, true)
            hindiVoice = sp.getBoolean(KEY_HINDI, false)
        }
        if (tts == null) {
            tts = try {
                TextToSpeech(ctx) { status -> onTtsReady(status) }
            } catch (t: Throwable) {
                null
            }
        }
    }

    private fun onTtsReady(status: Int) {
        if (status != TextToSpeech.SUCCESS) return
        applyLanguage()
    }

    private fun applyLanguage() {
        val engine = tts ?: return
        val wanted = if (hindiVoice) Locale("hi", "IN") else Locale("en", "IN")
        val fallback = if (hindiVoice) Locale("hi") else Locale.US
        var res = TextToSpeech.LANG_NOT_SUPPORTED
        try {
            res = engine.setLanguage(wanted)
        } catch (t: Throwable) {
        }
        if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
            try {
                engine.setLanguage(fallback)
            } catch (t: Throwable) {
            }
        }
        ttsReady = true
    }

    fun hasMic(ctx: Context): Boolean =
        ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    // ---------------------------------------------------------------- speak
    fun say(text: String) {
        ui?.onReply(text)
        speakOnly(text)
    }

    private fun speakOnly(text: String) {
        val engine = tts ?: return
        if (!ttsReady) return
        try {
            engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "edith" + System.currentTimeMillis())
        } catch (t: Throwable) {
        }
    }

    fun status(text: String) {
        ui?.onStatus(text)
    }

    // ---------------------------------------------------------------- listening
    private fun listener(ctx: Context): VoiceListener {
        var v = voice
        if (v == null) {
            v = VoiceListener(
                ctx,
                onFinal = { text -> onHeard(text) },
                onStatus = { s -> status(s) }
            )
            voice = v
        }
        return v
    }

    fun tapListen() {
        val ctx = app ?: return
        if (!hasMic(ctx)) {
            status("Pehle mic permission do")
            return
        }
        tapMode = true
        continuous = false
        status("Sun rahi hoon…")
        listener(ctx).begin(false)
    }

    fun startContinuous() {
        val ctx = app ?: return
        if (!hasMic(ctx)) {
            status("Pehle mic permission do")
            return
        }
        continuous = true
        tapMode = false
        status("Always listening ON — 'Edith' bolo")
        listener(ctx).begin(true)
    }

    fun stopListening() {
        continuous = false
        tapMode = false
        voice?.end()
        status("Listening band")

        val ctx = app
        if (ctx != null) AssistantService.stop(ctx)
    }

    fun serviceStopped() {
        continuous = false
        voice?.end()
        status("Service band")
    }

    // ---------------------------------------------------------------- commands
    fun onHeard(raw: String) {
        val ctx = app ?: return
        val text = raw.trim()
        if (text.isEmpty()) return
        status("Suna: $text")

        val wake = CommandParser.hasWake(text)
        if (!wake && !tapMode && wakeRequired) {
            // wake word ON hai to "Edith" ke bina baat ignore
            return
        }
        tapMode = false
        val body = if (wake) CommandParser.stripWake(text) else CommandParser.norm(text)
        val action = CommandParser.parse(body)
        handle(ctx, action)
    }

    private fun handle(ctx: Context, action: Action) {
        if (action is Action.StopListening) {
            stopListening()
            say("Theek hai, sunna band kar diya.")
            return
        }
        val reply = try {
            Actions.run(ctx, action)
        } catch (t: Throwable) {
            "Kuch galat ho gaya: " + (t.message ?: t.javaClass.simpleName)
        }
        say(reply)
    }

    // ---------------------------------------------------------------- toggles
    fun toggleAlways(): Boolean {
        val ctx = app ?: return false
        alwaysListening = !alwaysListening
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(KEY_ALWAYS, alwaysListening).apply()
        if (!alwaysListening) {
            continuous = false
            voice?.end()
            AssistantService.stop(ctx)
        }
        return alwaysListening
    }

    fun toggleWakeRequired(): Boolean {
        val ctx = app ?: return false
        wakeRequired = !wakeRequired
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(KEY_WAKE, wakeRequired).apply()
        return wakeRequired
    }

    fun toggleHindiVoice(): Boolean {
        val ctx = app ?: return false
        hindiVoice = !hindiVoice
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(KEY_HINDI, hindiVoice).apply()
        applyLanguage()
        say(if (hindiVoice) "Ab main Hindi me bolungi." else "Now I will speak in English.")
        return hindiVoice
    }

    fun toggleAnnounce(): Boolean {
        val ctx = app ?: return false
        announce = !announce
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(KEY_ANNOUNCE, announce).apply()
        return announce
    }

    fun announceNow(appName: String, title: String, text: String) {
        if (!announce) return
        val line = "$appName se $title: $text"
        main.post {
            ui?.onReply(line)
            speakOnly(line)
        }
    }

    fun notificationAccessEnabled(ctx: Context): Boolean {
        val enabled = try {
            android.provider.Settings.Secure.getString(
                ctx.contentResolver, "enabled_notification_listeners"
            ) ?: ""
        } catch (t: Throwable) {
            ""
        }
        return enabled.contains(ctx.packageName)
    }
}
