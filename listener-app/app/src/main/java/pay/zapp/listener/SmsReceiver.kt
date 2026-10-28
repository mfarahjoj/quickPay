package pay.zapp.listener

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/**
 * Every text the collection SIM receives. Parts of a long SMS are joined; the
 * text is queued (if it's from an operator sender ID) and the service is woken
 * to forward it.
 */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (parts.isEmpty()) return
        val from = parts[0].displayOriginatingAddress ?: parts[0].originatingAddress ?: ""
        val body = parts.joinToString("") { it.displayMessageBody ?: it.messageBody ?: "" }
        val at = parts[0].timestampMillis.takeIf { it > 0 } ?: System.currentTimeMillis()

        val settings = Settings(context)
        if (!Protocol.shouldForward(from, settings.senderIds, settings.forwardAll)) return
        SmsQueue(context).add(Sms.of(from, body, at))
        ListenerService.start(context)
    }
}
