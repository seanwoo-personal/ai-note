package com.hejhome.ainote

import android.Manifest
import android.content.pm.PackageManager
import android.view.View
import android.view.ViewGroup
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityTest {
    @Test
    fun launchesWithHardenedWebViewAndMicrophoneDeclaration() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val webView = findWebView(activity.window.decorView)
                assertNotNull(webView)
                checkNotNull(webView)
                assertTrue(webView.settings.javaScriptEnabled)
                assertTrue(webView.settings.domStorageEnabled)
                assertFalse(webView.settings.allowFileAccess)
                assertFalse(webView.settings.allowContentAccess)
                assertEquals(
                    WebSettings.MIXED_CONTENT_NEVER_ALLOW,
                    webView.settings.mixedContentMode,
                )

                val permissions = activity.packageManager.getPackageInfo(
                    activity.packageName,
                    PackageManager.GET_PERMISSIONS,
                ).requestedPermissions.orEmpty()
                assertTrue(permissions.contains(Manifest.permission.INTERNET))
                assertTrue(permissions.contains(Manifest.permission.RECORD_AUDIO))
                assertTrue(permissions.contains(Manifest.permission.MODIFY_AUDIO_SETTINGS))
            }
        }
    }

    private fun findWebView(view: View): WebView? {
        if (view is WebView) return view
        if (view !is ViewGroup) return null
        for (index in 0 until view.childCount) {
            findWebView(view.getChildAt(index))?.let { return it }
        }
        return null
    }
}
