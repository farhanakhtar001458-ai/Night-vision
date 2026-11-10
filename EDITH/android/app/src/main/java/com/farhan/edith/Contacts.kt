package com.farhan.edith

import android.content.Context
import android.provider.ContactsContract

/** Naam se number dhoondhta hai (contacts permission ho to). */
object Contacts {

    fun findNumber(ctx: Context, name: String): Pair<String, String>? {
        val q = name.trim()
        if (q.isEmpty()) return null
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        )
        val selection = ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " LIKE ?"
        val args = arrayOf("%$q%")
        val cursor = try {
            ctx.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                projection, selection, args,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC"
            )
        } catch (t: Throwable) {
            null
        }
        cursor?.use { c ->
            if (c.moveToFirst()) {
                val label = c.getString(0) ?: q
                val number = c.getString(1)
                if (!number.isNullOrBlank()) return label to number
            }
        }
        return null
    }
}
