package pay.zapp.listener

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Starts listening again after the phone restarts. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED && Settings(context).isConfigured) {
            ListenerService.start(context)
        }
    }
}
