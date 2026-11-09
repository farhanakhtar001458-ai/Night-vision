package com.farhan.edith

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {

    private lateinit var btnTalk: Button
    private lateinit var btnAlways: Button
    private lateinit var btnNotif: Button
    private lateinit var btnAnnounce: Button
    private lateinit var btnHelp: Button
    private lateinit var txtStatus: TextView
    private lateinit var txtReply: TextView
    private lateinit var txtHelp: TextView

    private val ui = object : EdithCore.Ui {
        override fun onStatus(text: String) {
            runOnUiThread { txtStatus.text = text }
        }

        override fun onReply(text: String) {
            runOnUiThread { txtReply.text = text }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        EdithCore.init(this)
        EdithCore.ui = ui

        btnTalk = findViewById(R.id.btnTalk)
        btnAlways = findViewById(R.id.btnAlways)
        btnNotif = findViewById(R.id.btnNotif)
        btnAnnounce = findViewById(R.id.btnAnnounce)
        btnHelp = findViewById(R.id.btnHelp)
        txtStatus = findViewById(R.id.txtStatus)
        txtReply = findViewById(R.id.txtReply)
        txtHelp = findViewById(R.id.txtHelp)

        btnTalk.setOnClickListener {
            if (!EdithCore.hasMic(this)) {
                requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
                Toast.makeText(this, "Mic permission do, phir bolo", Toast.LENGTH_SHORT).show()
            } else {
                EdithCore.tapListen()
            }
        }

        btnAlways.setOnClickListener {
            val on = EdithCore.toggleAlways()
            if (on) {
                if (!EdithCore.hasMic(this)) {
                    requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
                    Toast.makeText(this, "Pehle mic permission do", Toast.LENGTH_SHORT).show()
                } else {
                    askNotificationPermission()
                    AssistantService.start(this)
                    Toast.makeText(this, "Always listening ON — 'Edith' bolo", Toast.LENGTH_LONG).show()
                }
            } else {
                Toast.makeText(this, "Always listening OFF", Toast.LENGTH_SHORT).show()
            }
            refresh()
        }

        btnNotif.setOnClickListener {
            try {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            } catch (t: Throwable) {
                Toast.makeText(this, "Settings khol nahi payi", Toast.LENGTH_SHORT).show()
            }
        }

        btnAnnounce.setOnClickListener {
            val on = EdithCore.toggleAnnounce()
            Toast.makeText(
                this,
                if (on) "Har nayi WhatsApp/email bol ke bataungi" else "Announce band",
                Toast.LENGTH_SHORT
            ).show()
            refresh()
        }

        btnHelp.setOnClickListener {
            txtHelp.text = Actions.HELP_LINES
            EdithCore.say("Main in sab me help karti hoon.")
        }

        refresh()
    }

    override fun onResume() {
        super.onResume()
        EdithCore.ui = ui
        refresh()
    }

    override fun onDestroy() {
        if (EdithCore.ui === ui) EdithCore.ui = null
        super.onDestroy()
    }

    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIF)
        }
    }

    private fun refresh() {
        btnTalk.text = if (EdithCore.hasMic(this)) getString(R.string.talk) else "🎙 MIC PERMISSION DO"
        btnAlways.text = "Always listening: " + if (EdithCore.alwaysListening) "ON" else "OFF"
        btnNotif.text = "Notification access: " +
            if (EdithCore.notificationAccessEnabled(this)) "ON" else "OFF"
        btnAnnounce.text = "Announce messages: " + if (EdithCore.announce) "ON" else "OFF"
        if (txtHelp.text.isNullOrEmpty()) txtHelp.text = Actions.HELP_LINES
    }

    companion object {
        private const val REQ_MIC = 101
        private const val REQ_NOTIF = 102
    }
}
