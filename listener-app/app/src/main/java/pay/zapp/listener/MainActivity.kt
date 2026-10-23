package pay.zapp.listener

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings as AndroidSettings
import android.text.InputType
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.text.DateFormat
import java.util.Date

/**
 * Setup and status. The admin registers this phone in the Zapp console
 * (adminRegisterListener), which shows a device ID and a key once; both go
 * here, with the operator's sender IDs (e.g. "Zaad").
 *
 * "Forward every text" is for collecting samples of the operator's messages
 * before the parser exists; switch it off afterwards.
 */
class MainActivity : Activity() {
    private lateinit var settings: Settings
    private lateinit var queue: SmsQueue
    private lateinit var status: TextView
    private lateinit var recent: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        settings = Settings(this)
        queue = SmsQueue(this)

        val pad = (16 * resources.displayMetrics.density).toInt()
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }
        fun label(text: String) = TextView(this).apply { this.text = text; setPadding(0, pad, 0, pad / 4) }

        status = TextView(this).apply { textSize = 15f }
        column.addView(status)

        column.addView(label("Zapp endpoint"))
        val endpoint = EditText(this).apply { setText(settings.endpoint); inputType = InputType.TYPE_TEXT_VARIATION_URI }
        column.addView(endpoint)

        column.addView(label("Device ID (ld_…)"))
        val device = EditText(this).apply { setText(settings.deviceId); isSingleLine = true }
        column.addView(device)

        column.addView(label("Signing key (shown once in the Zapp console; leave empty to keep the saved one)"))
        val key = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            hint = if (settings.key() != null) "•••• saved" else "paste the key"
        }
        column.addView(key)

        column.addView(label("Operator sender IDs, comma-separated (e.g. Zaad)"))
        val senders = EditText(this).apply { setText(settings.senderIds.joinToString(", ")) }
        column.addView(senders)

        val forwardAll = CheckBox(this).apply {
            text = "Forward every text (only while collecting samples)"
            isChecked = settings.forwardAll
        }
        column.addView(forwardAll)

        column.addView(Button(this).apply {
            text = "Save and start"
            setOnClickListener {
                settings.endpoint = endpoint.text.toString().ifBlank { Protocol.DEFAULT_ENDPOINT }
                settings.deviceId = device.text.toString()
                if (key.text.isNotBlank()) {
                    settings.saveKey(key.text.toString())
                    key.setText("")
                    key.hint = "•••• saved"
                }
                settings.senderIds = Protocol.parseSenderIds(senders.text.toString())
                settings.forwardAll = forwardAll.isChecked
                if (!settings.isConfigured) {
                    Toast.makeText(this@MainActivity, "Enter the device ID and key from the Zapp console", Toast.LENGTH_LONG).show()
                } else {
                    askPermissions()
                    ListenerService.start(this@MainActivity)
                }
                refresh()
            }
        })

        column.addView(Button(this).apply {
            text = "Allow running in the background"
            setOnClickListener { askBatteryExemption() }
        })

        column.addView(label("Recent texts (newest first)"))
        column.addView(Button(this).apply {
            text = "Copy recent texts"
            setOnClickListener {
                val clip = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
                clip.setPrimaryClip(ClipData.newPlainText("texts", recentText()))
                Toast.makeText(this@MainActivity, "Copied", Toast.LENGTH_SHORT).show()
            }
        })
        recent = TextView(this).apply { setTextIsSelectable(true) }
        column.addView(recent)

        setContentView(ScrollView(this).apply { addView(column) })
        askPermissions()
        if (settings.isConfigured) ListenerService.start(this)
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun refresh() {
        val fmt = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.MEDIUM)
        val hb = settings.lastHeartbeatOkMs
        val sms = checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
        status.text = buildString {
            appendLine(if (settings.isConfigured) "Set up: ${settings.deviceId}" else "Not set up yet")
            appendLine(if (sms) "SMS permission: allowed" else "SMS permission: NOT allowed")
            appendLine("Last heartbeat accepted: ${if (hb > 0) fmt.format(Date(hb)) else "never"}")
            appendLine("Waiting to send: ${queue.pendingCount()}")
            append("Last result: ${settings.lastResult.ifBlank { "—" }}")
        }
        recent.text = recentText().ifBlank { "Nothing received yet." }
    }

    private fun recentText(): String {
        val fmt = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.MEDIUM)
        return queue.recent().joinToString("\n\n") { "[${fmt.format(Date(it.receivedAtMs))}] ${it.from}\n${it.body}" }
    }

    private fun askPermissions() {
        val wanted = mutableListOf(Manifest.permission.RECEIVE_SMS)
        if (Build.VERSION.SDK_INT >= 33) wanted += Manifest.permission.POST_NOTIFICATIONS
        val missing = wanted.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), 1)
    }

    private fun askBatteryExemption() {
        val power = getSystemService(POWER_SERVICE) as PowerManager
        if (power.isIgnoringBatteryOptimizations(packageName)) {
            Toast.makeText(this, "Already allowed", Toast.LENGTH_SHORT).show()
            return
        }
        startActivity(
            Intent(AndroidSettings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
        )
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refresh()
    }
}
