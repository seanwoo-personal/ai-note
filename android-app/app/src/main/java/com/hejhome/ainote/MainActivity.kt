package com.hejhome.ainote

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.http.SslError
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var errorPanel: View
    private lateinit var trustedUrls: TrustedUrlPolicy
    private lateinit var webPermissions: WebPermissionPolicy
    private lateinit var appExperience: AndroidAppExperience
    private var pendingWebPermission: PermissionRequest? = null
    private var initialLocaleChecked = false

    private val recordAudioLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        val request = pendingWebPermission
        pendingWebPermission = null
        if (request == null) return@registerForActivityResult
        val grantable = webPermissions.grantableResources(
            request.origin.toString(),
            request.resources,
            granted,
        )
        if (grantable.isEmpty()) request.deny() else request.grant(grantable)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        trustedUrls = TrustedUrlPolicy(BuildConfig.AI_NOTE_URL)
        webPermissions = WebPermissionPolicy(trustedUrls)
        appExperience = AndroidAppExperience(trustedUrls)

        val root = FrameLayout(this).apply { setBackgroundColor(Color.rgb(247, 245, 242)) }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, windowInsets ->
            val systemBars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom)
            windowInsets
        }
        webView = createWebView()
        root.addView(
            webView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            isIndeterminate = false
        }
        root.addView(
            progressBar,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)).apply {
                gravity = Gravity.TOP
            },
        )
        errorPanel = createErrorPanel()
        root.addView(
            errorPanel,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        setContentView(root)
        ViewCompat.requestApplyInsets(root)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        val restored = savedInstanceState?.let(webView::restoreState)
        if (restored == null) webView.loadUrl(trustedUrls.initialUrl)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView = WebView(this).apply webView@{
        setBackgroundColor(Color.rgb(247, 245, 242))
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = true
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            safeBrowsingEnabled = true
            userAgentString = "$userAgentString hejhome-ai-note-android/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(this@webView, false)
        }
        webViewClient = TrustedWebViewClient()
        webChromeClient = TrustedWebChromeClient()
        setDownloadListener(TrustedDownloadListener())
    }

    private inner class TrustedWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            if (appExperience.shouldBlockNavigation(url)) {
                toast(R.string.operator_screen_unavailable)
                return true
            }
            if (trustedUrls.isInternal(url)) return false
            openExternalOrBlock(url)
            return true
        }

        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
            errorPanel.visibility = View.GONE
            progressBar.visibility = View.VISIBLE
        }

        override fun onPageFinished(view: WebView, url: String) {
            if (!initialLocaleChecked && trustedUrls.isInternal(url)) {
                initialLocaleChecked = true
                view.evaluateJavascript(INITIAL_LOCALE_SCRIPT) { initialized ->
                    if (initialized == "true") {
                        view.reload()
                    } else {
                        applyAndroidPresentation(view, url)
                    }
                }
                return
            }
            applyAndroidPresentation(view, url)
        }

        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceError,
        ) {
            if (request.isForMainFrame) showLoadError()
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel()
            showLoadError()
        }
    }

    private fun applyAndroidPresentation(view: WebView, url: String) {
        if (appExperience.shouldSimplifyCustomerAccess(url)) {
            view.evaluateJavascript(AndroidAppExperience.SIMPLIFY_CUSTOMER_ACCESS_SCRIPT) {
                progressBar.visibility = View.GONE
            }
        } else {
            progressBar.visibility = View.GONE
        }
    }

    private inner class TrustedWebChromeClient : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            progressBar.progress = newProgress
            progressBar.visibility = if (newProgress >= 100) View.GONE else View.VISIBLE
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            runOnUiThread {
                val hasAudio = ContextCompat.checkSelfPermission(
                    this@MainActivity,
                    Manifest.permission.RECORD_AUDIO,
                ) == PackageManager.PERMISSION_GRANTED
                val grantable = webPermissions.grantableResources(
                    request.origin.toString(),
                    request.resources,
                    hasAudio,
                )
                when {
                    grantable.isNotEmpty() -> request.grant(grantable)
                    webPermissions.shouldRequestRecordAudio(
                        request.origin.toString(),
                        request.resources,
                        hasAudio,
                    ) -> {
                        pendingWebPermission?.deny()
                        pendingWebPermission = request
                        recordAudioLauncher.launch(Manifest.permission.RECORD_AUDIO)
                    }
                    else -> request.deny()
                }
            }
        }

        override fun onPermissionRequestCanceled(request: PermissionRequest) {
            if (pendingWebPermission == request) pendingWebPermission = null
        }
    }

    private inner class TrustedDownloadListener : DownloadListener {
        override fun onDownloadStart(
            url: String,
            userAgent: String?,
            contentDisposition: String?,
            mimetype: String?,
            contentLength: Long,
        ) {
            if (!trustedUrls.isInternal(url)) {
                openExternalOrBlock(url)
                return
            }
            runCatching {
                val fileName = URLUtil.guessFileName(url, contentDisposition, mimetype)
                val request = DownloadManager.Request(url.toUri()).apply {
                    setTitle(fileName)
                    setMimeType(mimetype)
                    setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED,
                    )
                    userAgent?.let { addRequestHeader("User-Agent", it) }
                    CookieManager.getInstance().getCookie(url)?.let {
                        addRequestHeader("Cookie", it)
                    }
                }
                val manager = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                manager.enqueue(request)
            }.onSuccess {
                toast(R.string.download_started)
            }.onFailure {
                toast(R.string.download_failed)
            }
        }
    }

    private fun createErrorPanel(): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setPadding(dp(32), dp(32), dp(32), dp(32))
        setBackgroundColor(Color.rgb(247, 245, 242))
        visibility = View.GONE

        addView(TextView(context).apply {
            text = getString(R.string.load_error_title)
            textSize = 22f
            setTextColor(Color.rgb(32, 34, 33))
            gravity = Gravity.CENTER
        })
        addView(TextView(context).apply {
            text = getString(R.string.load_error_message)
            textSize = 15f
            setTextColor(Color.rgb(91, 96, 93))
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(12) })
        addView(Button(context).apply {
            text = getString(R.string.retry)
            setOnClickListener {
                errorPanel.visibility = View.GONE
                webView.loadUrl(trustedUrls.initialUrl)
            }
        }, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(20) })
    }

    private fun showLoadError() {
        progressBar.visibility = View.GONE
        errorPanel.visibility = View.VISIBLE
    }

    private fun openExternalOrBlock(url: String) {
        if (!trustedUrls.canOpenExternally(url)) {
            toast(R.string.blocked_link)
            return
        }
        try {
            startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
        } catch (_: ActivityNotFoundException) {
            toast(R.string.external_app_unavailable)
        }
    }

    private fun toast(message: Int) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        pendingWebPermission?.deny()
        pendingWebPermission = null
        webView.stopLoading()
        webView.webChromeClient = null
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val INITIAL_LOCALE_SCRIPT = """
            (function(){
              try {
                if (localStorage.getItem('ai-note-locale') === null) {
                  localStorage.setItem('ai-note-locale', 'ko');
                  return true;
                }
              } catch (_) {}
              return false;
            })()
        """
    }
}
