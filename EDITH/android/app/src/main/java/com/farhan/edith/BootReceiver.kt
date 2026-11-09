package com.farhan.edith

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        try {
            EdithCore.init(context)
            if (EdithCore.alwaysListening) AssistantService.start(context)
        } catch (t: Throwable) {
        }
    }
}
