package com.hejhome.ainote

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WebPermissionPolicyTest {
    private val trustedUrls = TrustedUrlPolicy("https://note.example.jp")
    private val policy = WebPermissionPolicy(trustedUrls)

    @Test
    fun `grants only microphone capture from the trusted origin`() {
        assertArrayEquals(
            arrayOf(WebPermissionPolicy.AUDIO_CAPTURE_RESOURCE),
            policy.grantableResources(
                origin = "https://note.example.jp",
                requestedResources = arrayOf(
                    WebPermissionPolicy.AUDIO_CAPTURE_RESOURCE,
                    "android.webkit.resource.VIDEO_CAPTURE",
                ),
                hasRecordAudioPermission = true,
            ),
        )
    }

    @Test
    fun `does not grant resources before Android microphone permission`() {
        assertArrayEquals(
            emptyArray<String>(),
            policy.grantableResources(
                origin = "https://note.example.jp",
                requestedResources = arrayOf(WebPermissionPolicy.AUDIO_CAPTURE_RESOURCE),
                hasRecordAudioPermission = false,
            ),
        )
        assertTrue(
            policy.shouldRequestRecordAudio(
                origin = "https://note.example.jp",
                requestedResources = arrayOf(WebPermissionPolicy.AUDIO_CAPTURE_RESOURCE),
                hasRecordAudioPermission = false,
            ),
        )
    }

    @Test
    fun `rejects microphone and camera requests from every other origin`() {
        val requested = arrayOf(
            WebPermissionPolicy.AUDIO_CAPTURE_RESOURCE,
            "android.webkit.resource.VIDEO_CAPTURE",
        )

        assertArrayEquals(
            emptyArray<String>(),
            policy.grantableResources("https://evil.example", requested, true),
        )
        assertFalse(policy.shouldRequestRecordAudio("https://evil.example", requested, false))
    }
}
