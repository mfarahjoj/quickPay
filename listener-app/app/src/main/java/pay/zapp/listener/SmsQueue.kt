package pay.zapp.listener

import android.content.Context
import java.io.File

/**
 * Texts waiting to be forwarded, one file each, so nothing is lost while the
 * phone is offline or the app is restarted. A file is deleted only after the
 * server has answered 2xx. A short history of what arrived is kept for the
 * screen, so the admin can copy samples.
 */
class SmsQueue(context: Context) {
    private val dir = File(context.filesDir, "queue").apply { mkdirs() }
    private val recentDir = File(context.filesDir, "recent").apply { mkdirs() }

    fun add(sms: Sms) {
        File(dir, "${sms.receivedAtMs}_${sms.id}.sms").writeText(sms.serialise())
        File(recentDir, "${sms.receivedAtMs}_${sms.id}.sms").writeText(sms.serialise())
        val recent = recentDir.listFiles()?.sortedByDescending { it.name } ?: return
        recent.drop(MAX_RECENT).forEach { it.delete() }
    }

    /** Oldest first. */
    fun pending(): List<Pair<File, Sms>> =
        (dir.listFiles()?.sortedBy { it.name } ?: emptyList())
            .mapNotNull { f -> Sms.parse(f.readText())?.let { f to it } ?: run { f.delete(); null } }

    fun done(file: File) {
        file.delete()
    }

    fun pendingCount(): Int = dir.listFiles()?.size ?: 0

    /** Newest first. */
    fun recent(): List<Sms> =
        (recentDir.listFiles()?.sortedByDescending { it.name } ?: emptyList())
            .mapNotNull { Sms.parse(it.readText()) }

    private companion object {
        const val MAX_RECENT = 30
    }
}
