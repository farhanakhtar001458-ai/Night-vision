package com.farhan.edith

/** EDITH jo bhi samajhti hai, wo in actions me se ek hota hai. */
sealed class Action {
    object TorchOn : Action()
    object TorchOff : Action()
    object TorchToggle : Action()

    object ReadWhatsApp : Action()
    object ReadEmail : Action()
    object ReadAll : Action()

    object OpenChrome : Action()
    object NewTab : Action()
    data class Search(val query: String) : Action()
    data class OpenUrl(val url: String) : Action()
    data class OpenApp(val name: String) : Action()

    object Battery : Action()
    object TimeNow : Action()
    object DateNow : Action()

    object VolumeUp : Action()
    object VolumeDown : Action()
    object VolumeMute : Action()

    object Wifi : Action()
    object Bluetooth : Action()
    object Airplane : Action()
    object MobileData : Action()

    data class Call(val name: String) : Action()
    data class Message(val name: String, val text: String, val whatsapp: Boolean) : Action()

    data class Note(val text: String) : Action()
    object ReadNotes : Action()

    object Help : Action()
    object About : Action()
    object StopListening : Action()
    object None : Action()
}
