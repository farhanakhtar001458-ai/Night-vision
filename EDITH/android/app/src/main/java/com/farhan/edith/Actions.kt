package com.farhan.edith

import android.Manifest
import android.app.SearchManager
import android.content.pm.PackageManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.net.Uri
import android.os.BatteryManager
import android.provider.Settings
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Har action yahan chalta hai; har command ka spoken reply bhi yahi banta hai. */
object Actions {

    private const val CHROME = "com.android.chrome"

    fun run(ctx: Context, action: Action): String = try {
        when (action) {
            Action.TorchOn -> torch(ctx, true)
            Action.TorchOff -> torch(ctx, false)
            Action.TorchToggle -> torch(ctx, !Torch.isOn())

            Action.ReadWhatsApp -> readMessages(ctx, NotifStore.WHATSAPP, "WhatsApp")
            Action.ReadEmail -> readMessages(ctx, NotifStore.MAIL, "Email")
            Action.ReadAll -> readMessages(ctx, emptySet(), "Notification")

            Action.OpenChrome -> openChrome(ctx)
            Action.NewTab -> newTab(ctx)
            is Action.Search -> search(ctx, action.query)
            is Action.OpenUrl -> openUrl(ctx, action.url)
            is Action.OpenApp -> openApp(ctx, action.name)

            Action.Battery -> battery(ctx)
            Action.TimeNow -> timeNow()
            Action.DateNow -> dateNow()

            Action.VolumeUp -> volume(ctx, 1)
            Action.VolumeDown -> volume(ctx, -1)
            Action.VolumeMute -> volume(ctx, 0)

            Action.Wifi -> panel(ctx, "android.settings.panel.action.WIFI", Settings.ACTION_WIFI_SETTINGS, "WiFi")
            Action.Bluetooth -> panel(ctx, "android.settings.panel.action.BLUETOOTH",
                Settings.ACTION_BLUETOOTH_SETTINGS, "Bluetooth")
            Action.Airplane -> airplane(ctx)
            Action.MobileData -> mobileData(ctx)

            is Action.Call -> call(ctx, action.name)
            is Action.Message -> sendMessage(ctx, action.name, action.text, action.whatsapp)

            is Action.Note -> saveNote(ctx, action.text)
            Action.ReadNotes -> readNotes(ctx)

            Action.Help -> HELP
            Action.About -> "Main EDITH hoon — aapki Android assistant, Farhan ne banayi hai. " +
                "Torch, apps, search, WhatsApp aur email padh sakti hoon."

            Action.StopListening -> "Theek hai."
            Action.None -> "Samajh nahi aaya. Bolo 'Edith help' to poori list suna doon."
        }
    } catch (t: Throwable) {
        "Kuch galat ho gaya: " + (t.message ?: t.javaClass.simpleName)
    }

    // ------------------------------------------------ torch
    private fun torch(ctx: Context, want: Boolean): String {
        val ok = Torch.set(ctx, want)
        if (!ok) return "Torch nahi mila — is phone me flash ya permission ka issue hai."
        return if (want) "Torch on ho gaya." else "Torch off ho gaya."
    }

    // ------------------------------------------------ messages
    private fun readMessages(ctx: Context, packages: Set<String>, label: String): String {
        val list = NotifStore.recent(packages, 3)
        if (list.isEmpty()) {
            return "$label ki koi nayi message nahi mili. Notification access ON hai? " +
                "App kholo aur 'Notification access' button dabao."
        }
        val sb = StringBuilder()
        sb.append(label).append(" se ").append(list.size).append(" message. ")
        for (i in list.indices) {
            val item = list[i]
            sb.append(item.title)
            if (item.text.isNotBlank()) sb.append(": ").append(item.text)
            sb.append(if (i == list.size - 1) ". " else ". ")
        }
        return sb.toString().trim()
    }

    // ------------------------------------------------ browser
    private fun openChrome(ctx: Context): String {
        val launch = ctx.packageManager.getLaunchIntentForPackage(CHROME)
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(launch)
            return "Chrome khol diya."
        }
        return search(ctx, "google")
    }

    private fun newTab(ctx: Context): String {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com")).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            setPackage(CHROME)
        }
        return try {
            ctx.startActivity(intent)
            "Chrome me naya tab khol diya."
        } catch (t: Throwable) {
            openUrl(ctx, "https://www.google.com")
        }
    }

    private fun search(ctx: Context, query: String): String {
        if (query.isBlank()) return "Kya search karna hai? Bolo — Edith search best ai website."
        val web = Intent(Intent.ACTION_WEB_SEARCH).apply {
            putExtra(SearchManager.QUERY, query)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return try {
            ctx.startActivity(web)
            "Google par '$query' search kar rahi hoon."
        } catch (t: Throwable) {
            openUrl(ctx, "https://www.google.com/search?q=" + Uri.encode(query))
        }
    }

    private fun openUrl(ctx: Context, url: String): String {
        val fixed = if (url.startsWith("http")) url else "https://$url"
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(fixed)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            ctx.startActivity(intent)
            "Website khol di: $fixed"
        } catch (t: Throwable) {
            "Koi browser nahi mila."
        }
    }

    private fun openApp(ctx: Context, name: String): String {
        val found = findApp(ctx, name)
        if (found == null) return "'$name' naam ka app nahi mila. App ka poora naam bolo."
        val (pkg, label) = found
        val intent = ctx.packageManager.getLaunchIntentForPackage(pkg)
            ?: return "$label khol nahi payi."
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            ctx.startActivity(intent)
            "$label khol diya."
        } catch (t: Throwable) {
            "$label khol nahi payi."
        }
    }

    private fun findApp(ctx: Context, name: String): Pair<String, String>? {
        val q = CollectionUtils.normalize(name)
        if (q.isEmpty()) return null
        val pm = ctx.packageManager
        val main = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val list = try {
            pm.queryIntentActivities(main, 0)
        } catch (t: Throwable) {
            emptyList()
        }
        var bestPkg: String? = null
        var bestLabel = ""
        var bestScore = 0
        for (ri in list) {
            val pkg = ri.activityInfo.packageName
            val label = try {
                ri.loadLabel(pm).toString()
            } catch (t: Throwable) {
                pkg
            }
            val normLabel = CollectionUtils.normalize(label)
            val normPkg = CollectionUtils.normalize(pkg)
            var score = 0
            if (normLabel == q || normPkg == q) score = 100
            else if (normLabel.startsWith(q)) score = 85
            else if (normLabel.contains(q)) score = 70
            else if (q.contains(normLabel) && normLabel.length >= 4) score = 50
            else if (normPkg.contains(q.replace(" ", ""))) score = 40
            if (score > bestScore) {
                bestScore = score
                bestPkg = pkg
                bestLabel = label
            }
        }
        val pkg = bestPkg ?: return null
        return pkg to bestLabel
    }

    // ------------------------------------------------ info
    private fun battery(ctx: Context): String {
        val intent = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        if (intent == null) return "Battery info nahi mili."
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
        val pct = if (level < 0 || scale <= 0) -1 else (level * 100) / scale
        val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
            status == BatteryManager.BATTERY_STATUS_FULL
        return "Battery $pct percent hai, " + if (charging) "charge ho rahi hai." else "charging nahi hai."
    }

    private fun timeNow(): String =
        "Abhi " + SimpleDateFormat("h:mm a", Locale.US).format(Date()) + " baje hain."

    private fun dateNow(): String =
        "Aaj " + SimpleDateFormat("EEEE, d MMMM", Locale.US).format(Date()) + " hai."

    // ------------------------------------------------ volume
    private fun volume(ctx: Context, dir: Int): String {
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return "Volume control nahi mila."
        when (dir) {
            1 -> am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE,
                AudioManager.FLAG_SHOW_UI)
            -1 -> am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER,
                AudioManager.FLAG_SHOW_UI)
            else -> am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE,
                AudioManager.FLAG_SHOW_UI)
        }
        return when (dir) {
            1 -> "Volume badha diya."
            -1 -> "Volume kam kar diya."
            else -> "Volume mute kar diya."
        }
    }

    // ------------------------------------------------ system panels
    private fun panel(ctx: Context, panelAction: String, fallback: String, label: String): String {
        return try {
            ctx.startActivity(Intent(panelAction).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            "$label panel khol diya."
        } catch (t: Throwable) {
            try {
                ctx.startActivity(Intent(fallback).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                "$label settings khol di — wahan se on/off kar do."
            } catch (t2: Throwable) {
                "$label settings khol nahi payi."
            }
        }
    }

    private fun airplane(ctx: Context): String {
        val root = runRoot(
            "settings put global airplane_mode_on 1; " +
                "am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true"
        )
        if (root) return "Airplane mode on kar diya (root)."
        try {
            ctx.startActivity(Intent(Settings.ACTION_AIRPLANE_MODE_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (t: Throwable) {
            return "Airplane mode sirf settings se badalta hai — Android permission nahi deta."
        }
        return "Airplane mode Android se block hai — settings khol di, wahan toggle kar do."
    }

    private fun mobileData(ctx: Context): String {
        val root = runRoot("svc data enable")
        if (root) return "Mobile data on kar diya (root)."
        return panel(ctx, "android.settings.panel.action.INTERNET_CONNECTIVITY",
            Settings.ACTION_DATA_ROAMING_SETTINGS, "Internet")
    }

    private fun runRoot(cmd: String): Boolean {
        return try {
            val p = Runtime.getRuntime().exec(arrayOf("su", "-c", cmd))
            val deadline = System.currentTimeMillis() + 4000
            while (System.currentTimeMillis() < deadline) {
                try {
                    return p.exitValue() == 0
                } catch (e: IllegalThreadStateException) {
                    Thread.sleep(120)
                }
            }
            p.destroy()
            false
        } catch (t: Throwable) {
            false
        }
    }

    // ------------------------------------------------ call / message
    private fun hasPerm(ctx: Context, perm: String): Boolean =
        ctx.checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED

    private fun call(ctx: Context, name: String): String {
        val digits = name.filter { it.isDigit() || it == '+' }
        if (digits.count { it.isDigit() } >= 4) return dial(ctx, digits, digits)
        if (!hasPerm(ctx, Manifest.permission.READ_CONTACTS)) {
            return "Contacts permission chahiye — app kholo aur BOLO dabao, phir Allow karo."
        }
        val found = Contacts.findNumber(ctx, name) ?: return "'$name' contacts me nahi mila."
        return dial(ctx, found.second, found.first)
    }

    private fun dial(ctx: Context, number: String, label: String): String {
        val canCall = hasPerm(ctx, Manifest.permission.CALL_PHONE)
        val action = if (canCall) Intent.ACTION_CALL else Intent.ACTION_DIAL
        val intent = Intent(action, Uri.parse("tel:" + Uri.encode(number)))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            ctx.startActivity(intent)
            if (canCall) "$label ko call kar rahi hoon." else "$label ka number dialer me daal diya — call dabao."
        } catch (t: Throwable) {
            "Call nahi kar payi."
        }
    }

    private fun sendMessage(ctx: Context, name: String, text: String, whatsapp: Boolean): String {
        if (name.isBlank()) return "Kisko message bhejna hai? Bolo — message bhejo Rahul ko kal milte hain."
        var number: String? = null
        var label = name
        if (hasPerm(ctx, Manifest.permission.READ_CONTACTS)) {
            val found = Contacts.findNumber(ctx, name)
            if (found != null) {
                label = found.first
                number = found.second
            }
        }
        val body = if (text.isBlank()) "" else text

        if (whatsapp) {
            val digits = (number ?: "").filter { it.isDigit() }
            if (digits.isNotEmpty()) {
                val url = "https://wa.me/$digits" + if (body.isBlank()) "" else "?text=" + Uri.encode(body)
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .setPackage("com.whatsapp")
                try {
                    ctx.startActivity(intent)
                    return "$label ko WhatsApp message khol diya — send dabao."
                } catch (t: Throwable) {
                    // neeche share-sheet fallback
                }
            }
            val share = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, body.ifBlank { " " })
                setPackage("com.whatsapp")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            return try {
                ctx.startActivity(share)
                "WhatsApp khol diya — contact chuno, message ready hai."
            } catch (t: Throwable) {
                "WhatsApp installed nahi lagta."
            }
        }

        if (number.isNullOrBlank()) {
            return "'$name' ka number nahi mila. Contacts permission do ya poora number bolo."
        }
        val sms = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + number.filter { it.isDigit() || it == '+' }))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        sms.putExtra("sms_body", body)
        return try {
            ctx.startActivity(sms)
            "$label ke liye message ready — send dabao."
        } catch (t: Throwable) {
            "Message app khol nahi payi."
        }
    }

    // ------------------------------------------------ notes
    private fun saveNote(ctx: Context, text: String): String {
        if (text.isBlank()) return "Kya note karna hai?"
        val sp = ctx.getSharedPreferences("edith_notes", Context.MODE_PRIVATE)
        val old = sp.getString("notes", "") ?: ""
        val stamp = SimpleDateFormat("d MMM, h:mm a", Locale.US).format(Date())
        val line = "[$stamp] $text"
        val updated = if (old.isBlank()) line else old + "\n" + line
        sp.edit().putString("notes", updated).apply()
        return "Note kar liya: $text"
    }

    private fun readNotes(ctx: Context): String {
        val sp = ctx.getSharedPreferences("edith_notes", Context.MODE_PRIVATE)
        val all = sp.getString("notes", "") ?: ""
        if (all.isBlank()) return "Abhi koi note nahi hai."
        val lines = all.split("\n").filter { it.isNotBlank() }
        val last = lines.takeLast(3)
        return "Aapke " + lines.size + " notes hain. " + last.joinToString(". ")
    }

    // ------------------------------------------------ help
    val HELP: String = "Main in cheezon me help karti hoon: " +
        "torch on off, koi bhi app kholo, Chrome, naya tab, Google search, website kholo, " +
        "best website dhundo, call karo, message bhejo, WhatsApp messages padho, email padho, saari notifications padho, " +
        "battery, time, date, volume up down mute, WiFi Bluetooth airplane data settings, " +
        "note karo aur notes padho, aur 'stop' bolne par sunna band."

    val HELP_LINES: String = """
        • "Edith torch on" / "torch band karo"
        • "Edith open WhatsApp" / "chrome kholo"
        • "Edith new tab"
        • "Edith search best ai website"
        • "Edith google par weather search karo"
        • "Edith open flipkart.com"
        • "Edith call Rahul" / "Rahul ko call karo"
        • "Edith message bhejo Rahul ko kal milte hain"
        • "Edith WhatsApp par Rahul ko message bhejo aa raha hoon"
        • "Edith WhatsApp padho"
        • "Edith email padho"
        • "Edith notifications padho"
        • "Edith battery" / "kitne baje hain" / "aaj ki date"
        • "Edith volume badhao" / "volume mute"
        • "Edith WiFi on karo" / "Bluetooth settings"
        • "Edith airplane mode on" (settings khulega)
        • "Edith note karo doodh lana hai"
        • "Edith notes padho"
        • "Edith stop"
    """.trimIndent()
}

/** chhote helpers */
object CollectionUtils {
    fun normalize(raw: String): String =
        raw.lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]+"), " ").trim()
}
