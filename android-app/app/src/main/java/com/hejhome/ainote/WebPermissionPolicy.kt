package com.hejhome.ainote

class WebPermissionPolicy(private val trustedUrls: TrustedUrlPolicy) {
    fun grantableResources(
        origin: String,
        requestedResources: Array<String>,
        hasRecordAudioPermission: Boolean,
    ): Array<String> {
        if (!trustedUrls.isInternal(origin) || !hasRecordAudioPermission) return emptyArray()
        return requestedResources.filter { it == AUDIO_CAPTURE_RESOURCE }.toTypedArray()
    }

    fun shouldRequestRecordAudio(
        origin: String,
        requestedResources: Array<String>,
        hasRecordAudioPermission: Boolean,
    ): Boolean = trustedUrls.isInternal(origin) &&
        !hasRecordAudioPermission &&
        requestedResources.contains(AUDIO_CAPTURE_RESOURCE)

    companion object {
        const val AUDIO_CAPTURE_RESOURCE = "android.webkit.resource.AUDIO_CAPTURE"
    }
}
