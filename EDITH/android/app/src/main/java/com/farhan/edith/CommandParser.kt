package com.farhan.edith

import java.util.Locale

/**
 * Hinglish + English commands ko Action me badalta hai.
 * "edith" / "hey edith" wake word alag se handle hota hai.
 */
object CommandParser {

    fun norm(raw: String): String =
        raw.lowercase(Locale.ROOT)
            .replace(Regex("[^a-z0-9\\u0900-\\u097F]+"), " ")
            .trim()

    fun hasWake(raw: String): Boolean {
        val t = norm(raw)
        return t.contains("edith") || t.contains("एडिथ") || t.contains("edth")
    }

    fun stripWake(raw: String): String {
        var t = norm(raw)
        val i = t.indexOf("edith")
        if (i >= 0) t = t.substring(i + 5)
        t = t.replace("एडिथ", " ")
        t = norm(t)
        var changed = true
        while (changed) {
            changed = false
            for (lead in LEADS) {
                if (t == lead) { t = ""; changed = true }
                else if (t.startsWith(lead + " ")) { t = t.substring(lead.length + 1).trim(); changed = true }
            }
        }
        return t
    }

    private val LEADS = listOf("hey", "hey edith", "suno", "sun", "zara", "please", "plz", "ok", "okay",
        "are you there", "se", "karo", "ab", "abhi")

    private fun hasAny(t: String, vararg words: String): Boolean {
        for (w in words) if (t.contains(w)) return true
        return false
    }

    private fun startsAny(t: String, vararg words: String): Boolean {
        for (w in words) if (t == w || t.startsWith(w + " ") || t.startsWith(w + ":")) return true
        return false
    }

    private val READ_WORDS = arrayOf("read", "padh", "padho", "batao", "suna", "suno", "check", "dikhao", "bol")
    private val ON_WORDS = arrayOf("on", "chalu", "chala", "jala", "jalao", "start", "चालू", "जला", "on karo")
    private val OFF_WORDS = arrayOf("off", "band", "bujha", "bujhao", "बंद", "बुझा", "ghati")

    fun parse(command: String): Action {
        val t = norm(command)
        if (t.isEmpty()) return Action.None

        // ---- meta / control ----
        if (startsAny(t, "stop", "chup", "so jao", "band ho jao", "sunna band", "stop listening", "bye"))
            return Action.StopListening
        if (startsAny(t, "help", "commands", "command list") || t.contains("kya kar sakti") ||
            t.contains("kya kya kar") || t.contains("madad"))
            return Action.Help
        if (t.contains("who are you") || t.contains("tum kaun") || t.contains("your name") ||
            t.contains("tera naam") || t.contains("tumhara naam"))
            return Action.About

        // ---- torch ----
        if (hasAny(t, "torch", "flashlight", "flash light", "टॉर्च", "लाइट", "light", "flash")) {
            if (hasAny(t, *OFF_WORDS)) return Action.TorchOff
            if (hasAny(t, *ON_WORDS)) return Action.TorchOn
            return Action.TorchToggle
        }

        // ---- messages / mail ----
        val opens = hasAny(t, "open", "kholo", "khol", "launch", "chalu")
        if (hasAny(t, "whatsapp", "whats app", "watsapp", "व्हाट्सएप")) {
            if (!opens && (hasAny(t, *READ_WORDS) || t.contains("message") || t.contains("msg")))
                return Action.ReadWhatsApp
        }
        if (hasAny(t, "email", "e mail", "gmail", "mail", "ईमेल", "inbox")) {
            if (!opens && (hasAny(t, *READ_WORDS) || t.contains("message") || t.contains("mail")))
                return Action.ReadEmail
        }
        if (startsAny(t, "notifications", "notification", "notify") || t.contains("notifications padho") ||
            t.contains("notifications batao"))
            return Action.ReadAll

        // ---- browser ----
        if (hasAny(t, "new tab", "naya tab", "naya tab kholo", "tab kholo")) return Action.NewTab
        if (t.contains("chrome")) return Action.OpenChrome

        // ---- website / search ----
        val url = findUrl(t)
        if (url != null && (hasAny(t, "open", "kholo", "khol", "visit", "website", "site", "browser") ||
                t == url.replace(".", " "))) {
            return Action.OpenUrl(url)
        }
        if (hasAny(t, "best website", "website finder", "best site")) {
            var q = t
            for (k in arrayOf("best website for", "best website", "website finder", "best site for", "best site", "find")) {
                q = q.replace(k, " ")
            }
            q = norm(q)
            return if (q.isEmpty()) Action.Search("best ai website") else Action.Search("$q official website")
        }
        if (hasAny(t, "search", "dhundo", "dhoondo", "khojo", "google")) {
            var q = t
            for (k in arrayOf("google par", "google pe", "google me", "search on google", "google search",
                    "google se", "search karo", "search", "dhundo", "dhoondo", "khojo", "google", "par", "pe", "me", "se", "for")) {
                q = q.replace(k, " ")
            }
            q = norm(q)
            if (q.isNotEmpty()) return Action.Search(q)
        }

        // ---- system toggles / info ----
        if (hasAny(t, "airplane", "flight mode", "hawai jahaz", "aeroplane", "airplane mode")) return Action.Airplane
        if (hasAny(t, "mobile data", "internet on", "internet off", "data on", "data off", "net on", "net off",
                "internet band", "data band", "internet chalu")) return Action.MobileData
        if (hasAny(t, "wifi", "wi fi", "वाईफाई")) return Action.Wifi
        if (hasAny(t, "bluetooth", "ब्लूटूथ")) return Action.Bluetooth
        if (hasAny(t, "volume", "awaaz", "sound", "आवाज़")) {
            if (hasAny(t, "mute", "silent", "band", "off", "kam karo")) return Action.VolumeMute
            if (hasAny(t, "up", "badhao", "tez", "high", "increase")) return Action.VolumeUp
            if (hasAny(t, "down", "ghatao", "slow", "low", "decrease", "kam")) return Action.VolumeDown
            return Action.VolumeUp
        }
        if (hasAny(t, "battery", "charge", "बैटरी")) return Action.Battery
        if (hasAny(t, "kitne baje", "time", "samay", "टाइम", "baje")) return Action.TimeNow
        if (hasAny(t, "date", "tarikh", "aaj ka din", "तारीख")) return Action.DateNow

        // ---- call / message ----
        val callTarget = parseCall(t)
        if (callTarget != null) return Action.Call(callTarget)
        val msg = parseSend(t)
        if (msg != null) return msg

        // ---- notes ----
        if (startsAny(t, "note karo", "note", "yaad rakho", "remember")) {
            var body = t
            for (k in arrayOf("note karo", "note", "yaad rakho", "remember", "that")) body = body.replace(k, " ")
            body = norm(body)
            if (body.isEmpty()) return Action.ReadNotes
            return Action.Note(body)
        }
        if (hasAny(t, "notes padho", "notes batao", "my notes", "notes sunao")) return Action.ReadNotes

        // ---- open app ----
        if (startsAny(t, "open", "kholo", "khol", "launch", "chalu karo", "start")) {
            var name = t
            for (k in arrayOf("open karo", "open", "kholo", "khol", "launch", "chalu karo", "start", "app", "karo", "do")) {
                if (name.startsWith(k + " ")) name = name.substring(k.length + 1).trim()
            }
            name = norm(name)
            if (name.isEmpty()) return Action.None
            return Action.OpenApp(name)
        }
        if (t.contains("kholo") || t.contains("open")) {
            var name = t
            for (k in arrayOf("kholo", "open", "karo", "do", "app")) name = name.replace(k, " ")
            name = norm(name)
            if (name.isNotEmpty()) return Action.OpenApp(name)
        }

        return Action.None
    }

    private fun parseCall(t: String): String? {
        if (hasAny(t, "kholo", "open", "launch")) return null
        val triggers = arrayOf("call karo", "call kar", "phone karo", "phone kar", "call", "dial", "milao")
        var rest: String? = null
        for (k in triggers) {
            if (t == k) continue
            if (t.startsWith(k + " ")) { rest = t.substring(k.length + 1).trim(); break }
            if (t.endsWith(" " + k) || t.contains(" " + k + " ")) {
                rest = t.replace(k, " ").trim()
                break
            }
        }
        if (rest == null) return null
        rest = norm(rest.replace(" ko ", " ").replace(" ko", " "))
        for (k in arrayOf("ko", "se", "par", "pe", "number", "ko call")) {
            if (rest == k) rest = ""
            else if (rest.startsWith(k + " ")) rest = rest.substring(k.length + 1).trim()
        }
        return if (rest.isNullOrBlank()) null else rest
    }

    private fun parseSend(t: String): Action.Message? {
        if (hasAny(t, "kholo", "open", "launch")) return null
        if (!hasAny(t, "bhejo", "bhej", "send", "karo", "kar do", "likho")) return null
        val whatsapp = hasAny(t, "whatsapp", "watsapp", "व्हाट्सएप")
        val triggers = arrayOf("message bhejo", "msg bhejo", "sms bhejo", "message karo", "msg karo",
            "text karo", "message bhej", "message", "msg", "bhejo")
        val trigger = triggers.firstOrNull { t.contains(it) } ?: return null
        val i = t.indexOf(trigger)
        var rest = (t.substring(0, i) + " " + t.substring(i + trigger.length)).trim()
        rest = rest.replace("whatsapp", " ").replace("watsapp", " ").replace("sms", " ")
        rest = norm(rest)
        if (rest.isEmpty()) return Action.Message("", "", whatsapp)
        val koIdx = rest.indexOf(" ko ")
        var name: String
        var text: String
        if (koIdx >= 0) {
            name = rest.substring(0, koIdx).trim()
            text = rest.substring(koIdx + 4).trim()
        } else {
            val parts = rest.split(" ").filter { it.isNotBlank() }
            name = parts.firstOrNull() ?: ""
            text = if (parts.size > 1) parts.drop(1).joinToString(" ") else ""
        }
        name = norm(name.replace(" ko", ""))
        for (k in arrayOf("ko", "se", "par", "pe")) {
            if (name.startsWith(k + " ")) name = name.substring(k.length + 1).trim()
            if (name.endsWith(" " + k)) name = name.substring(0, name.length - k.length - 1).trim()
        }
        if (name == "ko" || name == "se") name = ""
        if (name.isEmpty()) return null
        return Action.Message(name, text, whatsapp)
    }

    private val URL_RE = Regex(
        "([a-z0-9][a-z0-9-]*\\.)+(com|in|org|net|io|co|ai|app|dev|me|xyz|gov|edu)" +
            "(/[a-z0-9._~:/?#@!&()*+,;=%-]*)?")

    private fun findUrl(t: String): String? {
        val m = URL_RE.find(t) ?: return null
        var host = m.value
        if (!host.contains("://")) host = "https://$host"
        return host
    }
}
