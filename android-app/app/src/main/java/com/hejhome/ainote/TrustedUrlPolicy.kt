package com.hejhome.ainote

import java.net.URI

class TrustedUrlPolicy(baseUrl: String) {
    private val baseUri: URI = parse(baseUrl).also { uri ->
        require(uri.scheme.equals("https", ignoreCase = true)) { "AI_NOTE_URL must use HTTPS" }
        require(!uri.host.isNullOrBlank()) { "AI_NOTE_URL must include a host" }
        require(uri.userInfo == null) { "AI_NOTE_URL must not include credentials" }
    }

    val initialUrl: String = baseUri.withDefaultPath().toASCIIString()

    fun isInternal(url: String): Boolean {
        val candidate = runCatching { parse(url) }.getOrNull() ?: return false
        return candidate.scheme.equals("https", ignoreCase = true) &&
            candidate.host.equals(baseUri.host, ignoreCase = true) &&
            effectivePort(candidate) == effectivePort(baseUri) &&
            candidate.userInfo == null
    }

    fun canOpenExternally(url: String): Boolean {
        val scheme = runCatching { parse(url).scheme?.lowercase() }.getOrNull()
        return scheme == "https" || scheme == "mailto" || scheme == "tel"
    }

    private fun URI.withDefaultPath(): URI = if (rawPath.isNullOrEmpty()) {
        URI(scheme, userInfo, host, port, "/", rawQuery, rawFragment)
    } else {
        this
    }

    private fun effectivePort(uri: URI): Int = if (uri.port == -1) 443 else uri.port

    private fun parse(value: String): URI = URI(value.trim())
}
