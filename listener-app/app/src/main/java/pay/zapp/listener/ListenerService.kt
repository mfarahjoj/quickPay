package pay.zapp.listener

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Runs all the time (a foreground service, so Android doesn't stop it):
 * forwards queued texts, retrying until Zapp accepts them, and sends a
 * heartbeat every minute so Zapp can tell when the phone has gone quiet.
 */
class ListenerService : Service() {
    @Volatile private var running = false
    private var worker: Thread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundCompat()
        if (!running) {
            running = true
            worker = Thread(::loop, "zapp-listener").also { it.start() }
        } else {
            synchronized(lock) { (lock as Object).notifyAll() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        worker?.interrupt()
        super.onDestroy()
    }

    private fun loop() {
        val settings = Settings(this)
        val queue = SmsQueue(this)
        val forwarder = Forwarder(settings)
        val power = getSystemService(Context.POWER_SERVICE) as PowerManager
        var lastHeartbeat = 0L
        var backoffMs = 5_000L
        while (running) {
            val wake = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "zapp:listener")
            wake.acquire(60_000)
            try {
                if (settings.isConfigured) {
                    var failed = false
                    for ((file, sms) in queue.pending()) {
                        val status = forwarder.forward(sms)
                        settings.lastResult = "SMS ${sms.id.take(6)}… → $status"
                        // 4xx other than auth won't succeed on retry; drop it so the queue moves.
                        if (status in 200..299 || status == 400) {
                            queue.done(file)
                        } else {
                            failed = true
                            break
                        }
                    }
                    val now = System.currentTimeMillis()
                    if (now - lastHeartbeat >= HEARTBEAT_MS) {
                        val status = forwarder.heartbeat()
                        if (status in 200..299) settings.lastHeartbeatOkMs = now
                        else settings.lastResult = "Heartbeat → $status"
                        lastHeartbeat = now
                    }
                    backoffMs = if (failed) (backoffMs * 2).coerceAtMost(5 * 60_000L) else 5_000L
                    updateNotification(queue.pendingCount(), settings)
                }
            } finally {
                if (wake.isHeld) wake.release()
            }
            synchronized(lock) {
                try { (lock as Object).wait(if (queue.pendingCount() > 0) backoffMs else HEARTBEAT_MS) } catch (_: InterruptedException) {}
            }
        }
    }

    private fun startForegroundCompat() {
        val n = notification("Listening for Zaad and eDahab payments")
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, n)
        }
    }

    private fun updateNotification(pending: Int, settings: Settings) {
        val text = if (pending > 0) "$pending payment text(s) waiting to send" else "Listening · last: ${settings.lastResult}"
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIFICATION_ID, notification(text))
    }

    private fun notification(text: String): Notification {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Listener", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Zapp listener")
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(open)
            .build()
    }

    companion object {
        private const val CHANNEL = "listener"
        private const val NOTIFICATION_ID = 1
        private const val HEARTBEAT_MS = 60_000L
        private val lock = Any()

        fun start(context: Context) {
            context.startForegroundService(Intent(context, ListenerService::class.java))
        }
    }
}
