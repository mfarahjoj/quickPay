package pay.zapp.listener

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolTest {
    @Test
    fun `signs exactly as the server verifies`() {
        // Same as node: createHmac("sha256","device-key").update("1792641600." + body)
        assertEquals(
            "t=1792641600,v1=a807c9f98cea0f5c2c1391b5623a14d7c4a42618e319847e42ae67419a5cc541",
            Protocol.signature("""{"type":"heartbeat"}""", "device-key", 1792641600L),
        )
    }

    @Test
    fun `an sms body is valid JSON whatever the text holds`() {
        val sms = Sms("abc", "Zaad", "Received \$10.00 from \"Abdi\"\nRef: TX1\\2", 1792641600000L)
        assertEquals(
            """{"type":"sms","smsId":"abc","from":"Zaad","body":"Received ${'$'}10.00 from \"Abdi\"\nRef: TX1\\2","receivedAt":1792641600000}""",
            Protocol.smsBody(sms),
        )
        assertEquals("\"\\u0001\"", Protocol.json("\u0001"))
    }

    @Test
    fun `only the operator's sender IDs are forwarded, unless collecting samples`() {
        val ids = Protocol.parseSenderIds("Zaad, eDahab\n")
        assertEquals(listOf("Zaad", "eDahab"), ids)
        assertTrue(Protocol.shouldForward("ZAAD", ids, forwardAll = false))
        assertFalse(Protocol.shouldForward("+252634000000", ids, forwardAll = false))
        assertFalse(Protocol.shouldForward("Zaad", emptyList(), forwardAll = false))
        assertTrue(Protocol.shouldForward("+252634000000", emptyList(), forwardAll = true))
    }

    @Test
    fun `the same text always gets the same id, a different one never does`() {
        val a = Protocol.smsId("Zaad", "Received", 1L)
        assertEquals(a, Protocol.smsId("Zaad", "Received", 1L))
        assertNotEquals(a, Protocol.smsId("Zaad", "Received", 2L))
        assertEquals(32, a.length)
    }

    @Test
    fun `a queued text survives the trip to disk and back`() {
        val sms = Sms.of("Zaad", "line one\nline two", 42L)
        assertEquals(sms, Sms.parse(sms.serialise()))
        assertNull(Sms.parse("broken"))
    }
}
