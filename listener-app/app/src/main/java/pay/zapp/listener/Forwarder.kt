package pay.zapp.listener

import java.net.HttpURLConnection
import java.net.URL

/** Posts signed bodies to Zapp. Returns the HTTP status, or -1 on no network. */
class Forwarder(private val settings: Settings) {

    fun heartbeat(): Int = post(Protocol.heartbeatBody())

    fun forward(sms: Sms): Int = post(Protocol.smsBody(sms))

    private fun post(body: String): Int {
        val key = settings.key() ?: return -1
        val signature = Protocol.signature(body, key, System.currentTimeMillis() / 1000)
        return try {
            val conn = URL(settings.endpoint).openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Listener-Device", settings.deviceId)
            conn.setRequestProperty("Listener-Signature", signature)
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val status = conn.responseCode
            conn.disconnect()
            status
        } catch (e: Exception) {
            -1
        }
    }
}
