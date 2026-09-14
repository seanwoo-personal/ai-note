package com.hejhome.ainote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TrustedUrlPolicyTest {
    private val policy = TrustedUrlPolicy(
        "https://lecture-interpreted-considerable-experience.trycloudflare.com",
    )

    @Test
    fun `keeps only exact HTTPS origin inside the app`() {
        assertTrue(policy.isInternal("https://lecture-interpreted-considerable-experience.trycloudflare.com/login"))
        assertTrue(policy.isInternal("https://lecture-interpreted-considerable-experience.trycloudflare.com/live?tool=translator"))

        assertFalse(policy.isInternal("http://lecture-interpreted-considerable-experience.trycloudflare.com/login"))
        assertFalse(policy.isInternal("https://lecture-interpreted-considerable-experience.trycloudflare.com.evil.example/login"))
        assertFalse(policy.isInternal("https://example.com/"))
        assertFalse(policy.isInternal("file:///sdcard/Download/index.html"))
        assertFalse(policy.isInternal("javascript:alert(1)"))
    }

    @Test
    fun `normalizes base URL and resolves the initial page`() {
        val normalized = TrustedUrlPolicy("https://example.com/base/")

        assertEquals("https://example.com/base/", normalized.initialUrl)
        assertTrue(normalized.isInternal("https://example.com/settings"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects a cleartext base URL`() {
        TrustedUrlPolicy("http://example.com")
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects a base URL containing credentials`() {
        TrustedUrlPolicy("https://user:password@example.com")
    }
}
