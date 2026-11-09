package com.farhan.edith

/** NotificationListener se aayi messages ka chhota memory store. */
object NotifStore {

    class Item(
        val pkg: String,
        val app: String,
        val title: String,
        val text: String,
        val time: Long
    )

    private val items = ArrayList<Item>()
    private const val MAX = 80

    val WHATSAPP = setOf("com.whatsapp", "com.whatsapp.w4b")
    val MAIL = setOf("com.google.android.gm", "com.microsoft.office.outlook", "com.yahoo.mobile.client.android.mail",
        "ru.yandex.mail", "com.google.android.apps.inbox")

    fun add(item: Item) {
        synchronized(items) {
            items.add(item)
            while (items.size > MAX) items.removeAt(0)
        }
    }

    fun recent(packages: Set<String>, limit: Int): List<Item> {
        val out = ArrayList<Item>()
        synchronized(items) {
            var i = items.size - 1
            while (i >= 0 && out.size < limit) {
                val it = items[i]
                if (packages.isEmpty() || packages.contains(it.pkg)) out.add(it)
                i -= 1
            }
        }
        return out
    }

    fun isEmpty(): Boolean = synchronized(items) { items.isEmpty() }
}
