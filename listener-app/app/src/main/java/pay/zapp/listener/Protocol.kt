package pay.zapp.listener

import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * What the phone sends to Zapp's `mobileMoneyListener`
 * (functions/src/mobileMoney/listener.ts). Pure Kotlin, no Android, so it is
 * unit-tested on the JVM.
 *
 *   POST <endpoint>
 *   Listener-Device: ld_…
 *   Listener-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">
 *   { "type": "sms", "smsId", "from", "body", "receivedAt" } or { "type": "heartbeat" }
 */
object Protocol {
    const val DEFAULT_ENDPOINT =
        "https://us-central1-quickpay-485417.cloudfunctions.net/mobileMoneyListener"

    /** `t=…,v1=…` over [body] at [nowSeconds] with the device [key]. */
    fun signature(body: String, key: String, nowSeconds: Long): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        val digest = mac.doFinal("$nowSeconds.$body".toByteArray(Charsets.UTF_8))
        return "t=$nowSeconds,v1=${digest.toHex()}"
    }

    fun heartbeatBody(): String = """{"type":"heartbeat"}"""

    fun smsBody(sms: Sms): String =
        "{" +
            "\"type\":\"sms\"," +
            "\"smsId\":${json(sms.id)}," +
            "\"from\":${json(sms.from)}," +
            "\"body\":${json(sms.body)}," +
            "\"receivedAt\":${sms.receivedAtMs}" +
            "}"

    /**
     * Whether a text from [from] is forwarded: only the operators' sender IDs
     * the admin entered, unless forwarding everything is switched on (for
     * collecting samples). The server checks again.
     */
    fun shouldForward(from: String, senderIds: List<String>, forwardAll: Boolean): Boolean {
        if (forwardAll) return true
        val f = from.trim().lowercase()
        return senderIds.any { it.trim().isNotEmpty() && it.trim().lowercase() == f }
    }

    /** "Zaad, Telesom" → ["Zaad", "Telesom"]. */
    fun parseSenderIds(text: String): List<String> =
        text.split(',', '\n').map { it.trim() }.filter { it.isNotEmpty() }

    /**
     * A stable ID for one received text, so a retry or a second broadcast of
     * the same SMS is recognised by the server.
     */
    fun smsId(from: String, body: String, receivedAtMs: Long): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("$from|$receivedAtMs|$body".toByteArray(Charsets.UTF_8))
        return digest.toHex().take(32)
    }

    /** A JSON string literal. */
    fun json(value: String): String {
        val sb = StringBuilder("\"")
        for (c in value) {
            when (c) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> if (c < ' ') sb.append(String.format("\\u%04x", c.code)) else sb.append(c)
            }
        }
        return sb.append('"').toString()
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
}

/** One received text. */
data class Sms(val id: String, val from: String, val body: String, val receivedAtMs: Long) {
    /** One line per field, for the queue file. Body last: it may contain anything. */
    fun serialise(): String = "$id\n$receivedAtMs\n${from.replace("\n", " ")}\n$body"

    companion object {
        fun of(from: String, body: String, receivedAtMs: Long) =
            Sms(Protocol.smsId(from, body, receivedAtMs), from, body, receivedAtMs)

        fun parse(text: String): Sms? {
            val parts = text.split('\n', limit = 4)
            if (parts.size < 4) return null
            val at = parts[1].toLongOrNull() ?: return null
            return Sms(parts[0], parts[2], parts[3], at)
        }
    }
}
